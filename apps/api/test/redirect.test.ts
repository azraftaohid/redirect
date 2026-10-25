import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import worker from "../src/index.js";
import type { Env } from "../src/types.js";

async function fetchWorker(
  input: string | Request,
  init?: RequestInit,
  envOverrides?: Partial<Env>
) {
  const req = typeof input === "string" ? new Request(input, init) : input;
  const currentEnv = envOverrides ? { ...env, ...envOverrides } : env;
  const ctx = createExecutionContext();
  const res = await worker.fetch(req, currentEnv, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

describe("Redirect Engine (/:slug)", () => {
  let authToken: string;

  beforeEach(async () => {
    // Clear database
    await env.DB.exec("DELETE FROM link_daily_dims;");
    await env.DB.exec("DELETE FROM link_daily_clicks;");
    await env.DB.exec("DELETE FROM links;");

    // Bootstrap token
    await fetchWorker("https://redirect.example.com/api/v1/auth/verify");
    authToken = (await env.AUTH_TOKENS.get("initial_token"))!;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function createLink(data: {
    slug: string;
    targetUrl: string;
    statusCode?: number;
    forwardQuery?: boolean;
    isActive?: boolean;
    expiresAt?: string | null;
  }) {
    const res = await fetchWorker("https://redirect.example.com/api/v1/links", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${authToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(data),
    });
    return (await res.json()) as { id: string; slug: string };
  }

  it("redirects with default 307 and Cache-Control: no-store", async () => {
    await createLink({
      slug: "default307",
      targetUrl: "https://example.com/target-default",
    });

    const res = await fetchWorker("https://redirect.example.com/default307", {
      redirect: "manual",
    });

    expect(res.status).toBe(307);
    expect(res.headers.get("Location")).toBe("https://example.com/target-default");
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });

  it("redirects with 301 and 308 with private, max-age=3600; 302 with no-store", async () => {
    await createLink({
      slug: "perm301",
      targetUrl: "https://example.com/target-301",
      statusCode: 301,
    });
    await createLink({
      slug: "perm308",
      targetUrl: "https://example.com/target-308",
      statusCode: 308,
    });
    await createLink({
      slug: "temp302",
      targetUrl: "https://example.com/target-302",
      statusCode: 302,
    });

    const res301 = await fetchWorker("https://redirect.example.com/perm301", {
      redirect: "manual",
    });
    expect(res301.status).toBe(301);
    expect(res301.headers.get("Cache-Control")).toBe("private, max-age=3600");

    const res308 = await fetchWorker("https://redirect.example.com/perm308", {
      redirect: "manual",
    });
    expect(res308.status).toBe(308);
    expect(res308.headers.get("Cache-Control")).toBe("private, max-age=3600");

    const res302 = await fetchWorker("https://redirect.example.com/temp302", {
      redirect: "manual",
    });
    expect(res302.status).toBe(302);
    expect(res302.headers.get("Cache-Control")).toBe("no-store");
  });

  it("handles query merging accurately across all specified edge cases", async () => {
    // 1. No target query
    await createLink({
      slug: "noquery",
      targetUrl: "https://example.com/dest",
    });
    const res1 = await fetchWorker("https://redirect.example.com/noquery?utm_source=newsletter", {
      redirect: "manual",
    });
    expect(res1.headers.get("Location")).toBe("https://example.com/dest?utm_source=newsletter");

    // 2. Existing target query preserved byte-for-byte including %20 and +
    await createLink({
      slug: "rawquery",
      targetUrl: "https://example.com/search?q=hello%20world+test&fixed=1",
    });
    const res2 = await fetchWorker("https://redirect.example.com/rawquery?new_param=true", {
      redirect: "manual",
    });
    expect(res2.headers.get("Location")).toBe(
      "https://example.com/search?q=hello%20world+test&fixed=1&new_param=true"
    );

    // 3. Duplicate incoming keys kept
    await createLink({
      slug: "dupincoming",
      targetUrl: "https://example.com/filter",
    });
    const res3 = await fetchWorker("https://redirect.example.com/dupincoming?tag=js&tag=ts", {
      redirect: "manual",
    });
    expect(res3.headers.get("Location")).toBe("https://example.com/filter?tag=js&tag=ts");

    // 4. Target-defined key wins (incoming shadowed keys discarded)
    await createLink({
      slug: "targetwins",
      targetUrl: "https://example.com/app?role=admin&version=1",
    });
    const res4 = await fetchWorker(
      "https://redirect.example.com/targetwins?role=guest&extra=2&version=99",
      { redirect: "manual" }
    );
    expect(res4.headers.get("Location")).toBe(
      "https://example.com/app?role=admin&version=1&extra=2"
    );

    // 5. Fragment preserved at the end
    await createLink({
      slug: "fragment",
      targetUrl: "https://example.com/doc?v=2#chapter-3",
    });
    const res5 = await fetchWorker("https://redirect.example.com/fragment?read=true", {
      redirect: "manual",
    });
    expect(res5.headers.get("Location")).toBe("https://example.com/doc?v=2&read=true#chapter-3");

    // 6. forwardQuery: false returns target unchanged
    await createLink({
      slug: "noforward",
      targetUrl: "https://example.com/static-dest?k=1",
      forwardQuery: false,
    });
    const res6 = await fetchWorker("https://redirect.example.com/noforward?extra=incoming", {
      redirect: "manual",
    });
    expect(res6.headers.get("Location")).toBe("https://example.com/static-dest?k=1");
  });

  it("handles unknown, inactive, and expired slugs with 404 page or FALLBACK_URL", async () => {
    await createLink({
      slug: "inactive-link",
      targetUrl: "https://example.com/inactive",
      isActive: false,
    });
    await createLink({
      slug: "expired-link",
      targetUrl: "https://example.com/expired",
      expiresAt: "2020-01-01T00:00:00.000Z",
    });

    // Without FALLBACK_URL: returns 404
    const resUnknown = await fetchWorker("https://redirect.example.com/not-found-slug", {
      redirect: "manual",
    });
    expect(resUnknown.status).toBe(404);
    const bodyUnknown = await resUnknown.text();
    expect(bodyUnknown).toContain("404 Not Found");

    const resInactive = await fetchWorker("https://redirect.example.com/inactive-link", {
      redirect: "manual",
    });
    expect(resInactive.status).toBe(404);

    const resExpired = await fetchWorker("https://redirect.example.com/expired-link", {
      redirect: "manual",
    });
    expect(resExpired.status).toBe(404);

    // With FALLBACK_URL: redirects 307 with Cache-Control: no-store
    const fallbackEnv = { FALLBACK_URL: "https://fallback.example.org/home" };

    const resUnknownFallback = await fetchWorker(
      "https://redirect.example.com/not-found-slug",
      { redirect: "manual" },
      fallbackEnv
    );
    expect(resUnknownFallback.status).toBe(307);
    expect(resUnknownFallback.headers.get("Location")).toBe("https://fallback.example.org/home");
    expect(resUnknownFallback.headers.get("Cache-Control")).toBe("no-store");

    const resInactiveFallback = await fetchWorker(
      "https://redirect.example.com/inactive-link",
      { redirect: "manual" },
      fallbackEnv
    );
    expect(resInactiveFallback.status).toBe(307);
    expect(resInactiveFallback.headers.get("Location")).toBe("https://fallback.example.org/home");

    const resExpiredFallback = await fetchWorker(
      "https://redirect.example.com/expired-link",
      { redirect: "manual" },
      fallbackEnv
    );
    expect(resExpiredFallback.status).toBe(307);
    expect(resExpiredFallback.headers.get("Location")).toBe("https://fallback.example.org/home");
  });

  it("ignores a FALLBACK_URL on the same host to prevent redirect loops (returns 404)", async () => {
    const res = await fetchWorker(
      "https://redirect.example.com/unknown-slug",
      { redirect: "manual" },
      { FALLBACK_URL: "https://redirect.example.com/loop-target" }
    );
    expect(res.status).toBe(404);
  });

  it("returns 405 Method Not Allowed with Allow header for non-GET/HEAD methods on slugs", async () => {
    await createLink({
      slug: "method-test",
      targetUrl: "https://example.com/method",
    });

    const resPost = await fetchWorker("https://redirect.example.com/method-test", {
      method: "POST",
    });
    expect(resPost.status).toBe(405);
    expect(resPost.headers.get("Allow")).toBe("GET, HEAD");

    const resPut = await fetchWorker("https://redirect.example.com/method-test", {
      method: "PUT",
    });
    expect(resPut.status).toBe(405);
    expect(resPut.headers.get("Allow")).toBe("GET, HEAD");

    const resDelete = await fetchWorker("https://redirect.example.com/method-test", {
      method: "DELETE",
    });
    expect(resDelete.status).toBe(405);
    expect(resDelete.headers.get("Allow")).toBe("GET, HEAD");

    // HEAD request is allowed and redirects with headers
    const resHead = await fetchWorker("https://redirect.example.com/method-test", {
      method: "HEAD",
      redirect: "manual",
    });
    expect(resHead.status).toBe(307);
    expect(resHead.headers.get("Location")).toBe("https://example.com/method");
  });

  it("returns 404 for percent-encoded slugs", async () => {
    const resSpace = await fetchWorker("https://redirect.example.com/foo%20bar", {
      redirect: "manual",
    });
    expect(resSpace.status).toBe(404);

    const resSlash = await fetchWorker("https://redirect.example.com/foo%2Fbar", {
      redirect: "manual",
    });
    expect(resSlash.status).toBe(404);
  });

  it("returns 503 plain text when D1 lookup fails (never 404)", async () => {
    const prepareSpy = vi.spyOn(env.DB, "prepare").mockImplementationOnce(() => {
      throw new Error("D1 connection lost");
    });

    const res = await fetchWorker("https://redirect.example.com/any-slug", {
      redirect: "manual",
    });

    expect(res.status).toBe(503);
    expect(res.headers.get("Content-Type")).toContain("text/plain");
    const text = await res.text();
    expect(text).toContain("Service Unavailable");

    prepareSpy.mockRestore();
  });
});
