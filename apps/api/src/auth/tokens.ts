import type { Env, Principal } from "../types.js";

export const TOKEN_REGEX = /^[A-Za-z0-9_-]{16,128}$/;
const BEARER_REGEX = /^Bearer[ \t]+(\S.*)$/i;

export interface StoredTokenRecord {
  id: string;
  name: string;
  createdAt: string;
  expiresAt: string | null;
}

export function generateToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `rdir_${hex}`;
}

export function generateTokenId(): string {
  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function maskToken(token: string): string {
  if (token.length <= 13) {
    return `${token.slice(0, 4)}...`;
  }
  return `${token.slice(0, 9)}...${token.slice(-4)}`;
}

/**
 * Constant-time string equality comparison using SHA-256 digest XOR.
 */
export async function safeEqual(a: string, b: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const aBuf = encoder.encode(a);
  const bBuf = encoder.encode(b);

  const [aHash, bHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", aBuf),
    crypto.subtle.digest("SHA-256", bBuf),
  ]);

  const aView = new Uint8Array(aHash);
  const bView = new Uint8Array(bHash);

  if (aView.byteLength !== bView.byteLength) {
    return false;
  }

  let diff = 0;
  for (let i = 0; i < aView.byteLength; i++) {
    diff |= (aView[i] ?? 0) ^ (bView[i] ?? 0);
  }

  return diff === 0;
}

export function extractToken(request: Request): string | null {
  const authHeader = request.headers.get("Authorization");
  if (authHeader) {
    const match = BEARER_REGEX.exec(authHeader);
    if (match?.[1]) {
      return match[1].trim();
    }
  }

  const apiKeyHeader = request.headers.get("X-API-Key");
  if (apiKeyHeader) {
    return apiKeyHeader.trim();
  }

  return null;
}

export async function authenticate(env: Env, token: string): Promise<Principal | null> {
  if (!TOKEN_REGEX.test(token)) {
    return null;
  }

  // 1. env.API_KEY set and matches token
  if (env.API_KEY && env.API_KEY.length > 0) {
    if (await safeEqual(token, env.API_KEY)) {
      return { kind: "env", id: "env", name: "Environment API key" };
    }
  }

  // 2. Lookup in AUTH_TOKENS: "token:" + token
  if (env.AUTH_TOKENS) {
    const record = await env.AUTH_TOKENS.get<StoredTokenRecord>(`token:${token}`, "json");
    if (record) {
      if (record.expiresAt) {
        const expiresTime = new Date(record.expiresAt).getTime();
        if (Number.isFinite(expiresTime) && expiresTime <= Date.now()) {
          return null; // Expired
        }
      }
      return { kind: "token", id: record.id, name: record.name };
    }

    // 3. Only if env.API_KEY is NOT set: check initial_token
    if (!env.API_KEY) {
      const initialToken = await env.AUTH_TOKENS.get("initial_token");
      if (initialToken && (await safeEqual(token, initialToken))) {
        return { kind: "initial", id: "initial", name: "Initial token" };
      }
    }
  }

  return null;
}

export async function ensureInitialToken(env: Env): Promise<string | null> {
  if (env.API_KEY && env.API_KEY.length > 0) {
    return null; // env.API_KEY takes precedence, initial_token mechanism disabled
  }

  if (!env.AUTH_TOKENS) {
    return null;
  }

  try {
    const existing = await env.AUTH_TOKENS.get("initial_token");
    if (existing) {
      return existing;
    }

    const token = generateToken();
    const createdAt = new Date().toISOString();
    await env.AUTH_TOKENS.put("initial_token", token, {
      metadata: { createdAt },
    });
    return token;
  } catch (err) {
    console.error("Failed to ensure initial token:", err);
    return null;
  }
}

export async function rotateInitialToken(env: Env): Promise<string> {
  if (env.API_KEY && env.API_KEY.length > 0) {
    throw new Error("Cannot rotate initial token when API_KEY is set.");
  }

  const token = generateToken();
  const createdAt = new Date().toISOString();
  await env.AUTH_TOKENS.put("initial_token", token, {
    metadata: { createdAt },
  });
  return token;
}
