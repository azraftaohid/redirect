import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  AUTH_TOKEN_STORAGE_KEY,
  AUTH_TOKEN_SET_AT_STORAGE_KEY,
  getStoredToken,
  getStoredTokenSetAt,
  setStoredToken,
  clearStoredToken,
  ApiClientError,
  AccessSessionExpiredError,
  ImportChunkError,
  exportAllLinks,
  importLinksChunked,
} from "../src/api/client";
import { parseImportEnvelope } from "../src/utils/transfer";

describe("API client & storage", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("stores and retrieves token with timestamp", () => {
    expect(getStoredToken()).toBeNull();
    expect(getStoredTokenSetAt()).toBe(0);

    const before = Date.now();
    setStoredToken("test_secret_token_123");
    const after = Date.now();

    expect(getStoredToken()).toBe("test_secret_token_123");
    expect(localStorage.getItem(AUTH_TOKEN_STORAGE_KEY)).toBe("test_secret_token_123");
    const setAt = getStoredTokenSetAt();
    expect(localStorage.getItem(AUTH_TOKEN_SET_AT_STORAGE_KEY)).toBe(String(setAt));
    expect(setAt).toBeGreaterThanOrEqual(before);
    expect(setAt).toBeLessThanOrEqual(after);
  });

  it("clears stored token and timestamp", () => {
    setStoredToken("sample_token");
    expect(getStoredToken()).toBe("sample_token");

    clearStoredToken();
    expect(getStoredToken()).toBeNull();
    expect(getStoredTokenSetAt()).toBe(0);
  });

  it("creates ApiClientError with status and code", () => {
    const err = new ApiClientError(404, "not_found", "Link was not found", { id: "123" });
    expect(err.name).toBe("ApiClientError");
    expect(err.status).toBe(404);
    expect(err.code).toBe("not_found");
    expect(err.message).toBe("Link was not found");
    expect(err.details).toEqual({ id: "123" });
  });

  it("creates AccessSessionExpiredError and dispatches redirect:access-expired event", () => {
    let eventReceived = false;
    const listener = () => {
      eventReceived = true;
    };
    window.addEventListener("redirect:access-expired", listener);

    const err = new AccessSessionExpiredError("Custom session message");
    expect(err.name).toBe("AccessSessionExpiredError");
    expect(err.message).toBe("Custom session message");
    expect(eventReceived).toBe(true);

    window.removeEventListener("redirect:access-expired", listener);
  });

  it("exportAllLinks follows pagination.nextCursor across chunks and merges links", async () => {
    setStoredToken("rdir_test_token");
    const fetchMock = vi.spyOn(globalThis, "fetch");

    fetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            version: 1,
            exportedAt: "2026-11-13T19:00:00.000Z",
            count: 2,
            links: [
              {
                slug: "a",
                targetUrl: "https://example.com/a",
                title: null,
                statusCode: 307,
                tags: [],
                isActive: true,
                forwardQuery: true,
                expiresAt: null,
                createdAt: "2026-11-13T18:00:00.000Z",
                updatedAt: "2026-11-13T18:00:00.000Z",
              },
              {
                slug: "b",
                targetUrl: "https://example.com/b",
                title: null,
                statusCode: 307,
                tags: [],
                isActive: true,
                forwardQuery: true,
                expiresAt: null,
                createdAt: "2026-11-13T18:01:00.000Z",
                updatedAt: "2026-11-13T18:01:00.000Z",
              },
            ],
            pagination: {
              limit: 2,
              nextCursor: "cur-1",
              hasMore: true,
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            version: 1,
            exportedAt: "2026-11-13T19:00:01.000Z",
            count: 1,
            links: [
              {
                slug: "c",
                targetUrl: "https://example.com/c",
                title: null,
                statusCode: 301,
                tags: ["promo"],
                isActive: false,
                forwardQuery: false,
                expiresAt: null,
                createdAt: "2026-11-13T18:02:00.000Z",
                updatedAt: "2026-11-13T18:02:00.000Z",
              },
            ],
            pagination: {
              limit: 2,
              nextCursor: null,
              hasMore: false,
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      );

    const progressUpdates: number[] = [];
    const envelope = await exportAllLinks({
      limitPerChunk: 2,
      tag: "promo",
      onProgress: (count) => progressUpdates.push(count),
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe("/api/v1/links/export?limit=2&tag=promo");
    expect(String(fetchMock.mock.calls[1]?.[0])).toBe(
      "/api/v1/links/export?limit=2&cursor=cur-1&tag=promo"
    );
    expect(envelope.version).toBe(1);
    expect(envelope.count).toBe(3);
    expect(envelope.links.map((l) => l.slug)).toEqual(["a", "b", "c"]);
    expect(progressUpdates).toEqual([2, 3]);
  });

  it("importLinksChunked splits batches, offsets indices, and aggregates skippedSlugs", async () => {
    setStoredToken("rdir_test_token");
    const fetchMock = vi.spyOn(globalThis, "fetch");

    fetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            version: 1,
            onConflict: "skip",
            summary: { total: 2, created: 1, updated: 0, skipped: 1, failed: 0 },
            skippedSlugs: ["dup-slug"],
            createdSlugs: ["ok-1"],
            updatedSlugs: [],
            errors: [],
            results: [
              { index: 0, slug: "ok-1", status: "created", id: "id-1" },
              { index: 1, slug: "dup-slug", status: "skipped", reason: "slug_exists" },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            version: 1,
            onConflict: "skip",
            summary: { total: 1, created: 0, updated: 0, skipped: 0, failed: 1 },
            skippedSlugs: [],
            createdSlugs: [],
            updatedSlugs: [],
            errors: [
              {
                index: 0,
                slug: "bad-url",
                code: "invalid_target_url",
                message: "Target URL is not valid",
              },
            ],
            results: [
              {
                index: 0,
                slug: "bad-url",
                status: "failed",
                reason: "Target URL is not valid",
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      );

    const progressUpdates: Array<[number, number]> = [];
    const res = await importLinksChunked(
      [
        { slug: "ok-1", targetUrl: "https://example.com/1" },
        { slug: "dup-slug", targetUrl: "https://example.com/2" },
        { slug: "bad-url", targetUrl: "https://example.com/3" },
      ],
      {
        chunkSize: 2,
        onProgress: (processed, total) => progressUpdates.push([processed, total]),
      }
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(res.onConflict).toBe("skip");
    expect(res.summary).toEqual({
      total: 3,
      created: 1,
      updated: 0,
      skipped: 1,
      failed: 1,
    });
    expect(res.skippedSlugs).toEqual(["dup-slug"]);
    expect(res.createdSlugs).toEqual(["ok-1"]);
    expect(res.errors).toEqual([
      {
        index: 2,
        slug: "bad-url",
        code: "invalid_target_url",
        message: "Target URL is not valid",
      },
    ]);
    expect(res.results.map((r) => r.index)).toEqual([0, 1, 2]);
    expect(progressUpdates).toEqual([
      [2, 3],
      [3, 3],
    ]);
  });

  it("parseImportEnvelope validates versioned JSON import files", () => {
    const invalidJson = parseImportEnvelope("{not-json");
    expect(invalidJson.ok).toBe(false);

    const nonObject = parseImportEnvelope("null");
    expect(nonObject.ok).toBe(false);

    const missingLinksArray = parseImportEnvelope(
      JSON.stringify({ version: 1, links: "invalid" })
    );
    expect(missingLinksArray.ok).toBe(false);

    const emptyLinks = parseImportEnvelope(JSON.stringify({ version: 1, links: [] }));
    expect(emptyLinks.ok).toBe(false);

    const valid = parseImportEnvelope(
      JSON.stringify({
        version: 1,
        links: [{ slug: "go", targetUrl: "https://example.com" }],
      })
    );
    expect(valid).toEqual({
      ok: true,
      links: [{ slug: "go", targetUrl: "https://example.com" }],
    });

    const wrongVersion = parseImportEnvelope(
      JSON.stringify({
        version: 2,
        links: [{ slug: "go", targetUrl: "https://example.com" }],
      })
    );
    expect(wrongVersion.ok).toBe(false);
  });

  it("exportAllLinks throws when maxPages is reached while more pages remain", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(
      async () =>
        new Response(
          JSON.stringify({
            version: 1,
            exportedAt: "2026-11-13T00:00:00.000Z",
            count: 1,
            links: [
              {
                slug: "page-item",
                targetUrl: "https://example.com",
                title: null,
                statusCode: 307,
                tags: [],
                isActive: true,
                forwardQuery: true,
                expiresAt: null,
                createdAt: "2026-11-13T00:00:00.000Z",
                updatedAt: "2026-11-13T00:00:00.000Z",
              },
            ],
            pagination: { limit: 1, nextCursor: "cursor-next", hasMore: true },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
    );

    await expect(exportAllLinks({ maxPages: 2 })).rejects.toThrow(
      /maximum page limit/i
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("importLinksChunked handles empty input, clamps chunkSize, and throws ImportChunkError on mid-import failure", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    const emptyRes = await importLinksChunked([]);
    expect(emptyRes.summary).toEqual({
      total: 0,
      created: 0,
      updated: 0,
      skipped: 0,
      failed: 0,
    });
    expect(fetchMock).not.toHaveBeenCalled();

    // Clamp chunkSize to server max (500)
    fetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            version: 1,
            onConflict: "skip",
            summary: { total: 500, created: 500, updated: 0, skipped: 0, failed: 0 },
            skippedSlugs: [],
            createdSlugs: [],
            updatedSlugs: [],
            errors: [],
            results: [],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            version: 1,
            onConflict: "skip",
            summary: { total: 1, created: 1, updated: 0, skipped: 0, failed: 0 },
            skippedSlugs: [],
            createdSlugs: ["item-500"],
            updatedSlugs: [],
            errors: [],
            results: [{ index: 0, slug: "item-500", status: "created", id: "id-500" }],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      );

    const oversizedBatch = Array.from({ length: 501 }, (_, i) => ({
      slug: `item-${i}`,
      targetUrl: `https://example.com/${i}`,
    }));
    const clampedRes = await importLinksChunked(oversizedBatch, { chunkSize: 1000 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(clampedRes.summary.created).toBe(501);

    // Mid-import failure preserves chunk 1's committed progress in ImportChunkError
    fetchMock.mockReset();
    fetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            version: 1,
            onConflict: "overwrite",
            summary: { total: 1, created: 1, updated: 0, skipped: 0, failed: 0 },
            skippedSlugs: [],
            createdSlugs: ["first-ok"],
            updatedSlugs: [],
            errors: [],
            results: [{ index: 0, slug: "first-ok", status: "created", id: "id-1" }],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: { code: "internal_error", message: "Worker timeout" },
          }),
          { status: 500, headers: { "Content-Type": "application/json" } }
        )
      );

    let caught: unknown;
    try {
      await importLinksChunked(
        [
          { slug: "first-ok", targetUrl: "https://example.com/1" },
          { slug: "second-fail", targetUrl: "https://example.com/2" },
        ],
        { onConflict: "overwrite", chunkSize: 0 }
      );
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(ImportChunkError);
    const chunkErr = caught as ImportChunkError;
    expect(chunkErr.message).toMatch(/chunk 2\/2/i);
    expect(chunkErr.partialResponse.summary).toEqual({
      total: 1,
      created: 1,
      updated: 0,
      skipped: 0,
      failed: 0,
    });
    expect(chunkErr.partialResponse.createdSlugs).toEqual(["first-ok"]);
  });
});
