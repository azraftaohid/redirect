import {
  DEFAULT_SLUG_LENGTH,
  DEFAULT_STATUS_CODE,
  EXPORT_SCHEMA_VERSION,
  generateValidRandomSlug,
  importLinkItemSchema,
  validateTargetUrl,
  type CreateLinkInput,
  type ExportedLink,
  type ExportLinksQuery,
  type ImportConflictMode,
  type ImportItemError,
  type ImportItemResult,
  type ImportLinkInput,
  type ImportLinksResponse,
  type LinkRecord,
  type ListLinksQuery,
  type Paginated,
  type UpdateLinkInput,
} from "@redirect/shared";

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

interface LinkFilterParams {
  search?: string;
  tag?: string;
  slug?: string;
  targetUrl?: string;
  isActive?: "true" | "false";
}

function buildLinkFilterClauses(filter: LinkFilterParams): {
  conditions: string[];
  params: unknown[];
} {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filter.search && filter.search.trim().length > 0) {
    const escaped = `%${escapeLike(filter.search.trim())}%`;
    conditions.push(
      "(slug LIKE ? ESCAPE '\\' OR target_url LIKE ? ESCAPE '\\' OR title LIKE ? ESCAPE '\\')"
    );
    params.push(escaped, escaped, escaped);
  }

  if (filter.tag && filter.tag.trim().length > 0) {
    conditions.push("EXISTS (SELECT 1 FROM json_each(links.tags) WHERE value = ?)");
    params.push(filter.tag.trim().toLowerCase());
  }

  if (filter.slug && filter.slug.length > 0) {
    conditions.push("slug = ?");
    params.push(filter.slug);
  }

  if (filter.targetUrl && filter.targetUrl.trim().length > 0) {
    conditions.push("target_url = ?");
    params.push(filter.targetUrl.trim());
  }

  if (filter.isActive !== undefined) {
    conditions.push("is_active = ?");
    params.push(filter.isActive === "true" ? 1 : 0);
  }

  return { conditions, params };
}

export async function listLinks(
  db: D1Database,
  query: ListLinksQuery
): Promise<Paginated<LinkRecord>> {
  const { conditions, params } = buildLinkFilterClauses(query);
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

const SQL_IN_CHUNK_SIZE = 50;
const WRITE_BATCH_CHUNK_SIZE = 100;

export interface ExportCursor {
  createdAt: string;
  id: string;
}

export function encodeExportCursor(createdAt: string, id: string): string {
  const raw = JSON.stringify({ c: createdAt, i: id });
  return btoa(raw).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function decodeExportCursor(cursor: string): ExportCursor | null {
  try {
    const base64 = cursor.replace(/-/g, "+").replace(/_/g, "/");
    const padLen = (4 - (base64.length % 4)) % 4;
    const padded = base64 + "=".repeat(padLen);
    const parsed = JSON.parse(atob(padded)) as unknown;
    if (
      parsed &&
      typeof parsed === "object" &&
      "c" in parsed &&
      "i" in parsed &&
      typeof (parsed as { c: unknown }).c === "string" &&
      typeof (parsed as { i: unknown }).i === "string"
    ) {
      const createdAt = (parsed as { c: string }).c;
      const id = (parsed as { i: string }).i;
      if (createdAt.length > 0 && id.length > 0) {
        return { createdAt, id };
      }
    }
    return null;
  } catch {
    return null;
  }
}

export function mapRowToExportedLink(row: Record<string, unknown>): ExportedLink {
  const record = mapRowToLinkRecord(row);
  return {
    slug: record.slug,
    targetUrl: record.targetUrl,
    title: record.title,
    statusCode: record.statusCode,
    tags: record.tags,
    isActive: record.isActive,
    forwardQuery: record.forwardQuery,
    expiresAt: record.expiresAt,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

export async function exportLinks(
  db: D1Database,
  query: ExportLinksQuery,
  decodedCursor?: ExportCursor | null
): Promise<{
  links: ExportedLink[];
  pagination: {
    limit: number;
    nextCursor: string | null;
    hasMore: boolean;
  };
}> {
  const { conditions, params } = buildLinkFilterClauses({
    search: query.search,
    tag: query.tag,
    isActive: query.isActive,
  });

  if (decodedCursor) {
    conditions.push("(created_at > ? OR (created_at = ? AND id > ?))");
    params.push(decodedCursor.createdAt, decodedCursor.createdAt, decodedCursor.id);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const sql = `
    SELECT * FROM links
    ${whereClause}
    ORDER BY created_at ASC, id ASC
    LIMIT ?
  `;

  const res = await db.prepare(sql).bind(...params, query.limit + 1).all();
  const rows = (res.results ?? []) as Record<string, unknown>[];
  const hasMore = rows.length > query.limit;
  const pageRows = hasMore ? rows.slice(0, query.limit) : rows;
  const lastRow = pageRows.length > 0 ? pageRows[pageRows.length - 1] : undefined;

  const nextCursor =
    hasMore && lastRow
      ? encodeExportCursor(String(lastRow["created_at"]), String(lastRow["id"]))
      : null;

  return {
    links: pageRows.map(mapRowToExportedLink),
    pagination: {
      limit: query.limit,
      nextCursor,
      hasMore,
    },
  };
}

function extractRawSlug(raw: unknown): string | null {
  if (raw && typeof raw === "object" && "slug" in raw) {
    const val = (raw as Record<string, unknown>)["slug"];
    if (typeof val === "string") {
      const trimmed = val.trim();
      return trimmed.length > 0 ? trimmed : null;
    }
  }
  return null;
}

interface ValidatedImportEntry {
  index: number;
  input: ImportLinkInput;
  slug: string;
  autoGeneratedSlug: boolean;
}

interface PendingImportWrite {
  index: number;
  slug: string;
  autoGeneratedSlug: boolean;
  op: "insert" | "update";
  id: string;
  stmt: D1PreparedStatement;
}

function normalizeImportFields(input: ImportLinkInput) {
  return {
    title: input.title ?? null,
    statusCode: input.statusCode ?? DEFAULT_STATUS_CODE,
    tagsJson: JSON.stringify(input.tags ?? []),
    isActive: input.isActive !== undefined ? (input.isActive ? 1 : 0) : 1,
    forwardQuery: input.forwardQuery !== undefined ? (input.forwardQuery ? 1 : 0) : 1,
    expiresAt: input.expiresAt ? new Date(input.expiresAt).toISOString() : null,
  };
}

function buildUpdateBySlugStatement(
  db: D1Database,
  slug: string,
  input: ImportLinkInput,
  now: string
): D1PreparedStatement {
  const updates: string[] = ["target_url = ?"];
  const params: unknown[] = [input.targetUrl];

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

  updates.push("updated_at = ?");
  params.push(now, slug);

  return db
    .prepare(
      `UPDATE links
       SET ${updates.join(", ")}
       WHERE slug = ?`
    )
    .bind(...params);
}

export async function importLinksBatch(
  db: D1Database,
  rawLinks: unknown[],
  onConflict: ImportConflictMode,
  ownHostnames: string[]
): Promise<ImportLinksResponse> {
  const resultsByIndex = new Map<number, ImportItemResult>();
  const errors: ImportItemError[] = [];
  const skippedSlugSet = new Set<string>();
  const createdSlugSet = new Set<string>();
  const updatedSlugSet = new Set<string>();

  let createdCount = 0;
  let updatedCount = 0;
  let skippedCount = 0;
  let failedCount = 0;

  const preValidated: Array<{ index: number; input: ImportLinkInput }> = [];
  const reservedInBatch = new Set<string>();

  for (let index = 0; index < rawLinks.length; index++) {
    const rawItem = rawLinks[index];
    const parsed = importLinkItemSchema.safeParse(rawItem);
    if (!parsed.success) {
      const rawSlug = extractRawSlug(rawItem);
      const firstIssue = parsed.error.issues[0];
      const fieldPrefix =
        firstIssue && firstIssue.path.length > 0 ? `${firstIssue.path.join(".")}: ` : "";
      const message = `${fieldPrefix}${firstIssue?.message ?? "Invalid link entry."}`;
      errors.push({ index, slug: rawSlug, code: "validation_error", message });
      resultsByIndex.set(index, {
        index,
        slug: rawSlug ?? "",
        status: "failed",
        reason: message,
      });
      failedCount++;
      continue;
    }

    const targetValidation = validateTargetUrl(parsed.data.targetUrl, ownHostnames);
    if (!targetValidation.ok) {
      const itemSlug = parsed.data.slug ?? null;
      errors.push({
        index,
        slug: itemSlug,
        code: "invalid_target_url",
        message: targetValidation.error,
      });
      resultsByIndex.set(index, {
        index,
        slug: itemSlug ?? "",
        status: "failed",
        reason: targetValidation.error,
      });
      failedCount++;
      continue;
    }

    if (parsed.data.slug) {
      reservedInBatch.add(parsed.data.slug);
    }
    preValidated.push({ index, input: parsed.data });
  }

  const entries: ValidatedImportEntry[] = [];
  for (const item of preValidated) {
    if (item.input.slug) {
      entries.push({
        index: item.index,
        input: item.input,
        slug: item.input.slug,
        autoGeneratedSlug: false,
      });
    } else {
      let generated = "";
      for (let attempt = 0; attempt < 20; attempt++) {
        const candidate = generateValidRandomSlug(DEFAULT_SLUG_LENGTH);
        if (!reservedInBatch.has(candidate)) {
          generated = candidate;
          reservedInBatch.add(candidate);
          break;
        }
      }
      if (!generated) {
        generated = generateValidRandomSlug(DEFAULT_SLUG_LENGTH + 1);
        reservedInBatch.add(generated);
      }
      entries.push({
        index: item.index,
        input: item.input,
        slug: generated,
        autoGeneratedSlug: true,
      });
    }
  }

  // Prefetch existing slugs in chunks to stay safely below D1's bound parameter limit
  const uniqueCandidateSlugs = Array.from(new Set(entries.map((e) => e.slug)));
  const existingBySlug = new Map<string, string>();

  if (uniqueCandidateSlugs.length > 0) {
    const selectStmts: D1PreparedStatement[] = [];
    for (let i = 0; i < uniqueCandidateSlugs.length; i += SQL_IN_CHUNK_SIZE) {
      const chunk = uniqueCandidateSlugs.slice(i, i + SQL_IN_CHUNK_SIZE);
      const placeholders = chunk.map(() => "?").join(", ");
      selectStmts.push(
        db.prepare(`SELECT id, slug FROM links WHERE slug IN (${placeholders})`).bind(...chunk)
      );
    }

    const selectResults = await db.batch(selectStmts);
    for (const res of selectResults) {
      const rows = (res.results ?? []) as Array<{ id: string; slug: string }>;
      for (const row of rows) {
        existingBySlug.set(row.slug, row.id);
      }
    }
  }

  // Re-roll any auto-generated slug that happened to collide with an existing link in D1
  const failedAutoGenIndices = new Set<number>();
  for (const entry of entries) {
    if (entry.autoGeneratedSlug && existingBySlug.has(entry.slug)) {
      let resolved = false;
      for (let attempt = 0; attempt < 10; attempt++) {
        const candidate = generateValidRandomSlug(DEFAULT_SLUG_LENGTH + (attempt >= 5 ? 1 : 0));
        if (!reservedInBatch.has(candidate) && !existingBySlug.has(candidate)) {
          reservedInBatch.add(candidate);
          entry.slug = candidate;
          resolved = true;
          break;
        }
      }
      if (!resolved) {
        failedAutoGenIndices.add(entry.index);
        const message = "Unable to generate a unique slug after multiple attempts.";
        errors.push({
          index: entry.index,
          slug: null,
          code: "slug_generation_failed",
          message,
        });
        resultsByIndex.set(entry.index, {
          index: entry.index,
          slug: "",
          status: "failed",
          reason: message,
        });
        failedCount++;
      }
    }
  }

  const now = new Date().toISOString();
  const processedBatchSlugs = new Set<string>();
  const createdInBatch = new Map<string, string>();
  const pendingWrites: PendingImportWrite[] = [];

  for (const entry of entries) {
    const { index, input, slug, autoGeneratedSlug } = entry;
    if (failedAutoGenIndices.has(index)) {
      continue;
    }

    if (autoGeneratedSlug && (processedBatchSlugs.has(slug) || existingBySlug.has(slug))) {
      const message = "Unable to generate a unique slug after multiple attempts.";
      errors.push({
        index,
        slug: null,
        code: "slug_generation_failed",
        message,
      });
      resultsByIndex.set(index, {
        index,
        slug: "",
        status: "failed",
        reason: message,
      });
      failedCount++;
      continue;
    }

    if (processedBatchSlugs.has(slug)) {
      if (onConflict === "skip") {
        skippedSlugSet.add(slug);
        skippedCount++;
        resultsByIndex.set(index, {
          index,
          slug,
          status: "skipped",
          reason: "duplicate_in_batch",
        });
        continue;
      }

      const targetId = existingBySlug.get(slug) ?? createdInBatch.get(slug) ?? "";
      const stmt = buildUpdateBySlugStatement(db, slug, input, now);

      pendingWrites.push({
        index,
        slug,
        autoGeneratedSlug: false,
        op: "update",
        id: targetId,
        stmt,
      });
      continue;
    }

    processedBatchSlugs.add(slug);
    const existingId = existingBySlug.get(slug);

    if (existingId !== undefined) {
      if (onConflict === "skip") {
        skippedSlugSet.add(slug);
        skippedCount++;
        resultsByIndex.set(index, {
          index,
          slug,
          status: "skipped",
          id: existingId,
          reason: "slug_exists",
        });
        continue;
      }

      const stmt = buildUpdateBySlugStatement(db, slug, input, now);

      pendingWrites.push({
        index,
        slug,
        autoGeneratedSlug: false,
        op: "update",
        id: existingId,
        stmt,
      });
      continue;
    }

    const id = crypto.randomUUID();
    const fields = normalizeImportFields(input);
    const createdAt = input.createdAt ? new Date(input.createdAt).toISOString() : now;
    const updatedAt = input.updatedAt ? new Date(input.updatedAt).toISOString() : createdAt;

    createdInBatch.set(slug, id);

    const stmt = db
      .prepare(
        `INSERT INTO links (
          id, slug, target_url, title, status_code, tags, is_active, forward_query,
          expires_at, click_count, last_clicked_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, ?, ?)
        ON CONFLICT(slug) DO NOTHING`
      )
      .bind(
        id,
        slug,
        input.targetUrl,
        fields.title,
        fields.statusCode,
        fields.tagsJson,
        fields.isActive,
        fields.forwardQuery,
        fields.expiresAt,
        createdAt,
        updatedAt
      );

    pendingWrites.push({ index, slug, autoGeneratedSlug, op: "insert", id, stmt });
  }

  for (let i = 0; i < pendingWrites.length; i += WRITE_BATCH_CHUNK_SIZE) {
    const chunk = pendingWrites.slice(i, i + WRITE_BATCH_CHUNK_SIZE);
    let batchResults: Awaited<ReturnType<D1Database["batch"]>>;
    try {
      batchResults = await db.batch(chunk.map((w) => w.stmt));
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Database write failed for this chunk.";
      for (const write of chunk) {
        errors.push({
          index: write.index,
          slug: write.autoGeneratedSlug ? null : write.slug,
          code: "db_error",
          message,
        });
        failedCount++;
        resultsByIndex.set(write.index, {
          index: write.index,
          slug: write.autoGeneratedSlug ? "" : write.slug,
          status: "failed",
          reason: message,
        });
      }
      continue;
    }

    for (let j = 0; j < chunk.length; j++) {
      const write = chunk[j]!;
      const changes = Number(batchResults[j]?.meta?.changes ?? 0);

      if (write.op === "insert") {
        if (changes === 0) {
          if (write.autoGeneratedSlug) {
            const message = "Generated slug collided during insert.";
            errors.push({
              index: write.index,
              slug: null,
              code: "slug_generation_failed",
              message,
            });
            failedCount++;
            resultsByIndex.set(write.index, {
              index: write.index,
              slug: "",
              status: "failed",
              reason: message,
            });
          } else {
            skippedSlugSet.add(write.slug);
            skippedCount++;
            resultsByIndex.set(write.index, {
              index: write.index,
              slug: write.slug,
              status: "skipped",
              reason: "slug_exists",
            });
          }
        } else {
          createdSlugSet.add(write.slug);
          createdCount++;
          resultsByIndex.set(write.index, {
            index: write.index,
            slug: write.slug,
            status: "created",
            id: write.id,
          });
        }
      } else {
        if (changes === 0) {
          const message = `Link '${write.slug}' could not be updated.`;
          errors.push({
            index: write.index,
            slug: write.slug,
            code: "not_found",
            message,
          });
          failedCount++;
          resultsByIndex.set(write.index, {
            index: write.index,
            slug: write.slug,
            status: "failed",
            reason: message,
          });
        } else {
          if (!createdSlugSet.has(write.slug)) {
            updatedSlugSet.add(write.slug);
          }
          updatedCount++;
          resultsByIndex.set(write.index, {
            index: write.index,
            slug: write.slug,
            status: "updated",
            id: write.id,
          });
        }
      }
    }
  }

  const results: ImportItemResult[] = [];
  for (let index = 0; index < rawLinks.length; index++) {
    const itemResult = resultsByIndex.get(index);
    if (itemResult) {
      results.push(itemResult);
    }
  }

  return {
    version: EXPORT_SCHEMA_VERSION,
    onConflict,
    summary: {
      total: rawLinks.length,
      created: createdCount,
      updated: updatedCount,
      skipped: skippedCount,
      failed: failedCount,
    },
    skippedSlugs: Array.from(skippedSlugSet),
    createdSlugs: Array.from(createdSlugSet),
    updatedSlugs: Array.from(updatedSlugSet),
    errors,
    results,
  };
}
