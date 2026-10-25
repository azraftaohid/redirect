import { describe, it, expect } from "vitest";
import { extractSharedPayload } from "../src/utils/share";

describe("extractSharedPayload", () => {
  it("extracts explicit url parameter", () => {
    const params = new URLSearchParams("url=https://example.com/page&title=Test");
    const payload = extractSharedPayload(params);
    expect(payload.targetUrl).toBe("https://example.com/page");
    expect(payload.title).toBe("Test");
  });

  it("extracts URL embedded inside text body", () => {
    const params = new URLSearchParams(
      "text=Check out this awesome article: https://example.com/cool-post!&title=Shared link"
    );
    const payload = extractSharedPayload(params);
    expect(payload.targetUrl).toBe("https://example.com/cool-post");
    expect(payload.title).toBe("Shared link");
  });

  it("cleans trailing punctuation from URLs in text", () => {
    const params = new URLSearchParams({
      text: "Found this here: (https://example.com/test?a=1&b=2).",
    });
    const payload = extractSharedPayload(params);
    expect(payload.targetUrl).toBe("https://example.com/test?a=1&b=2");
  });

  it("extracts URL from title if text and url are empty", () => {
    const params = new URLSearchParams("title=https://github.com/my-repo");
    const payload = extractSharedPayload(params);
    expect(payload.targetUrl).toBe("https://github.com/my-repo");
  });

  it("returns null targetUrl if no valid URL is present", () => {
    const params = new URLSearchParams("text=Just some random text without links&title=Note");
    const payload = extractSharedPayload(params);
    expect(payload.targetUrl).toBeNull();
    expect(payload.title).toBe("Note");
  });

  it("derives title from text when title parameter is missing", () => {
    const params = new URLSearchParams(
      "text=Awesome Site https://awesomesite.com"
    );
    const payload = extractSharedPayload(params);
    expect(payload.targetUrl).toBe("https://awesomesite.com");
    expect(payload.title).toBe("Awesome Site");
  });
});
