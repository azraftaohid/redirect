import type { CreateLinkInput, LinkRecord, ListLinksQuery, Paginated, UpdateLinkInput } from "@redirect/shared";
import { DEFAULT_STATUS_CODE } from "@redirect/shared";

export function mapRowToLinkRecord(row: Record<string, unknown>): LinkRecord {
  let tags: string[] = [];
  if (typeof row["tags"] === "string") {
    try {
      tags = JSON.parse(row["tags"]);
    } catch {
      tags = [];
    }
  } else if (Array.isArray(row["tags"])) {
    tags = row["tags"] as string[];
  }

  return {
    id: row["id"] as string,
    slug: row["slug"] as string,
    targetUrl: row["target_url"] as string,
    title: (row["title"] as string | null) ?? null,
    statusCode: row["status_code"] as LinkRecord["statusCode"],
    tags,
    isActive: Number(row["is_active"]) === 1,
    forwardQuery: Number(row["forward_query"]) === 1,
    expiresAt: (row["expires_at"] as string | null) ?? null,
    clickCount: Number(row["click_count"] ?? 0),
    lastClickedAt: (row["last_clicked_at"] as string | null) ?? null,
    createdAt: row["created_at"] as string,
    updatedAt: row["updated_at"] as string,
  };
}

function escapeLike(term: string): string {
  return term.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

const SORT_COLUMN_MAP: Record<string, string> = {
  createdAt: "created_at",
  updatedAt: "updated_at",
  clickCount: "click_count",
  slug: "slug",
};

export async function listLinks(
  db: D1Database,
  query: ListLinksQuery
): Promise<Paginated<LinkRecord>> {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (query.search && query.search.trim().length > 0) {
    const escaped = `%${escapeLike(query.search.trim())}%`;
    conditions.push(
      "(slug LIKE ? ESCAPE '\\' OR target_url LIKE ? ESCAPE '\\' OR title LIKE ? ESCAPE '\\')"
    );
    params.push(escaped, escaped, escaped);
  }

  if (query.tag && query.tag.trim().length > 0) {
    conditions.push("EXISTS (SELECT 1 FROM json_each(links.tags) WHERE value = ?)");
    params.push(query.tag.trim().toLowerCase());
  }

  if (query.slug && query.slug.length > 0) {
    conditions.push("slug = ?");
    params.push(query.slug);
  }

  if (query.targetUrl && query.targetUrl.trim().length > 0) {
    conditions.push("target_url = ?");
    params.push(query.targetUrl.trim());
  }

  if (query.isActive !== undefined) {
    conditions.push("is_active = ?");
    params.push(query.isActive === "true" ? 1 : 0);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  // Count total query
  const countSql = `SELECT COUNT(*) as total FROM links ${whereClause}`;
  const countStmt = db.prepare(countSql).bind(...params);

  // Sorting
  const sortCol = SORT_COLUMN_MAP[query.sortBy] ?? "created_at";
  const sortDir = query.sortOrder === "asc" ? "ASC" : "DESC";

  // Data query with stable pagination
  const dataSql = `
    SELECT * FROM links
    ${whereClause}
    ORDER BY ${sortCol} ${sortDir}, id ASC
    LIMIT ? OFFSET ?
  `;
  const dataParams = [...params, query.limit, query.offset];
  const dataStmt = db.prepare(dataSql).bind(...dataParams);

  // Single round-trip using batch
  const [countRes, dataRes] = await db.batch([countStmt, dataStmt]);
  const total = (countRes?.results?.[0] as { total?: number } | undefined)?.total ?? 0;
  const results = (dataRes?.results ?? []) as Record<string, unknown>[];
  const data = results.map(mapRowToLinkRecord);

  return {
    data,
    pagination: {
      total,
      limit: query.limit,
      offset: query.offset,
      hasMore: query.offset + data.length < total,
    },
  };
}

export async function getLinkById(db: D1Database, id: string): Promise<LinkRecord | null> {
  const row = await db
    .prepare("SELECT * FROM links WHERE id = ? LIMIT 1")
    .bind(id)
    .first<Record<string, unknown>>();

  if (!row) {
    return null;
  }
  return mapRowToLinkRecord(row);
}

export async function createLinkRecord(
  db: D1Database,
  id: string,
  slug: string,
  input: CreateLinkInput
): Promise<LinkRecord | null> {
  const now = new Date().toISOString();
  const statusCode = input.statusCode ?? DEFAULT_STATUS_CODE;
  const tagsJson = JSON.stringify(input.tags ?? []);
  const isActive = input.isActive !== undefined ? (input.isActive ? 1 : 0) : 1;
  const forwardQuery = input.forwardQuery !== undefined ? (input.forwardQuery ? 1 : 0) : 1;
  const expiresAt = input.expiresAt ? new Date(input.expiresAt).toISOString() : null;
  const title = input.title ?? null;

  const row = await db
    .prepare(
      `INSERT INTO links (
        id, slug, target_url, title, status_code, tags, is_active, forward_query,
        expires_at, click_count, last_clicked_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, ?, ?)
      ON CONFLICT(slug) DO NOTHING
      RETURNING *`
    )
    .bind(
      id,
      slug,
      input.targetUrl,
      title,
      statusCode,
      tagsJson,
      isActive,
      forwardQuery,
      expiresAt,
      now,
      now
    )
    .first<Record<string, unknown>>();

  if (!row) {
    return null;
  }

  return mapRowToLinkRecord(row);
}

export async function updateLinkRecord(
  db: D1Database,
  id: string,
  input: UpdateLinkInput
): Promise<LinkRecord | null> {
  const now = new Date().toISOString();
  const updates: string[] = ["updated_at = ?"];
  const params: unknown[] = [now];

  if (input.slug !== undefined) {
    updates.push("slug = ?");
    params.push(input.slug);
  }

  if (input.targetUrl !== undefined) {
    updates.push("target_url = ?");
    params.push(input.targetUrl);
  }

  if (input.title !== undefined) {
    updates.push("title = ?");
    params.push(input.title);
  }

  if (input.statusCode !== undefined) {
    updates.push("status_code = ?");
    params.push(input.statusCode);
  }

  if (input.tags !== undefined) {
    updates.push("tags = ?");
    params.push(JSON.stringify(input.tags));
  }

  if (input.isActive !== undefined) {
    updates.push("is_active = ?");
    params.push(input.isActive ? 1 : 0);
  }

  if (input.forwardQuery !== undefined) {
    updates.push("forward_query = ?");
    params.push(input.forwardQuery ? 1 : 0);
  }

  if (input.expiresAt !== undefined) {
    updates.push("expires_at = ?");
    params.push(input.expiresAt ? new Date(input.expiresAt).toISOString() : null);
  }

  params.push(id);

  const sql = `UPDATE links SET ${updates.join(", ")} WHERE id = ? RETURNING *`;
  const row = await db.prepare(sql).bind(...params).first<Record<string, unknown>>();
  if (!row) {
    return null;
  }
  return mapRowToLinkRecord(row);
}

export async function deleteLinkRecord(db: D1Database, id: string): Promise<boolean> {
  const res = await db.prepare("DELETE FROM links WHERE id = ?").bind(id).run();
  return (res.meta.changes ?? 0) > 0;
}
