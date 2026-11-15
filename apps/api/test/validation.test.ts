import { describe, it, expect } from "vitest";
import {
  validateSlug,
  validateTargetUrl,
  parseOwnHostnames,
  slugSchema,
  createLinkSchema,
  updateLinkSchema,
  tagsSchema,
  parseImportTimestamp,
  parseCsvContent,
  discoverJsonArrayPaths,
  discoverSourceFields,
  autoDetectFieldMapping,
  transformMappedRows,
  mergeClientAndServerImportReport,
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
    expect(validateTargetUrl("https://redirect.example.com./sub", ["redirect.example.com"]).ok).toBe(false);
    expect(validateTargetUrl("https://redirect.example.com/sub", ["redirect.example.com."]).ok).toBe(false);
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

  it("rejects ASCII control characters and whitespace in validateTargetUrl and link schemas", () => {
    const internalBadUrls = [
      "https://example.com/\r\nSet-Cookie: a=b",
      "https://example.com/\nnext",
      "https://example.com/\tpath",
      "https://example.com/\0null",
      "https://example.com/has space",
      "https://example.com/\x7fdel",
      "https://example.com/\u0085nel",
      "https://example.com/\u2028ls",
      "https://example.com/\u2029ps",
    ];

    for (const url of internalBadUrls) {
      expect(validateTargetUrl(url, []).ok).toBe(false);
      expect(() => createLinkSchema.parse({ targetUrl: url })).toThrow();
      expect(() => updateLinkSchema.parse({ targetUrl: url })).toThrow();
    }

    // Trailing newline is rejected directly by validateTargetUrl (and stripped by schema .trim())
    expect(validateTargetUrl("https://example.com/\n", []).ok).toBe(false);
  });
});

describe("Dynamic importer utilities", () => {
  it("evaluates ISO strings, SQL datetimes, date-only strings, compact dates, and s/ms epochs", () => {
    expect(parseImportTimestamp("2026-11-15T15:00:00Z")).toEqual({
      ok: true,
      value: "2026-11-15T15:00:00.000Z",
    });
    expect(parseImportTimestamp("2026-11-15T17:00:00+02:00")).toEqual({
      ok: true,
      value: "2026-11-15T15:00:00.000Z",
    });
    expect(parseImportTimestamp("2026-11-15 15:30:45")).toEqual({
      ok: true,
      value: "2026-11-15T15:30:45.000Z",
    });
    expect(parseImportTimestamp("2026-11-15T15:30:45")).toEqual({
      ok: true,
      value: "2026-11-15T15:30:45.000Z",
    });
    expect(parseImportTimestamp("2026-11-15")).toEqual({
      ok: true,
      value: "2026-11-15T00:00:00.000Z",
    });
    expect(parseImportTimestamp("20261115")).toEqual({
      ok: true,
      value: "2026-11-15T00:00:00.000Z",
    });
    expect(parseImportTimestamp(20261115)).toEqual({
      ok: true,
      value: "2026-11-15T00:00:00.000Z",
    });

    // Epoch seconds (number & string)
    expect(parseImportTimestamp(1735689600)).toEqual({
      ok: true,
      value: "2025-01-01T00:00:00.000Z",
    });
    expect(parseImportTimestamp("1735689600")).toEqual({
      ok: true,
      value: "2025-01-01T00:00:00.000Z",
    });

    // Epoch milliseconds (number & string)
    expect(parseImportTimestamp(1735689600000)).toEqual({
      ok: true,
      value: "2025-01-01T00:00:00.000Z",
    });
    expect(parseImportTimestamp("1735689600000")).toEqual({
      ok: true,
      value: "2025-01-01T00:00:00.000Z",
    });

    // Blank / null / invalid
    expect(parseImportTimestamp("")).toEqual({ ok: true, value: null });
    expect(parseImportTimestamp(null)).toEqual({ ok: true, value: null });
    expect(parseImportTimestamp("not-a-date").ok).toBe(false);
    expect(parseImportTimestamp("foo 1").ok).toBe(false);
    expect(parseImportTimestamp("2025-02-30").ok).toBe(false);
    expect(parseImportTimestamp("2025-02-30T12:00:00Z").ok).toBe(false);
    expect(parseImportTimestamp(20250230).ok).toBe(false);
  });

  it("parses CSV with quoted fields, escaped quotes, multiline values, BOM, and delimiters", () => {
    const csvWithQuotes =
      '\uFEFFurl,slug,title,tags\r\n' +
      '"https://example.com/a?x=1,2",go-a,"Hello ""World""\nLine 2","marketing, promo"\r\n' +
      'https://example.com/b,go-b,Simple,docs\r\n';

    const res = parseCsvContent(csvWithQuotes);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.delimiter).toBe(",");
      expect(res.headers).toEqual(["url", "slug", "title", "tags"]);
      expect(res.rows).toEqual([
        {
          url: "https://example.com/a?x=1,2",
          slug: "go-a",
          title: 'Hello "World"\nLine 2',
          tags: "marketing, promo",
        },
        {
          url: "https://example.com/b",
          slug: "go-b",
          title: "Simple",
          tags: "docs",
        },
      ]);
    }

    const semicolonCsv = "url;slug;active\nhttps://example.com/s;semi;yes\n";
    const semiRes = parseCsvContent(semicolonCsv);
    expect(semiRes.ok).toBe(true);
    if (semiRes.ok) {
      expect(semiRes.delimiter).toBe(";");
      expect(semiRes.rows[0]).toEqual({
        url: "https://example.com/s",
        slug: "semi",
        active: "yes",
      });
    }

    const headerlessCsv = "https://example.com/1\tfirst\nhttps://example.com/2\tsecond\n";
    const headerlessRes = parseCsvContent(headerlessCsv, { hasHeader: false });
    expect(headerlessRes.ok).toBe(true);
    if (headerlessRes.ok) {
      expect(headerlessRes.delimiter).toBe("\t");
      expect(headerlessRes.headers).toEqual(["Column 1", "Column 2"]);
      expect(headerlessRes.rows).toHaveLength(2);
    }

    expect(parseCsvContent('url\n"unclosed').ok).toBe(false);
  });

  it("discovers nested JSON array paths, auto-maps fields, transforms rows, and merges reports", () => {
    const jsonRoot = {
      meta: { count: 2 },
      emptyList: [],
      data: {
        records: [
          {
            destination: "https://example.com/1",
            short_code: "/one",
            created_epoch: 1735689600,
            labels: "alpha, beta",
            enabled: "yes",
          },
          {
            destination: "not-a-valid-url",
            short_code: "bad",
            created_epoch: "invalid-date",
          },
          {
            destination: "https://example.com/2",
            short_code: "",
            created_epoch: "2025-02-01 12:00:00",
          },
        ],
      },
    };

    const candidates = discoverJsonArrayPaths(jsonRoot);
    expect(candidates.map((c) => c.path)).toEqual(["data.records", "emptyList"]);

    const items = candidates[0]!.items;
    const fields = discoverSourceFields(items);
    expect(fields).toEqual([
      "destination",
      "short_code",
      "created_epoch",
      "labels",
      "enabled",
    ]);

    const mapping = autoDetectFieldMapping(fields);
    expect(mapping.targetUrl).toEqual({ mode: "field", sourceField: "destination" });
    expect(mapping.slug).toEqual({ mode: "field", sourceField: "short_code" });
    expect(mapping.tags).toEqual({ mode: "field", sourceField: "labels" });
    expect(mapping.isActive).toEqual({ mode: "field", sourceField: "enabled" });

    mapping.createdAt = { mode: "field", sourceField: "created_epoch" };
    mapping.statusCode = { mode: "constant", constantValue: "301" };

    const transformed = transformMappedRows(items, mapping);
    expect(transformed.validItems).toHaveLength(2);
    expect(transformed.validItems[0]).toEqual({
      originalIndex: 0,
      link: {
        targetUrl: "https://example.com/1",
        slug: "one",
        statusCode: 301,
        tags: ["alpha", "beta"],
        isActive: true,
        createdAt: "2025-01-01T00:00:00.000Z",
      },
    });
    expect(transformed.validItems[1]).toEqual({
      originalIndex: 2,
      link: {
        targetUrl: "https://example.com/2",
        statusCode: 301,
        createdAt: "2025-02-01T12:00:00.000Z",
      },
    });
    expect(transformed.clientErrors).toHaveLength(1);
    expect(transformed.clientErrors[0]?.index).toBe(1);

    const merged = mergeClientAndServerImportReport(
      {
        version: 1,
        onConflict: "skip",
        summary: { total: 2, created: 1, updated: 0, skipped: 0, failed: 1 },
        skippedSlugs: [],
        createdSlugs: ["one"],
        updatedSlugs: [],
        errors: [
          {
            index: 1,
            slug: null,
            code: "invalid_target_url",
            message: "Loop prevented",
          },
        ],
        results: [
          { index: 0, slug: "one", status: "created", id: "id-1" },
          { index: 1, slug: "", status: "failed", reason: "Loop prevented" },
        ],
      },
      transformed.validItems.map((i) => i.originalIndex),
      transformed.clientErrors,
      transformed.clientFailedResults,
      items.length
    );

    expect(merged.summary).toEqual({
      total: 3,
      created: 1,
      updated: 0,
      skipped: 0,
      failed: 2,
    });
    expect(merged.errors.map((e) => e.index)).toEqual([1, 2]);
    expect(merged.results.map((r) => r.index)).toEqual([0, 1, 2]);
  });

  it("handles autoDetectFieldMapping non-collision, top-level priority, and avoids ambiguous aliases", () => {
    const twoPass = autoDetectFieldMapping(["slug", "dest_page"]);
    expect(twoPass.slug).toEqual({ mode: "field", sourceField: "slug" });
    expect(twoPass.targetUrl).toEqual({ mode: "field", sourceField: "dest_page" });

    const topLevelPriority = autoDetectFieldMapping(["author.url", "url"]);
    expect(topLevelPriority.targetUrl).toEqual({ mode: "field", sourceField: "url" });

    const ambiguousAliases = autoDetectFieldMapping(["targetUrl", "shortUrl", "status"]);
    expect(ambiguousAliases.targetUrl).toEqual({ mode: "field", sourceField: "targetUrl" });
    expect(ambiguousAliases.slug).toEqual({ mode: "omit" });
    expect(ambiguousAliases.statusCode).toEqual({ mode: "omit" });
  });

  it("rejects non-primitive object values in title and invalid objects in tags arrays", () => {
    const baseMapping = autoDetectFieldMapping(["targetUrl", "title", "tags"]);
    const res = transformMappedRows(
      [
        {
          targetUrl: "https://example.com/bad-title",
          title: { en: "Hello" },
        },
        {
          targetUrl: "https://example.com/bad-tags",
          tags: [{ id: 1 }],
        },
        {
          targetUrl: "https://example.com/named-tags",
          title: "Valid Title",
          tags: [{ name: "Docs" }, { label: "API" }],
        },
      ],
      baseMapping
    );

    expect(res.validItems).toHaveLength(1);
    expect(res.validItems[0]?.link).toEqual({
      targetUrl: "https://example.com/named-tags",
      title: "Valid Title",
      tags: ["docs", "api"],
    });
    expect(res.clientErrors).toHaveLength(2);
    expect(res.clientErrors[0]?.message).toContain("title:");
    expect(res.clientErrors[1]?.message).toContain("tags:");
  });
});
