import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import worker from "../src/index.js";
import { recordClick } from "../src/utils/analytics.js";
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

describe("Analytics & Click Recording", () => {
  let authToken: string;
  let testLinkId: string;
  let testLinkSlug: string;

  beforeEach(async () => {
    // Clear database
    await env.DB.exec("DELETE FROM link_daily_dims;");
    await env.DB.exec("DELETE FROM link_daily_clicks;");
    await env.DB.exec("DELETE FROM links;");

    // Bootstrap token
    await fetchWorker("https://redirect.example.com/api/v1/auth/verify");
    authToken = (await env.AUTH_TOKENS.get("initial_token"))!;

    // Create a standard link for tests
    const res = await fetchWorker("https://redirect.example.com/api/v1/links", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${authToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        slug: "analytics-link",
        targetUrl: "https://example.com/analytics-dest",
      }),
    });
    const link = (await res.json()) as { id: string; slug: string };
    testLinkId = link.id;
    testLinkSlug = link.slug;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("strictly complies with the D1 cost budget: 2 rows written by default, 3 with country, 4 with country,referrer", async () => {
    const req = new Request("https://redirect.example.com/test", {
      headers: { Referer: "https://sub.twitter.com/post/123?auth=secret" },
    });

    // 1. Default (no dimensions enabled)
    const envDefault = { ...env, ANALYTICS_DIMENSIONS: "" };
    const resDefault = await recordClick(envDefault, testLinkId, req);
    const rowsDefault = resDefault.reduce((acc, r) => acc + (r.meta.rows_written ?? 0), 0);
    expect(rowsDefault).toBe(2);

    // 2. With country enabled
    const envCountry = { ...env, ANALYTICS_DIMENSIONS: "country" };
    const resCountry = await recordClick(envCountry, testLinkId, req);
    const rowsCountry = resCountry.reduce((acc, r) => acc + (r.meta.rows_written ?? 0), 0);
    expect(rowsCountry).toBe(3);

    // 3. With both country and referrer enabled
    const envBoth = { ...env, ANALYTICS_DIMENSIONS: "country,referrer" };
    const resBoth = await recordClick(envBoth, testLinkId, req);
    const rowsBoth = resBoth.reduce((acc, r) => acc + (r.meta.rows_written ?? 0), 0);
    expect(rowsBoth).toBe(4);
  });

  it("increments click_count, updates last_clicked_at, and writes daily rollup on counted GET", async () => {
    const res = await fetchWorker(`https://redirect.example.com/${testLinkSlug}`, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
      redirect: "manual",
    });
    expect(res.status).toBe(307);

    const today = new Date().toISOString().slice(0, 10);

    const link = await env.DB.prepare(
      "SELECT click_count, last_clicked_at FROM links WHERE id = ?"
    )
      .bind(testLinkId)
      .first<{ click_count: number; last_clicked_at: string | null }>();

    expect(link?.click_count).toBe(1);
    expect(link?.last_clicked_at).toBeTruthy();

    const daily = await env.DB.prepare(
      "SELECT clicks FROM link_daily_clicks WHERE link_id = ? AND day = ?"
    )
      .bind(testLinkId, today)
      .first<{ clicks: number }>();
    expect(daily?.clicks).toBe(1);
  });

  it("redirects without counting for HEAD, bots, empty UA, and prefetch requests", async () => {
    // 1. HEAD request
    const headRes = await fetchWorker(`https://redirect.example.com/${testLinkSlug}`, {
      method: "HEAD",
      redirect: "manual",
    });
    expect(headRes.status).toBe(307);

    // 2. Empty User-Agent (R6)
    const emptyUaRes = await fetchWorker(`https://redirect.example.com/${testLinkSlug}`, {
      headers: { "User-Agent": "" },
      redirect: "manual",
    });
    expect(emptyUaRes.status).toBe(307);

    // 3. Extended Bot User-Agents (R6)
    const botUas = [
      "Googlebot/2.1 (+http://www.google.com/bot.html)",
      "Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)",
      "curl/7.88.1",
      "python-requests/2.31.0",
      "Mastodon/4.2.0",
      "UptimeRobot/2.0",
      "undici",
      "axios/1.6.0",
    ];

    for (const ua of botUas) {
      const botRes = await fetchWorker(`https://redirect.example.com/${testLinkSlug}`, {
        headers: { "User-Agent": ua },
        redirect: "manual",
      });
      expect(botRes.status).toBe(307);
    }

    // 4. Prefetch / Prerender headers
    const prefetchRes = await fetchWorker(`https://redirect.example.com/${testLinkSlug}`, {
      headers: {
        "User-Agent": "Mozilla/5.0 Chrome",
        "Sec-Purpose": "prefetch",
      },
      redirect: "manual",
    });
    expect(prefetchRes.status).toBe(307);

    const prerenderRes = await fetchWorker(`https://redirect.example.com/${testLinkSlug}`, {
      headers: {
        "User-Agent": "Mozilla/5.0 Chrome",
        Purpose: "prerender",
      },
      redirect: "manual",
    });
    expect(prerenderRes.status).toBe(307);

    // Verify click_count remains 0
    const link = await env.DB.prepare("SELECT click_count FROM links WHERE id = ?")
      .bind(testLinkId)
      .first<{ click_count: number }>();
    expect(link?.click_count).toBe(0);
  });

  it("counts in-app browsers used by real people (R6)", async () => {
    const inAppUas = [
      "Mozilla/5.0 (iPhone; CPU iPhone OS 16_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 289.0.0.25.49",
      "Mozilla/5.0 (iPhone; CPU iPhone OS 15_4 like Mac OS X) AppleWebKit/605.1.15 [FBAN/FBIOS;FBAV/365.0.0.30.112]",
      "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) Twitter for iPhone",
    ];

    for (const ua of inAppUas) {
      const res = await fetchWorker(`https://redirect.example.com/${testLinkSlug}`, {
        headers: { "User-Agent": ua },
        redirect: "manual",
      });
      expect(res.status).toBe(307);
    }

    const link = await env.DB.prepare("SELECT click_count FROM links WHERE id = ?")
      .bind(testLinkId)
      .first<{ click_count: number }>();
    expect(link?.click_count).toBe(inAppUas.length);
  });

  it("writes nothing when ANALYTICS_ENABLED is 'false'", async () => {
    const disabledEnv = { ANALYTICS_ENABLED: "false" };

    const req = new Request("https://redirect.example.com/test", {
      headers: { "User-Agent": "Mozilla/5.0 Chrome" },
    });
    const results = await recordClick({ ...env, ...disabledEnv }, testLinkId, req);
    expect(results).toEqual([]);

    const res = await fetchWorker(
      `https://redirect.example.com/${testLinkSlug}`,
      {
        headers: { "User-Agent": "Mozilla/5.0 Chrome" },
        redirect: "manual",
      },
      disabledEnv
    );
    expect(res.status).toBe(307);

    const link = await env.DB.prepare("SELECT click_count FROM links WHERE id = ?")
      .bind(testLinkId)
      .first<{ click_count: number }>();
    expect(link?.click_count).toBe(0);
  });

  it("does not change redirect response when an analytics batch fails", async () => {
    vi.spyOn(env.DB, "batch").mockRejectedValueOnce(new Error("D1 internal batch error"));

    const res = await fetchWorker(`https://redirect.example.com/${testLinkSlug}`, {
      headers: { "User-Agent": "Mozilla/5.0 Chrome" },
      redirect: "manual",
    });
    expect(res.status).toBe(307);
    expect(res.headers.get("Location")).toBe("https://example.com/analytics-dest");
  });

  it("records sanitized dimension values: country defaults to XX, referrer stores only hostname or (direct)", async () => {
    const envBoth = { ...env, ANALYTICS_DIMENSIONS: "country,referrer" };

    // Request 1: Direct visit without referrer or CF country
    const reqDirect = new Request("https://redirect.example.com/test");
    await recordClick(envBoth, testLinkId, reqDirect);

    // Request 2: Visit with full referrer URL
    const reqReferrer = new Request("https://redirect.example.com/test", {
      headers: { Referer: "https://GitHub.com/user/project?token=secret123#readme" },
    });
    await recordClick(envBoth, testLinkId, reqReferrer);

    const dims = await env.DB.prepare(
      "SELECT dim, value, clicks FROM link_daily_dims WHERE link_id = ? ORDER BY dim, value"
    )
      .bind(testLinkId)
      .all<{ dim: string; value: string; clicks: number }>();

    expect(dims.results).toEqual([
      { dim: "country", value: "XX", clicks: 2 },
      { dim: "referrer", value: "(direct)", clicks: 1 },
      { dim: "referrer", value: "github.com", clicks: 1 },
    ]);
  });

  it("returns daily series and only enabled dimensions on /stats endpoint (R3.5)", async () => {
    const countryEnv = { ANALYTICS_DIMENSIONS: "country" };
    const req = new Request("https://redirect.example.com/test");
    await recordClick({ ...env, ...countryEnv }, testLinkId, req);

    const res = await fetchWorker(
      `https://redirect.example.com/api/v1/links/${testLinkId}/stats`,
      {
        headers: { Authorization: `Bearer ${authToken}` },
      },
      countryEnv
    );
    expect(res.status).toBe(200);

    const stats = (await res.json()) as any;
    expect(stats.link).toBeDefined();
    expect(stats.link.id).toBe(testLinkId);
    expect(stats.link.clickCount).toBe(1);
    expect(stats.daily.length).toBeGreaterThan(0);
    // Only "country" is in ANALYTICS_DIMENSIONS ("referrer" was disabled, so it must not be present in dimensions)
    expect(stats.dimensions).toBeDefined();
    expect(stats.dimensions.country).toBeDefined();
    expect(stats.dimensions.country).toEqual([{ value: "XX", clicks: 1 }]);
    expect(stats.dimensions.referrer).toBeUndefined();
  });
});
