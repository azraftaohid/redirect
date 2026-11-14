import { describe, it, expect, beforeEach } from "vitest";
import { env, SELF } from "cloudflare:test";
import { importLinksBatch } from "../src/db/links.js";

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

    // 4. Exact targetUrl filter (R3.1 / R5.9)
    const targetUrlRes = await SELF.fetch(
      "https://redirect.example.com/api/v1/links?targetUrl=https://example.com/docs",
      { headers: authHeaders() }
    );
    const targetUrlBody = (await targetUrlRes.json()) as any;
    expect(targetUrlBody.data).toHaveLength(1);
    expect(targetUrlBody.data[0].slug).toBe("manual_v1");

    // 5. Pagination
    const pageRes = await SELF.fetch(
      "https://redirect.example.com/api/v1/links?limit=2&offset=0",
      { headers: authHeaders() }
    );
    const pageBody = (await pageRes.json()) as any;
    expect(pageBody.data).toHaveLength(2);
    expect(pageBody.pagination.total).toBe(3);
    expect(pageBody.pagination.hasMore).toBe(true);
  });

  it("updates link fields via PATCH, allows clearing expiry, and edits expired link title without error (B6/B7)", async () => {
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

    // 1. Clear expiry and tags
    const patchRes = await SELF.fetch(
      `https://redirect.example.com/api/v1/links/${link.id}`,
      {
        method: "PATCH",
        headers: authHeaders(),
        body: JSON.stringify({
          statusCode: 301,
          isActive: false,
          forwardQuery: false,
          tags: [],
          expiresAt: null,
        }),
      }
    );
    expect(patchRes.status).toBe(200);
    const updated = (await patchRes.json()) as any;
    expect(updated.statusCode).toBe(301);
    expect(updated.isActive).toBe(false);
    expect(updated.forwardQuery).toBe(false);
    expect(updated.tags).toEqual([]);
    expect(updated.expiresAt).toBeNull();

    // 2. Simulate expired link in D1
    await env.DB.prepare("UPDATE links SET expires_at = '2020-01-01T00:00:00.000Z' WHERE id = ?")
      .bind(link.id)
      .run();

    // 3. Edit title without touching expiresAt - must succeed (B6)
    const editTitleRes = await SELF.fetch(
      `https://redirect.example.com/api/v1/links/${link.id}`,
      {
        method: "PATCH",
        headers: authHeaders(),
        body: JSON.stringify({
          title: "New Title on Expired Link",
        }),
      }
    );
    expect(editTitleRes.status).toBe(200);
    const titleUpdated = (await editTitleRes.json()) as any;
    expect(titleUpdated.title).toBe("New Title on Expired Link");
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

  it("returns 404 on deleting non-existent link", async () => {
    const delRes = await SELF.fetch(
      "https://redirect.example.com/api/v1/links/non-existent-id",
      {
        method: "DELETE",
        headers: authHeaders(),
      }
    );
    expect(delRes.status).toBe(404);
  });

  it("maps malformed JSON to 400 bad_request (B4)", async () => {
    const res = await SELF.fetch("https://redirect.example.com/api/v1/links", {
      method: "POST",
      headers: authHeaders(),
      body: "{ malformed json",
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as any;
    expect(body.error.code).toBe("bad_request");
  });

  it("queries link stats via GET /api/v1/links/:id/stats returning embedded link record (R3.5)", async () => {
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
    expect(stats.link).toBeDefined();
    expect(stats.link.id).toBe(link.id);
    expect(stats.link.clickCount).toBe(50);
    expect(stats.link.lastClickedAt).toBe("2026-10-25T12:00:00.000Z");
    expect(stats.range.days).toBe(7);
    expect(stats.daily).toHaveLength(1);
    expect(stats.daily[0]).toEqual({ day: today, clicks: 50 });
  });

  it("returns 404 for stats on non-existent link", async () => {
    const statsRes = await SELF.fetch(
      "https://redirect.example.com/api/v1/links/non-existent-id/stats?days=7",
      { headers: authHeaders() }
    );
    expect(statsRes.status).toBe(404);
  });

  it("exports links as versioned JSON without analytics and supports filters", async () => {
    const createRes = await SELF.fetch("https://redirect.example.com/api/v1/links", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        targetUrl: "https://example.com/exported",
        slug: "exp-1",
        title: "Exported One",
        statusCode: 302,
        tags: ["Ops", "Launch"],
        isActive: false,
        forwardQuery: false,
      }),
    });
    const created = (await createRes.json()) as any;
    await env.DB.prepare(
      "UPDATE links SET click_count = 42, last_clicked_at = '2026-11-01T00:00:00.000Z' WHERE id = ?"
    )
      .bind(created.id)
      .run();

    await SELF.fetch("https://redirect.example.com/api/v1/links", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        targetUrl: "https://example.com/other",
        slug: "exp-2",
        tags: ["marketing"],
        isActive: true,
      }),
    });

    const exportRes = await SELF.fetch("https://redirect.example.com/api/v1/links/export", {
      headers: authHeaders(),
    });
    expect(exportRes.status).toBe(200);
    expect(exportRes.headers.get("Cache-Control")).toBe("no-store");
    expect(exportRes.headers.get("Content-Disposition")).toContain("attachment;");

    const body = (await exportRes.json()) as any;
    expect(body.version).toBe(1);
    expect(typeof body.exportedAt).toBe("string");
    expect(body.count).toBe(2);
    expect(body.links).toHaveLength(2);
    expect(body.pagination.hasMore).toBe(false);
    expect(body.pagination.nextCursor).toBeNull();

    const first = body.links.find((l: any) => l.slug === "exp-1");
    expect(first).toBeDefined();
    expect(first.targetUrl).toBe("https://example.com/exported");
    expect(first.title).toBe("Exported One");
    expect(first.statusCode).toBe(302);
    expect(first.tags).toEqual(["ops", "launch"]);
    expect(first.isActive).toBe(false);
    expect(first.forwardQuery).toBe(false);
    expect(first.createdAt).toBeDefined();
    expect(first.updatedAt).toBeDefined();
    expect("id" in first).toBe(false);
    expect("clickCount" in first).toBe(false);
    expect("lastClickedAt" in first).toBe(false);

    // Filter by tag and isActive
    const filteredRes = await SELF.fetch(
      "https://redirect.example.com/api/v1/links/export?tag=ops&isActive=false",
      { headers: authHeaders() }
    );
    expect(filteredRes.status).toBe(200);
    const filtered = (await filteredRes.json()) as any;
    expect(filtered.count).toBe(1);
    expect(filtered.links[0].slug).toBe("exp-1");
  });

  it("supports cursor-chunked export without duplicates or gaps and rejects invalid cursor", async () => {
    for (let i = 1; i <= 5; i++) {
      await SELF.fetch("https://redirect.example.com/api/v1/links", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          targetUrl: `https://example.com/p-${i}`,
          slug: `chunk-${i}`,
        }),
      });
    }

    const collectedSlugs: string[] = [];
    let cursor: string | null = null;
    let pages = 0;

    do {
      pages++;
      const qs = cursor ? `?limit=2&cursor=${encodeURIComponent(cursor)}` : "?limit=2";
      const res = await SELF.fetch(`https://redirect.example.com/api/v1/links/export${qs}`, {
        headers: authHeaders(),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as any;
      for (const l of body.links) {
        collectedSlugs.push(l.slug);
      }
      cursor = body.pagination.hasMore ? body.pagination.nextCursor : null;
    } while (cursor);

    expect(pages).toBe(3);
    expect(collectedSlugs).toHaveLength(5);
    expect(new Set(collectedSlugs).size).toBe(5);

    const badCursorRes = await SELF.fetch(
      "https://redirect.example.com/api/v1/links/export?cursor=not-valid-base64!",
      { headers: authHeaders() }
    );
    expect(badCursorRes.status).toBe(400);
    const badBody = (await badCursorRes.json()) as any;
    expect(badBody.error.code).toBe("invalid_cursor");
  });

  it("imports links with default skip mode and reports skippedSlugs", async () => {
    await SELF.fetch("https://redirect.example.com/api/v1/links", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        targetUrl: "https://example.com/original",
        slug: "existing-slug",
        title: "Original",
      }),
    });

    const importRes = await SELF.fetch("https://redirect.example.com/api/v1/links/import", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        version: 1,
        links: [
          {
            slug: "existing-slug",
            targetUrl: "https://example.com/should-not-overwrite",
            title: "Changed",
          },
          {
            slug: "fresh-slug",
            targetUrl: "https://example.com/fresh",
            tags: ["Imported"],
          },
          {
            slug: "fresh-slug",
            targetUrl: "https://example.com/duplicate-in-batch",
          },
        ],
      }),
    });

    expect(importRes.status).toBe(200);
    expect(importRes.headers.get("Cache-Control")).toBe("no-store");
    const body = (await importRes.json()) as any;

    expect(body.onConflict).toBe("skip");
    expect(body.summary).toEqual({
      total: 3,
      created: 1,
      updated: 0,
      skipped: 2,
      failed: 0,
    });
    expect(body.createdSlugs).toEqual(["fresh-slug"]);
    expect(body.skippedSlugs).toEqual(["existing-slug", "fresh-slug"]);
    expect(body.results).toHaveLength(3);
    expect(body.results[0].status).toBe("skipped");
    expect(body.results[0].slug).toBe("existing-slug");
    expect(body.results[1].status).toBe("created");
    expect(body.results[2].status).toBe("skipped");
    expect(body.results[2].reason).toBe("duplicate_in_batch");

    // Existing link must remain untouched
    const existingRow = await env.DB.prepare("SELECT target_url, title FROM links WHERE slug = ?")
      .bind("existing-slug")
      .first<{ target_url: string; title: string }>();
    expect(existingRow?.target_url).toBe("https://example.com/original");
    expect(existingRow?.title).toBe("Original");
  });

  it("overwrites existing links in-place when onConflict is overwrite while preserving id and analytics", async () => {
    const createRes = await SELF.fetch("https://redirect.example.com/api/v1/links", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        targetUrl: "https://example.com/old-dest",
        slug: "overwrite-me",
        title: "Old Title",
      }),
    });
    const original = (await createRes.json()) as any;

    await env.DB.prepare("UPDATE links SET click_count = 77 WHERE id = ?")
      .bind(original.id)
      .run();
    await env.DB.prepare(
      "INSERT INTO link_daily_clicks (link_id, day, clicks) VALUES (?, '2026-11-10', 77)"
    )
      .bind(original.id)
      .run();

    const importRes = await SELF.fetch("https://redirect.example.com/api/v1/links/import", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        version: 1,
        onConflict: "overwrite",
        links: [
          {
            slug: "overwrite-me",
            targetUrl: "https://example.com/new-dest",
            title: "Updated Title",
            statusCode: 301,
            tags: ["Updated"],
            isActive: false,
            forwardQuery: false,
          },
          {
            slug: "new-one",
            targetUrl: "https://example.com/brand-new",
          },
        ],
      }),
    });

    expect(importRes.status).toBe(200);
    const body = (await importRes.json()) as any;
    expect(body.onConflict).toBe("overwrite");
    expect(body.summary).toEqual({
      total: 2,
      created: 1,
      updated: 1,
      skipped: 0,
      failed: 0,
    });
    expect(body.updatedSlugs).toEqual(["overwrite-me"]);
    expect(body.createdSlugs).toEqual(["new-one"]);
    expect(body.skippedSlugs).toEqual([]);

    const checkRow = await env.DB.prepare(
      "SELECT id, target_url, title, status_code, click_count FROM links WHERE slug = ?"
    )
      .bind("overwrite-me")
      .first<{
        id: string;
        target_url: string;
        title: string;
        status_code: number;
        click_count: number;
      }>();
    expect(checkRow?.id).toBe(original.id);
    expect(checkRow?.target_url).toBe("https://example.com/new-dest");
    expect(checkRow?.title).toBe("Updated Title");
    expect(checkRow?.status_code).toBe(301);
    expect(checkRow?.click_count).toBe(77);

    const dailyRow = await env.DB.prepare(
      "SELECT clicks FROM link_daily_clicks WHERE link_id = ? AND day = '2026-11-10'"
    )
      .bind(original.id)
      .first<{ clicks: number }>();
    expect(dailyRow?.clicks).toBe(77);
  });

  it("allows past expiresAt on import, generates missing slugs, and reports per-item validation failures", async () => {
    const importRes = await SELF.fetch("https://redirect.example.com/api/v1/links/import", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        version: 1,
        links: [
          {
            slug: "past-expiry",
            targetUrl: "https://example.com/expired",
            expiresAt: "2020-01-01T00:00:00.000Z",
          },
          {
            targetUrl: "https://example.com/auto-slug",
          },
          {
            slug: "loop-bad",
            targetUrl: "https://redirect.example.com/loop",
          },
          {
            slug: "api",
            targetUrl: "https://example.com/reserved",
          },
        ],
      }),
    });

    expect(importRes.status).toBe(200);
    const body = (await importRes.json()) as any;
    expect(body.summary).toEqual({
      total: 4,
      created: 2,
      updated: 0,
      skipped: 0,
      failed: 2,
    });
    expect(body.createdSlugs).toHaveLength(2);
    expect(body.createdSlugs[0]).toBe("past-expiry");
    expect(body.createdSlugs[1]).toMatch(/^[A-Za-z0-9_-]{6}$/);
    expect(body.errors).toHaveLength(2);
    expect(body.errors[0]).toMatchObject({
      index: 2,
      slug: "loop-bad",
      code: "invalid_target_url",
    });
    expect(body.errors[1]).toMatchObject({
      index: 3,
      slug: "api",
      code: "validation_error",
    });
  });

  it("enforces auth and envelope validation on /export and /import", async () => {
    const unauthExport = await SELF.fetch("https://redirect.example.com/api/v1/links/export");
    expect(unauthExport.status).toBe(401);

    const unauthImport = await SELF.fetch("https://redirect.example.com/api/v1/links/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        version: 1,
        links: [{ slug: "unauth", targetUrl: "https://example.com" }],
      }),
    });
    expect(unauthImport.status).toBe(401);

    const badVersion = await SELF.fetch("https://redirect.example.com/api/v1/links/import", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        version: 2,
        links: [{ slug: "bad-ver", targetUrl: "https://example.com" }],
      }),
    });
    expect(badVersion.status).toBe(400);

    const badConflict = await SELF.fetch("https://redirect.example.com/api/v1/links/import", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        version: 1,
        onConflict: "replace",
        links: [{ slug: "bad-mode", targetUrl: "https://example.com" }],
      }),
    });
    expect(badConflict.status).toBe(400);

    const emptyLinks = await SELF.fetch("https://redirect.example.com/api/v1/links/import", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        version: 1,
        links: [],
      }),
    });
    expect(emptyLinks.status).toBe(400);

    const tooManyLinks = Array.from({ length: 501 }, (_, idx) => ({
      slug: `over-${idx}`,
      targetUrl: `https://example.com/${idx}`,
    }));
    const oversizedRes = await SELF.fetch("https://redirect.example.com/api/v1/links/import", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        version: 1,
        links: tooManyLinks,
      }),
    });
    expect(oversizedRes.status).toBe(400);
  });

  it("normalizes timezone offsets on import, preserves createdAt/updatedAt, and prefixes field validation errors", async () => {
    const res = await SELF.fetch("https://redirect.example.com/api/v1/links/import", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        version: 1,
        links: [
          {
            slug: "tz-link",
            targetUrl: "https://example.com/tz",
            expiresAt: "2030-05-01T12:00:00+00:00",
            createdAt: "2025-01-15T10:30:00+02:00",
            updatedAt: "2025-02-01T08:00:00-05:00",
          },
          {
            slug: "bad-url-item",
            targetUrl: "not-a-valid-url",
          },
        ],
      }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.summary).toEqual({
      total: 2,
      created: 1,
      updated: 0,
      skipped: 0,
      failed: 1,
    });
    expect(body.errors[0].code).toBe("validation_error");
    expect(body.errors[0].message).toMatch(/^targetUrl:/);

    const row = await env.DB.prepare(
      "SELECT expires_at, created_at, updated_at FROM links WHERE slug = ?"
    )
      .bind("tz-link")
      .first<{ expires_at: string; created_at: string; updated_at: string }>();

    expect(row).toEqual({
      expires_at: "2030-05-01T12:00:00.000Z",
      created_at: "2025-01-15T08:30:00.000Z",
      updated_at: "2025-02-01T13:00:00.000Z",
    });
  });

  it("uses merge-only overwrite semantics and keeps createdSlugs and updatedSlugs disjoint", async () => {
    await SELF.fetch("https://redirect.example.com/api/v1/links", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        slug: "merge-me",
        targetUrl: "https://example.com/original",
        title: "Keep Title",
        statusCode: 301,
        tags: ["docs"],
        isActive: false,
        forwardQuery: false,
        expiresAt: "2030-01-01T00:00:00.000Z",
      }),
    });

    const importRes = await SELF.fetch("https://redirect.example.com/api/v1/links/import", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        version: 1,
        onConflict: "overwrite",
        links: [
          {
            slug: "merge-me",
            targetUrl: "https://example.com/merged-dest",
          },
          {
            slug: "inbatch-dup",
            targetUrl: "https://example.com/v1",
            title: "V1 Title",
          },
          {
            slug: "inbatch-dup",
            targetUrl: "https://example.com/v2",
          },
        ],
      }),
    });

    expect(importRes.status).toBe(200);
    const body = (await importRes.json()) as any;
    expect(body.summary).toEqual({
      total: 3,
      created: 1,
      updated: 2,
      skipped: 0,
      failed: 0,
    });
    expect(body.createdSlugs).toEqual(["inbatch-dup"]);
    expect(body.updatedSlugs).toEqual(["merge-me"]);

    const mergedRow = await env.DB.prepare(
      "SELECT target_url, title, status_code, tags, is_active, forward_query, expires_at FROM links WHERE slug = ?"
    )
      .bind("merge-me")
      .first<{
        target_url: string;
        title: string | null;
        status_code: number;
        tags: string;
        is_active: number;
        forward_query: number;
        expires_at: string | null;
      }>();

    expect(mergedRow).toEqual({
      target_url: "https://example.com/merged-dest",
      title: "Keep Title",
      status_code: 301,
      tags: JSON.stringify(["docs"]),
      is_active: 0,
      forward_query: 0,
      expires_at: "2030-01-01T00:00:00.000Z",
    });

    const dupRow = await env.DB.prepare(
      "SELECT target_url, title FROM links WHERE slug = ?"
    )
      .bind("inbatch-dup")
      .first<{ target_url: string; title: string | null }>();
    expect(dupRow).toEqual({
      target_url: "https://example.com/v2",
      title: "V1 Title",
    });
  });

  it("handles filtered cursor export cleanly across identical created_at timestamps", async () => {
    const sharedTs = "2026-06-01T00:00:00.000Z";
    await SELF.fetch("https://redirect.example.com/api/v1/links/import", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        version: 1,
        links: [
          { slug: "tie-1", targetUrl: "https://example.com/1", tags: ["batch-tag"], isActive: true, createdAt: sharedTs },
          { slug: "tie-2", targetUrl: "https://example.com/2", tags: ["batch-tag"], isActive: true, createdAt: sharedTs },
          { slug: "tie-3", targetUrl: "https://example.com/3", tags: ["batch-tag"], isActive: true, createdAt: sharedTs },
          { slug: "tie-inactive", targetUrl: "https://example.com/4", tags: ["batch-tag"], isActive: false, createdAt: sharedTs },
          { slug: "tie-other", targetUrl: "https://example.com/5", tags: ["other-tag"], isActive: true, createdAt: sharedTs },
        ],
      }),
    });

    const collected: string[] = [];
    let cursor: string | null = null;
    do {
      const params = new URLSearchParams({
        tag: "batch-tag",
        isActive: "true",
        limit: "2",
      });
      if (cursor) params.set("cursor", cursor);

      const res = await SELF.fetch(
        `https://redirect.example.com/api/v1/links/export?${params.toString()}`,
        { headers: authHeaders() }
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as any;
      for (const link of body.links) {
        collected.push(link.slug);
      }
      cursor = body.pagination.hasMore ? body.pagination.nextCursor : null;
    } while (cursor);

    expect(collected).toHaveLength(3);
    expect(new Set(collected)).toEqual(new Set(["tie-1", "tie-2", "tie-3"]));
  });

  it("records db_error for failed write chunks without losing prior committed chunks", async () => {
    let batchCall = 0;
    const mockDb = {
      prepare: () => ({
        bind: () => ({}),
      }),
      batch: async (stmts: unknown[]) => {
        batchCall++;
        if (batchCall === 1) {
          // Prefetch SELECT for existing slugs
          return stmts.map(() => ({ results: [] }));
        }
        if (batchCall === 2) {
          // First 100-item write chunk succeeds (WRITE_BATCH_CHUNK_SIZE = 100)
          return stmts.map(() => ({ meta: { changes: 1 } }));
        }
        // Second write chunk fails in D1
        throw new Error("Simulated D1 write error");
      },
    } as unknown as D1Database;

    const rawLinks = Array.from({ length: 105 }, (_, i) => ({
      slug: `batch-item-${i}`,
      targetUrl: `https://example.com/${i}`,
    }));

    const res = await importLinksBatch(mockDb, rawLinks, "skip", []);
    expect(res.summary).toEqual({
      total: 105,
      created: 100,
      updated: 0,
      skipped: 0,
      failed: 5,
    });
    expect(res.createdSlugs).toHaveLength(100);
    expect(res.errors).toHaveLength(5);
    expect(res.errors[0]).toMatchObject({
      index: 100,
      slug: "batch-item-100",
      code: "db_error",
      message: "Simulated D1 write error",
    });
    expect(res.results[104]?.status).toBe("failed");
  });
});
