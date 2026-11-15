import { describe, it, expect, vi } from "vitest";
import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import worker from "../src/index.js";
import { APP_SECURITY_HEADERS } from "../src/routes/app.js";
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

describe("Request Dispatcher & App Serving", () => {
  it("handles '/' with fallback URL (307) or 404 page", async () => {
    // 1. Without FALLBACK_URL -> 404
    const resNoFallback = await fetchWorker("https://redirect.example.com/", {
      redirect: "manual",
    });
    expect(resNoFallback.status).toBe(404);
    const body = await resNoFallback.text();
    expect(body).toContain("404 Not Found");

    // 2. With FALLBACK_URL -> 307
    const resFallback = await fetchWorker(
      "https://redirect.example.com/",
      { redirect: "manual" },
      { FALLBACK_URL: "https://external.example.org/home" }
    );
    expect(resFallback.status).toBe(307);
    expect(resFallback.headers.get("Location")).toBe("https://external.example.org/home");
    expect(resFallback.headers.get("Cache-Control")).toBe("no-store");
  });

  it("redirects '/app' with 308 to '/app/' preserving query parameters", async () => {
    const resNoQuery = await fetchWorker("https://redirect.example.com/app", {
      redirect: "manual",
    });
    expect(resNoQuery.status).toBe(308);
    expect(resNoQuery.headers.get("Location")).toBe("https://redirect.example.com/app/");

    const resWithQuery = await fetchWorker("https://redirect.example.com/app?tab=links&page=2", {
      redirect: "manual",
    });
    expect(resWithQuery.status).toBe(308);
    expect(resWithQuery.headers.get("Location")).toBe(
      "https://redirect.example.com/app/?tab=links&page=2"
    );
  });

  it("serves the SPA index placeholder for '/app/' and deep routes with status 200 and security headers", async () => {
    // 1. Root of app: /app/
    const resRoot = await fetchWorker("https://redirect.example.com/app/");
    expect(resRoot.status).toBe(200);
    const htmlRoot = await resRoot.text();
    expect(htmlRoot).toContain("<title>Redirect");
    expect(htmlRoot).toContain('<div id="root">');
    expect(resRoot.headers.get("Content-Security-Policy")).toBe(
      APP_SECURITY_HEADERS["Content-Security-Policy"]
    );
    expect(resRoot.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(resRoot.headers.get("Referrer-Policy")).toBe("no-referrer");
    expect(resRoot.headers.get("X-Robots-Tag")).toBe("noindex, nofollow");

    // 2. Deep client-side SPA route: /app/some/deep/route
    const resDeep = await fetchWorker("https://redirect.example.com/app/some/deep/route");
    expect(resDeep.status).toBe(200);
    const htmlDeep = await resDeep.text();
    expect(htmlDeep).toContain("<title>Redirect");
    expect(htmlDeep).toContain('<div id="root">');
    expect(resDeep.headers.get("Content-Security-Policy")).toBe(
      APP_SECURITY_HEADERS["Content-Security-Policy"]
    );
    expect(resDeep.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(resDeep.headers.get("Referrer-Policy")).toBe("no-referrer");
    expect(resDeep.headers.get("X-Robots-Tag")).toBe("noindex, nofollow");

    // 3. Conditional request on /app/ carries 304 if ETag matches (B2/R1.4)
    const etag = resRoot.headers.get("ETag");
    if (etag) {
      const res304 = await fetchWorker("https://redirect.example.com/app/", {
        headers: { "If-None-Match": etag },
      });
      expect(res304.status).toBe(304);
      expect(res304.headers.get("X-Robots-Tag")).toBe("noindex, nofollow");
      expect(res304.headers.get("Content-Security-Policy")).toBe(
        APP_SECURITY_HEADERS["Content-Security-Policy"]
      );
    }
  });

  it("short-circuits reserved slugs like /APP without hitting D1 (R3.6)", async () => {
    const prepareSpy = vi.spyOn(env.DB, "prepare");
    try {
      const res = await fetchWorker("https://redirect.example.com/APP");
      expect(res.status).toBe(404);
      expect(prepareSpy).not.toHaveBeenCalled();
    } finally {
      prepareSpy.mockRestore();
    }
  });

  it("returns 404 for missing static files under '/app/' with security headers", async () => {
    const resMissing = await fetchWorker("https://redirect.example.com/app/missing.js");
    expect(resMissing.status).toBe(404);
    expect(resMissing.headers.get("Content-Security-Policy")).toBe(
      APP_SECURITY_HEADERS["Content-Security-Policy"]
    );
    expect(resMissing.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(resMissing.headers.get("Referrer-Policy")).toBe("no-referrer");
  });

  it("returns JSON 404 for unknown /api/* routes with security headers", async () => {
    const resApi = await fetchWorker("https://redirect.example.com/api/unknown");
    expect(resApi.status).toBe(404);
    expect(resApi.headers.get("Content-Type")).toContain("application/json");
    expect(resApi.headers.get("Cache-Control")).toBe("no-store");
    expect(resApi.headers.get("X-Robots-Tag")).toBe("noindex, nofollow");
    expect(resApi.headers.get("X-Content-Type-Options")).toBe("nosniff");
    const json = (await resApi.json()) as any;
    expect(json.error.code).toBe("not_found");

    const resApiRoot = await fetchWorker("https://redirect.example.com/api");
    expect(resApiRoot.status).toBe(404);
    expect(resApiRoot.headers.get("Content-Type")).toContain("application/json");
  });

  it("returns 404 for /favicon.ico when missing from assets", async () => {
    const res = await fetchWorker("https://redirect.example.com/favicon.ico");
    expect(res.status).toBe(404);
  });

  it("returns 404 for multi-segment unknown paths", async () => {
    const res = await fetchWorker("https://redirect.example.com/multi/segment/unknown/path");
    expect(res.status).toBe(404);
  });

  it("carries X-Robots-Tag and X-Content-Type-Options on API v1 routes", async () => {
    const res = await fetchWorker("https://redirect.example.com/api/v1/links");
    expect(res.headers.get("X-Robots-Tag")).toBe("noindex, nofollow");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });

  it("returns 404 page for unknown slug with no-store and no links to /app/ (R7.2)", async () => {
    const res = await fetchWorker("https://redirect.example.com/unknown-dead-link");
    expect(res.status).toBe(404);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("Referrer-Policy")).toBe("no-referrer");
    expect(res.headers.get("X-Frame-Options")).toBe("DENY");
    expect(res.headers.get("Content-Security-Policy")).toBe(
      "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
    );
    const body = await res.text();
    expect(body).toContain("404 Not Found");
    expect(body).not.toContain("/app");
  });

  it("sets COOP and Permissions-Policy on /app/ and nosniff/no-referrer on /app 308 redirect", async () => {
    const resApp = await fetchWorker("https://redirect.example.com/app/");
    expect(resApp.status).toBe(200);
    expect(resApp.headers.get("Cross-Origin-Opener-Policy")).toBe("same-origin");
    expect(resApp.headers.get("Permissions-Policy")).toBe(
      "camera=(), microphone=(), geolocation=()"
    );

    const resRedirect = await fetchWorker("https://redirect.example.com/app", {
      redirect: "manual",
    });
    expect(resRedirect.status).toBe(308);
    expect(resRedirect.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(resRedirect.headers.get("Referrer-Policy")).toBe("no-referrer");
  });
});
