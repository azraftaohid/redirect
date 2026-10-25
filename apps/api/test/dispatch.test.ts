import { describe, it, expect } from "vitest";
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
    expect(htmlRoot).toContain("<title>Redirect App</title>");
    expect(resRoot.headers.get("Content-Security-Policy")).toBe(
      APP_SECURITY_HEADERS["Content-Security-Policy"]
    );
    expect(resRoot.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(resRoot.headers.get("Referrer-Policy")).toBe("no-referrer");

    // 2. Deep client-side SPA route: /app/some/deep/route
    const resDeep = await fetchWorker("https://redirect.example.com/app/some/deep/route");
    expect(resDeep.status).toBe(200);
    const htmlDeep = await resDeep.text();
    expect(htmlDeep).toContain("<title>Redirect App</title>");
    expect(resDeep.headers.get("Content-Security-Policy")).toBe(
      APP_SECURITY_HEADERS["Content-Security-Policy"]
    );
    expect(resDeep.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(resDeep.headers.get("Referrer-Policy")).toBe("no-referrer");
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

  it("returns JSON 404 for unknown /api/* routes", async () => {
    const resApi = await fetchWorker("https://redirect.example.com/api/unknown");
    expect(resApi.status).toBe(404);
    expect(resApi.headers.get("Content-Type")).toContain("application/json");
    expect(resApi.headers.get("Cache-Control")).toBe("no-store");
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
});
