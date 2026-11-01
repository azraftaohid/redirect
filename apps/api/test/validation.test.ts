import { describe, it, expect } from "vitest";
import {
  validateSlug,
  validateTargetUrl,
  parseOwnHostnames,
  slugSchema,
  createLinkSchema,
  updateLinkSchema,
  tagsSchema,
} from "@redirect/shared";

describe("Slug validation", () => {
  it("rejects reserved slugs case-insensitively", () => {
    expect(validateSlug("api").ok).toBe(false);
    expect(validateSlug("API").ok).toBe(false);
    expect(validateSlug("app").ok).toBe(false);
    expect(validateSlug("App").ok).toBe(false);
  });

  it("accepts docs and Docs as distinct valid slugs (case-sensitive)", () => {
    expect(validateSlug("docs").ok).toBe(true);
    expect(validateSlug("Docs").ok).toBe(true);
    expect(validateSlug("link_1-2").ok).toBe(true);
  });

  it("rejects invalid characters, paths, empty, and over-length slugs", () => {
    expect(validateSlug("").ok).toBe(false);
    expect(validateSlug("a/b").ok).toBe(false);
    expect(validateSlug("..").ok).toBe(false);
    expect(validateSlug("a b").ok).toBe(false);
    expect(validateSlug("a%20b").ok).toBe(false);
    expect(validateSlug("a".repeat(65)).ok).toBe(false);
    expect(validateSlug("a".repeat(64)).ok).toBe(true);
  });
});

describe("Hostname and Target URL validation", () => {
  it("parses and normalizes own hostnames list", () => {
    const hosts = parseOwnHostnames("redirect.example.com", "www.example.com, REDIRECT.EXAMPLE.COM , ");
    expect(hosts.sort()).toEqual(["redirect.example.com", "www.example.com"].sort());
  });

  it("accepts private-IP targets and .local hostnames (D9: No SSRF/private-IP blocking)", () => {
    const ownHosts = ["redirect.example.com", "go.example.com"];
    expect(validateTargetUrl("http://192.168.1.10/x", ownHosts).ok).toBe(true);
    expect(validateTargetUrl("http://nas.local:5000", ownHosts).ok).toBe(true);
    expect(validateTargetUrl("http://localhost:3000", ownHosts).ok).toBe(true);
  });

  it("rejects invalid protocols", () => {
    const ownHosts = ["redirect.example.com"];
    expect(validateTargetUrl("javascript:alert(1)", ownHosts).ok).toBe(false);
    expect(validateTargetUrl("data:text/html,test", ownHosts).ok).toBe(false);
    expect(validateTargetUrl("file:///etc/passwd", ownHosts).ok).toBe(false);
    expect(validateTargetUrl("ftp://files.example.com", ownHosts).ok).toBe(false);
  });

  it("rejects target URLs pointing to own hostnames (loop prevention, case-insensitive)", () => {
    const ownHosts = ["redirect.example.com", "go.example.com"];
    expect(validateTargetUrl("https://redirect.example.com/other", ownHosts).ok).toBe(false);
    expect(validateTargetUrl("https://REDIRECT.EXAMPLE.COM/other", ownHosts).ok).toBe(false);
    expect(validateTargetUrl("https://go.example.com/sub", ownHosts).ok).toBe(false);
  });

  it("rejects target URLs exceeding max length", () => {
    const ownHosts = ["redirect.example.com"];
    expect(validateTargetUrl("https://example.com/" + "a".repeat(2048), ownHosts).ok).toBe(false);
  });
});

describe("Schemas", () => {
  it("normalizes and de-duplicates tags", () => {
    const result = tagsSchema.parse([" WORK ", "docs", "work", "PROJECT"]);
    expect(result).toEqual(["work", "docs", "project"]);
  });

  it("validates createLinkSchema", () => {
    const valid = createLinkSchema.parse({
      targetUrl: "https://example.com",
      slug: "custom-slug",
      statusCode: 307,
      tags: ["Tech", "Cloudflare"],
    });
    expect(valid.targetUrl).toBe("https://example.com");
    expect(valid.slug).toBe("custom-slug");
    expect(valid.tags).toEqual(["tech", "cloudflare"]);
  });

  it("validates updateLinkSchema requires at least one field", () => {
    expect(() => updateLinkSchema.parse({})).toThrow();
    expect(() => updateLinkSchema.parse({ title: "New Title" })).not.toThrow();
  });

  it("validates slugSchema", () => {
    expect(slugSchema.parse("valid-slug")).toBe("valid-slug");
    expect(() => slugSchema.parse("invalid slug")).toThrow();
    expect(() => slugSchema.parse("app")).toThrow();
  });

  it("normalizes empty string title to null in createLinkSchema", () => {
    const res = createLinkSchema.parse({
      targetUrl: "https://example.com",
      title: "   ",
    });
    expect(res.title).toBeNull();
  });
});
