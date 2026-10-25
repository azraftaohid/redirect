import { describe, it, expect, beforeEach } from "vitest";
import { env, SELF } from "cloudflare:test";

describe("Links API (/api/v1/links) & Stats (/api/v1/links/:id/stats)", () => {
  let authToken: string;

  beforeEach(async () => {
    // Clear database
    await env.DB.exec("DELETE FROM link_daily_dims;");
    await env.DB.exec("DELETE FROM link_daily_clicks;");
    await env.DB.exec("DELETE FROM links;");

    // Bootstrap token
    await SELF.fetch("https://redirect.example.com/api/v1/auth/verify");
    authToken = (await env.AUTH_TOKENS.get("initial_token"))!;
  });

  const authHeaders = (extra: Record<string, string> = {}) => ({
    Authorization: `Bearer ${authToken}`,
    "Content-Type": "application/json",
    ...extra,
  });

  it("creates a link with custom slug and verifies Cache-Control: no-store", async () => {
    const res = await SELF.fetch("https://redirect.example.com/api/v1/links", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        targetUrl: "https://example.com/destination",
        slug: "custom1",
        title: "Test Link",
        statusCode: 307,
        tags: ["Tech", "Docs"],
      }),
    });

    expect(res.status).toBe(201);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const link = (await res.json()) as any;
    expect(link.id).toBeDefined();
    expect(link.slug).toBe("custom1");
    expect(link.targetUrl).toBe("https://example.com/destination");
    expect(link.title).toBe("Test Link");
    expect(link.statusCode).toBe(307);
    expect(link.tags).toEqual(["tech", "docs"]);
    expect(link.isActive).toBe(true);
    expect(link.forwardQuery).toBe(true);
    expect(link.clickCount).toBe(0);
  });

  it("creates a link with auto-generated 6-character Base62 slug when slug is omitted", async () => {
    const res = await SELF.fetch("https://redirect.example.com/api/v1/links", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        targetUrl: "https://example.com/auto",
      }),
    });

    expect(res.status).toBe(201);
    const link = (await res.json()) as any;
    expect(link.slug).toMatch(/^[A-Za-z0-9_-]{6}$/);
  });

  it("enforces 409 slug_taken on duplicate custom slug", async () => {
    await SELF.fetch("https://redirect.example.com/api/v1/links", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        targetUrl: "https://example.com/1",
        slug: "duplicate",
      }),
    });

    const res2 = await SELF.fetch("https://redirect.example.com/api/v1/links", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        targetUrl: "https://example.com/2",
        slug: "duplicate",
      }),
    });

    expect(res2.status).toBe(409);
    const body = (await res2.json()) as any;
    expect(body.error.code).toBe("slug_taken");
  });

  it("coexists case-sensitive slugs ('docs' vs 'Docs')", async () => {
    const resLower = await SELF.fetch("https://redirect.example.com/api/v1/links", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        targetUrl: "https://example.com/lower",
        slug: "docs",
      }),
    });
    expect(resLower.status).toBe(201);

    const resUpper = await SELF.fetch("https://redirect.example.com/api/v1/links", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        targetUrl: "https://example.com/upper",
        slug: "Docs",
      }),
    });
    expect(resUpper.status).toBe(201);

    const lowerLink = (await resLower.json()) as any;
    const upperLink = (await resUpper.json()) as any;
    expect(lowerLink.slug).toBe("docs");
    expect(upperLink.slug).toBe("Docs");
  });

  it("supports slug rename, preserving statistics and rejecting collision", async () => {
    const createRes = await SELF.fetch("https://redirect.example.com/api/v1/links", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        targetUrl: "https://example.com/target",
        slug: "old-slug",
      }),
    });
    const link = (await createRes.json()) as any;

    // Simulate some click count
    await env.DB.prepare("UPDATE links SET click_count = 15 WHERE id = ?")
      .bind(link.id)
      .run();

    // Rename to another taken slug
    await SELF.fetch("https://redirect.example.com/api/v1/links", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        targetUrl: "https://example.com/other",
        slug: "already-taken",
      }),
    });

    const collisionRes = await SELF.fetch(
      `https://redirect.example.com/api/v1/links/${link.id}`,
      {
        method: "PATCH",
        headers: authHeaders(),
        body: JSON.stringify({ slug: "already-taken" }),
      }
    );
    expect(collisionRes.status).toBe(409);

    // Rename to identical current slug is no-op
    const noopRes = await SELF.fetch(
      `https://redirect.example.com/api/v1/links/${link.id}`,
      {
        method: "PATCH",
        headers: authHeaders(),
        body: JSON.stringify({ slug: "old-slug" }),
      }
    );
    expect(noopRes.status).toBe(200);

    // Successfully rename slug
    const renameRes = await SELF.fetch(
      `https://redirect.example.com/api/v1/links/${link.id}`,
      {
        method: "PATCH",
        headers: authHeaders(),
        body: JSON.stringify({ slug: "new-slug" }),
      }
    );
    expect(renameRes.status).toBe(200);
    const updated = (await renameRes.json()) as any;
    expect(updated.slug).toBe("new-slug");
    expect(updated.clickCount).toBe(15); // Statistics preserved

    // Old slug is immediately free in D1
    const oldSlugCheck = await env.DB.prepare("SELECT * FROM links WHERE slug = ?")
      .bind("old-slug")
      .first();
    expect(oldSlugCheck).toBeNull();
  });

  it("lists links with search (including literal % and _), tag filter, sorting, and pagination", async () => {
    // Seed 3 links
    const p1 = await SELF.fetch("https://redirect.example.com/api/v1/links", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        targetUrl: "https://example.com/discount_100%",
        slug: "sale-100",
        title: "100% discount",
        tags: ["promo", "summer"],
      }),
    });
    expect(p1.status).toBe(201);

    const p2 = await SELF.fetch("https://redirect.example.com/api/v1/links", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        targetUrl: "https://example.com/docs",
        slug: "manual_v1",
        title: "Developer Manual",
        tags: ["docs"],
      }),
    });
    expect(p2.status).toBe(201);

    const p3 = await SELF.fetch("https://redirect.example.com/api/v1/links", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        targetUrl: "https://example.com/blog",
        slug: "article",
        title: "Latest Article",
        tags: ["blog"],
      }),
    });
    expect(p3.status).toBe(201);

    // 1. Literal search with "%" (matches title and targetUrl)
    const searchRes = await SELF.fetch(
      "https://redirect.example.com/api/v1/links?search=100%25",
      { headers: authHeaders() }
    );
    expect(searchRes.status).toBe(200);
    const searchBody = (await searchRes.json()) as any;
    expect(searchBody.data).toHaveLength(1);
    expect(searchBody.data[0].slug).toBe("sale-100");

    // Literal search with "_" (matches manual_v1)
    const searchUnderscoreRes = await SELF.fetch(
      "https://redirect.example.com/api/v1/links?search=manual_",
      { headers: authHeaders() }
    );
    expect(searchUnderscoreRes.status).toBe(200);
    const searchUnderscoreBody = (await searchUnderscoreRes.json()) as any;
    expect(searchUnderscoreBody.data).toHaveLength(1);
    expect(searchUnderscoreBody.data[0].slug).toBe("manual_v1");

    // 2. Tag filter
    const tagRes = await SELF.fetch(
      "https://redirect.example.com/api/v1/links?tag=docs",
      { headers: authHeaders() }
    );
    const tagBody = (await tagRes.json()) as any;
    expect(tagBody.data).toHaveLength(1);
    expect(tagBody.data[0].slug).toBe("manual_v1");

    // 3. Exact slug filter
    const slugRes = await SELF.fetch(
      "https://redirect.example.com/api/v1/links?slug=article",
      { headers: authHeaders() }
    );
    const slugBody = (await slugRes.json()) as any;
    expect(slugBody.data).toHaveLength(1);
    expect(slugBody.data[0].slug).toBe("article");

    // 4. Pagination
    const pageRes = await SELF.fetch(
      "https://redirect.example.com/api/v1/links?limit=2&offset=0",
      { headers: authHeaders() }
    );
    const pageBody = (await pageRes.json()) as any;
    expect(pageBody.data).toHaveLength(2);
    expect(pageBody.pagination.total).toBe(3);
    expect(pageBody.pagination.hasMore).toBe(true);
  });

  it("updates link fields via PATCH and allows clearing expiry with null", async () => {
    const createRes = await SELF.fetch("https://redirect.example.com/api/v1/links", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        targetUrl: "https://example.com/initial",
        slug: "patch-test",
        statusCode: 307,
        expiresAt: "2030-01-01T00:00:00.000Z",
        isActive: true,
        forwardQuery: true,
        tags: ["v1"],
      }),
    });
    const link = (await createRes.json()) as any;
    expect(link.expiresAt).not.toBeNull();

    const patchRes = await SELF.fetch(
      `https://redirect.example.com/api/v1/links/${link.id}`,
      {
        method: "PATCH",
        headers: authHeaders(),
        body: JSON.stringify({
          statusCode: 301,
          isActive: false,
          forwardQuery: false,
          tags: ["v2", "archived"],
          expiresAt: null,
        }),
      }
    );
    expect(patchRes.status).toBe(200);
    const updated = (await patchRes.json()) as any;
    expect(updated.statusCode).toBe(301);
    expect(updated.isActive).toBe(false);
    expect(updated.forwardQuery).toBe(false);
    expect(updated.tags).toEqual(["v2", "archived"]);
    expect(updated.expiresAt).toBeNull();
  });

  it("deletes a link and cascades deletion of analytics rollups", async () => {
    const createRes = await SELF.fetch("https://redirect.example.com/api/v1/links", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        targetUrl: "https://example.com/delete-me",
        slug: "delete-me",
      }),
    });
    const link = (await createRes.json()) as any;

    // Insert dummy rollup data
    await env.DB.prepare(
      "INSERT INTO link_daily_clicks (link_id, day, clicks) VALUES (?, '2026-10-25', 10)"
    )
      .bind(link.id)
      .run();

    await env.DB.prepare(
      "INSERT INTO link_daily_dims (link_id, day, dim, value, clicks) VALUES (?, '2026-10-25', 'country', 'BD', 10)"
    )
      .bind(link.id)
      .run();

    // Delete link
    const delRes = await SELF.fetch(
      `https://redirect.example.com/api/v1/links/${link.id}`,
      {
        method: "DELETE",
        headers: authHeaders(),
      }
    );
    expect(delRes.status).toBe(200);

    // Verify cascade deletion
    const dailyCount = await env.DB.prepare(
      "SELECT COUNT(*) as c FROM link_daily_clicks WHERE link_id = ?"
    )
      .bind(link.id)
      .first<{ c: number }>();
    expect(dailyCount?.c).toBe(0);

    const dimsCount = await env.DB.prepare(
      "SELECT COUNT(*) as c FROM link_daily_dims WHERE link_id = ?"
    )
      .bind(link.id)
      .first<{ c: number }>();
    expect(dimsCount?.c).toBe(0);
  });

  it("queries link stats via GET /api/v1/links/:id/stats", async () => {
    const createRes = await SELF.fetch("https://redirect.example.com/api/v1/links", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        targetUrl: "https://example.com/stats",
        slug: "stats-test",
      }),
    });
    const link = (await createRes.json()) as any;

    // Update click count and insert daily rollups
    const today = new Date().toISOString().slice(0, 10);
    await env.DB.prepare(
      "UPDATE links SET click_count = 50, last_clicked_at = '2026-10-25T12:00:00.000Z' WHERE id = ?"
    )
      .bind(link.id)
      .run();

    await env.DB.prepare(
      "INSERT INTO link_daily_clicks (link_id, day, clicks) VALUES (?, ?, 50)"
    )
      .bind(link.id, today)
      .run();

    const statsRes = await SELF.fetch(
      `https://redirect.example.com/api/v1/links/${link.id}/stats?days=7`,
      { headers: authHeaders() }
    );
    expect(statsRes.status).toBe(200);
    const stats = (await statsRes.json()) as any;
    expect(stats.linkId).toBe(link.id);
    expect(stats.totalClicks).toBe(50);
    expect(stats.lastClickedAt).toBe("2026-10-25T12:00:00.000Z");
    expect(stats.range.days).toBe(7);
    expect(stats.daily).toHaveLength(1);
    expect(stats.daily[0]).toEqual({ day: today, clicks: 50 });
  });
});
