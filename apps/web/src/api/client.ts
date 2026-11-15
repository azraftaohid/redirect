import {
  EXPORT_SCHEMA_VERSION,
  IMPORT_CLIENT_CHUNK_SIZE,
  IMPORT_MAX_BATCH_SIZE,
  type ApiErrorBody,
  type CreateLinkInput,
  type CreateTokenInput,
  type ExportedLink,
  type ExportLinksQuery,
  type ImportConflictMode,
  type ImportItemError,
  type ImportItemResult,
  type ImportLinkInput,
  type ImportLinksRequest,
  type ImportLinksResponse,
  type LinkRecord,
  type LinksExportEnvelope,
  type LinkStats,
  type ListLinksQuery,
  type Paginated,
  type TokenInfo,
  type UpdateLinkInput,
} from "@redirect/shared";

export const AUTH_TOKEN_STORAGE_KEY = "redirect_auth_token";
export const AUTH_TOKEN_SET_AT_STORAGE_KEY = "redirect_auth_token_set_at";

export function getStoredToken(): string | null {
  try {
    return localStorage.getItem(AUTH_TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function getStoredTokenSetAt(): number {
  try {
    return Number(localStorage.getItem(AUTH_TOKEN_SET_AT_STORAGE_KEY) || 0);
  } catch {
    return 0;
  }
}

export function setStoredToken(token: string): void {
  try {
    localStorage.setItem(AUTH_TOKEN_STORAGE_KEY, token);
    localStorage.setItem(AUTH_TOKEN_SET_AT_STORAGE_KEY, Date.now().toString());
  } catch {}
}

export function clearStoredToken(): void {
  try {
    localStorage.removeItem(AUTH_TOKEN_STORAGE_KEY);
    localStorage.removeItem(AUTH_TOKEN_SET_AT_STORAGE_KEY);
  } catch {}
}

export class ApiClientError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = "ApiClientError";
  }
}

export class AccessSessionExpiredError extends Error {
  constructor(
    message = "Your session may have expired or the server is unreachable. Please reload the page to reconnect."
  ) {
    super(message);
    this.name = "AccessSessionExpiredError";
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("redirect:access-expired"));
    }
  }
}

export interface AuthPrincipal {
  kind: "env" | "token" | "initial";
  id: string;
  name: string;
}

interface RequestOptions extends RequestInit {
  token?: string | null;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const isStoredToken = options.token === undefined;
  const token = isStoredToken ? getStoredToken() : options.token;

  const headers = new Headers(options.headers);
  headers.set("Accept", "application/json");

  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  let res: Response;
  try {
    const { token: _t, headers: _h, ...rest } = options;
    res = await fetch(path, {
      ...rest,
      headers,
      credentials: "same-origin",
      redirect: "manual",
    });
  } catch (err) {
    // If browser fetch threw a TypeError while online on same-origin call, it indicates
    // a cross-origin redirect to an Access IdP was blocked by CORS.
    if (typeof navigator !== "undefined" && navigator.onLine && err instanceof TypeError) {
      throw new AccessSessionExpiredError();
    }
    throw err;
  }

  // Detect opaque redirect or status 0 (Cloudflare Access redirected the response)
  if (res.type === "opaqueredirect" || res.status === 0) {
    throw new AccessSessionExpiredError();
  }

  const contentType = res.headers.get("content-type") || "";

  // If HTML is returned on status < 500, Cloudflare Access served its login page
  if (contentType.includes("text/html") && res.status < 500) {
    throw new AccessSessionExpiredError();
  }

  if (!res.ok) {
    if (res.status === 401 && isStoredToken && token) {
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("redirect:unauthorized"));
      }
    }

    if (contentType.includes("application/json")) {
      const errorBody = (await res.json()) as ApiErrorBody;
      throw new ApiClientError(
        res.status,
        errorBody.error.code,
        errorBody.error.message,
        errorBody.error.details
      );
    }
    throw new ApiClientError(
      res.status,
      "http_error",
      `Request failed with status ${res.status}`
    );
  }

  return (await res.json()) as T;
}

// -----------------------------------------------------------------------------
// Typed API Endpoints
// -----------------------------------------------------------------------------

export async function verifyAuth(candidateToken?: string): Promise<{ principal: AuthPrincipal }> {
  return request<{ principal: AuthPrincipal }>("/api/v1/auth/verify", {
    method: "GET",
    token: candidateToken !== undefined ? candidateToken : getStoredToken(),
  });
}

export async function bootstrapInitialTokenPing(): Promise<void> {
  try {
    // Unauthenticated GET /api/v1/auth/verify triggers ensureInitialToken on the server
    await fetch("/api/v1/auth/verify", {
      method: "GET",
      credentials: "same-origin",
      redirect: "manual",
    });
  } catch {
    // Swallow any errors since 401 is expected
  }
}

export async function listLinks(
  query: Partial<ListLinksQuery> = {}
): Promise<Paginated<LinkRecord>> {
  const params = new URLSearchParams();
  if (query.limit) params.set("limit", String(query.limit));
  if (query.offset) params.set("offset", String(query.offset));
  if (query.search) params.set("search", query.search);
  if (query.targetUrl) params.set("targetUrl", query.targetUrl);
  if (query.tag) params.set("tag", query.tag);
  if (query.isActive !== undefined) params.set("isActive", String(query.isActive));
  if (query.sortBy) params.set("sortBy", query.sortBy);
  if (query.sortOrder) params.set("sortOrder", query.sortOrder);

  const qs = params.toString();
  return request<Paginated<LinkRecord>>(`/api/v1/links${qs ? `?${qs}` : ""}`, {
    method: "GET",
  });
}

export async function getLink(id: string): Promise<LinkRecord> {
  return request<LinkRecord>(`/api/v1/links/${encodeURIComponent(id)}`, {
    method: "GET",
  });
}

export async function createLink(input: CreateLinkInput): Promise<LinkRecord> {
  return request<LinkRecord>("/api/v1/links", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export async function updateLink(id: string, input: UpdateLinkInput): Promise<LinkRecord> {
  return request<LinkRecord>(`/api/v1/links/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export async function deleteLink(id: string): Promise<{ deleted: true; id: string }> {
  return request<{ deleted: true; id: string }>(`/api/v1/links/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

export async function getLinkStats(id: string, days?: number): Promise<LinkStats> {
  const qs = days ? `?days=${encodeURIComponent(days)}` : "";
  return request<LinkStats>(`/api/v1/links/${encodeURIComponent(id)}/stats${qs}`, {
    method: "GET",
  });
}

export async function listTokens(): Promise<{ data: TokenInfo[] }> {
  return request<{ data: TokenInfo[] }>("/api/v1/tokens", {
    method: "GET",
  });
}

export async function createToken(
  input: CreateTokenInput
): Promise<TokenInfo & { token: string }> {
  return request<TokenInfo & { token: string }>("/api/v1/tokens", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export async function deleteToken(id: string): Promise<{ deleted: true; id: string }> {
  return request<{ deleted: true; id: string }>(`/api/v1/tokens/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

export async function revokeAllTokens(): Promise<{
  deleted: true;
  count: number;
  truncated: boolean;
}> {
  return request<{ deleted: true; count: number; truncated: boolean }>("/api/v1/tokens", {
    method: "DELETE",
  });
}

export async function rotateInitialToken(): Promise<{
  token: string;
  id: "initial";
  name: string;
  isInitial: true;
  preview: string;
}> {
  return request<{
    token: string;
    id: "initial";
    name: string;
    isInitial: true;
    preview: string;
  }>("/api/v1/tokens/initial/rotate", {
    method: "POST",
  });
}

export async function exportLinksChunk(
  query: Partial<ExportLinksQuery> = {}
): Promise<LinksExportEnvelope> {
  const params = new URLSearchParams();
  if (query.limit) params.set("limit", String(query.limit));
  if (query.cursor) params.set("cursor", query.cursor);
  if (query.search) params.set("search", query.search);
  if (query.tag) params.set("tag", query.tag);
  if (query.isActive !== undefined) params.set("isActive", String(query.isActive));

  const qs = params.toString();
  return request<LinksExportEnvelope>(`/api/v1/links/export${qs ? `?${qs}` : ""}`, {
    method: "GET",
  });
}

export class ImportChunkError extends Error {
  readonly partialResponse: ImportLinksResponse;
  readonly causeError: unknown;

  constructor(
    message: string,
    partialResponse: ImportLinksResponse,
    causeError: unknown
  ) {
    super(message);
    this.name = "ImportChunkError";
    this.partialResponse = partialResponse;
    this.causeError = causeError;
  }
}

export async function exportAllLinks(options?: {
  search?: string;
  tag?: string;
  isActive?: "true" | "false";
  limitPerChunk?: number;
  maxPages?: number;
  onProgress?: (fetchedCount: number) => void;
}): Promise<LinksExportEnvelope> {
  const maxPages = Math.max(1, options?.maxPages ?? 200);
  const allLinks: ExportedLink[] = [];
  let cursor: string | undefined = undefined;
  let hasMore = false;

  for (let page = 0; page < maxPages; page++) {
    const res = await exportLinksChunk({
      search: options?.search,
      tag: options?.tag,
      isActive: options?.isActive,
      limit: options?.limitPerChunk,
      cursor,
    });

    allLinks.push(...res.links);
    options?.onProgress?.(allLinks.length);

    if (!res.pagination?.hasMore || !res.pagination.nextCursor) {
      hasMore = false;
      break;
    }
    hasMore = true;
    cursor = res.pagination.nextCursor;
  }

  if (hasMore) {
    throw new Error(
      `Export exceeded the maximum page limit (${maxPages} pages, ${allLinks.length} links fetched). Apply filters to export a smaller subset.`
    );
  }

  return {
    version: EXPORT_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    count: allLinks.length,
    links: allLinks,
  };
}

export async function importLinksBatch(input: ImportLinksRequest): Promise<ImportLinksResponse> {
  return request<ImportLinksResponse>("/api/v1/links/import", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export async function importLinksChunked(
  links: ImportLinkInput[],
  options?: {
    onConflict?: ImportConflictMode;
    chunkSize?: number;
    onProgress?: (processed: number, total: number) => void;
  }
): Promise<ImportLinksResponse> {
  const onConflict: ImportConflictMode = options?.onConflict ?? "skip";
  if (links.length === 0) {
    return {
      version: EXPORT_SCHEMA_VERSION,
      onConflict,
      summary: { total: 0, created: 0, updated: 0, skipped: 0, failed: 0 },
      skippedSlugs: [],
      createdSlugs: [],
      updatedSlugs: [],
      errors: [],
      results: [],
    };
  }

  const chunkSize = Math.max(
    1,
    Math.min(options?.chunkSize ?? IMPORT_CLIENT_CHUNK_SIZE, IMPORT_MAX_BATCH_SIZE)
  );

  const summary = {
    total: 0,
    created: 0,
    updated: 0,
    skipped: 0,
    failed: 0,
  };
  const skippedSlugSet = new Set<string>();
  const createdSlugSet = new Set<string>();
  const updatedSlugSet = new Set<string>();
  const errors: ImportItemError[] = [];
  const results: ImportItemResult[] = [];

  const buildPartialResponse = (): ImportLinksResponse => ({
    version: EXPORT_SCHEMA_VERSION,
    onConflict,
    summary: { ...summary },
    skippedSlugs: Array.from(skippedSlugSet),
    createdSlugs: Array.from(createdSlugSet),
    updatedSlugs: Array.from(updatedSlugSet),
    errors: [...errors],
    results: [...results],
  });

  const totalChunks = Math.ceil(links.length / chunkSize);

  for (let offset = 0; offset < links.length; offset += chunkSize) {
    const chunk = links.slice(offset, offset + chunkSize);
    let res: ImportLinksResponse;
    try {
      res = await importLinksBatch({
        version: EXPORT_SCHEMA_VERSION,
        onConflict,
        links: chunk,
      });
    } catch (err) {
      const reason = err instanceof Error ? err.message : "Unknown error";
      const chunkNumber = Math.floor(offset / chunkSize) + 1;
      throw new ImportChunkError(
        `Import interrupted at chunk ${chunkNumber}/${totalChunks} (${offset} of ${links.length} links processed): ${reason}`,
        buildPartialResponse(),
        err
      );
    }

    summary.total += res.summary.total;
    summary.created += res.summary.created;
    summary.updated += res.summary.updated;
    summary.skipped += res.summary.skipped;
    summary.failed += res.summary.failed;

    for (const s of res.skippedSlugs) skippedSlugSet.add(s);
    for (const s of res.createdSlugs) createdSlugSet.add(s);
    for (const s of res.updatedSlugs) {
      if (!createdSlugSet.has(s)) {
        updatedSlugSet.add(s);
      }
    }

    for (const err of res.errors) {
      errors.push({
        ...err,
        index: err.index + offset,
      });
    }

    for (const item of res.results) {
      results.push({
        ...item,
        index: item.index + offset,
      });
    }

    options?.onProgress?.(Math.min(offset + chunk.length, links.length), links.length);
  }

  return buildPartialResponse();
}
