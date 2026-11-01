import { randomBase62 } from "@redirect/shared";
import type { Env, Principal } from "../types.js";

export const TOKEN_PREFIX = "rdir_";
export const TOKEN_ID_LENGTH = 10;
export const TOKEN_SECRET_LENGTH = 32;
export const INITIAL_TOKEN_ID = "initial";
export const TOKEN_FORMAT = /^rdir_([A-Za-z0-9]{1,16})_([A-Za-z0-9]{32})$/;

const BEARER_REGEX = /^Bearer[ \t]+(\S.*)$/i;

export interface StoredTokenMetadata {
  name: string;
  createdAt: string;
  expiresAt: string | null;
  preview: string;
}

export function generateToken(id: string): string {
  return `${TOKEN_PREFIX}${id}_${randomBase62(TOKEN_SECRET_LENGTH)}`;
}

export function parseToken(raw: string): { id: string } | null {
  const match = TOKEN_FORMAT.exec(raw);
  if (!match || !match[1]) {
    return null;
  }
  return { id: match[1] };
}

export function maskToken(raw: string): string {
  const parsed = parseToken(raw);
  if (!parsed) {
    if (raw.length <= 13) {
      return `${raw.slice(0, 4)}...`;
    }
    return `${raw.slice(0, 9)}...${raw.slice(-4)}`;
  }
  return `rdir_${parsed.id}_...${raw.slice(-4)}`;
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
  // 1. env.API_KEY set and matches token (checked before any format validation)
  if (env.API_KEY && env.API_KEY.trim().length > 0) {
    if (await safeEqual(token, env.API_KEY.trim())) {
      return { kind: "env", id: "env", name: "Environment API key" };
    }
  }

  // 2. Validate token format
  const parsed = parseToken(token);
  if (!parsed) {
    return null;
  }

  if (!env.AUTH_TOKENS) {
    return null;
  }

  // 3. Initial token check (only when API_KEY is unset)
  if (parsed.id === INITIAL_TOKEN_ID) {
    if (env.API_KEY && env.API_KEY.trim().length > 0) {
      return null;
    }
    const initialToken = await env.AUTH_TOKENS.get("initial_token");
    if (initialToken && (await safeEqual(initialToken, token))) {
      return { kind: "initial", id: "initial", name: "Initial token" };
    }
    return null;
  }

  // 4. Custom token check via single direct KV read: "token:" + parsed.id
  const { value, metadata } = await env.AUTH_TOKENS.getWithMetadata<StoredTokenMetadata>(
    `token:${parsed.id}`
  );
  if (!value || !(await safeEqual(value, token))) {
    return null;
  }

  if (metadata?.expiresAt) {
    const expiresTime = new Date(metadata.expiresAt).getTime();
    if (Number.isFinite(expiresTime) && expiresTime <= Date.now()) {
      return null; // Expired
    }
  }

  return {
    kind: "token",
    id: parsed.id,
    name: metadata?.name ?? "Custom token",
  };
}

export async function ensureInitialToken(env: Env): Promise<string | null> {
  if (env.API_KEY && env.API_KEY.trim().length > 0) {
    return null; // env.API_KEY takes precedence, initial_token mechanism disabled
  }

  if (!env.AUTH_TOKENS) {
    return null;
  }

  try {
    const existing = await env.AUTH_TOKENS.get("initial_token");
    if (existing && parseToken(existing)?.id === INITIAL_TOKEN_ID) {
      return existing;
    }

    if (existing) {
      console.warn("Replacing malformed initial_token in KV with fresh token.");
    }

    const token = generateToken(INITIAL_TOKEN_ID);
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
  if (env.API_KEY && env.API_KEY.trim().length > 0) {
    throw new Error("Cannot rotate initial token when API_KEY is set.");
  }

  const token = generateToken(INITIAL_TOKEN_ID);
  const createdAt = new Date().toISOString();
  await env.AUTH_TOKENS.put("initial_token", token, {
    metadata: { createdAt },
  });
  return token;
}
