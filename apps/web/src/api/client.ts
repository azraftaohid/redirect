import type {
  ApiErrorBody,
  CreateLinkInput,
  CreateTokenInput,
  LinkRecord,
  LinkStats,
  ListLinksQuery,
  Paginated,
  TokenInfo,
  UpdateLinkInput,
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
  const { token = getStoredToken(), headers: customHeaders, ...rest } = options;

  const headers = new Headers(customHeaders);
  headers.set("Accept", "application/json");

  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  let res: Response;
  try {
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
