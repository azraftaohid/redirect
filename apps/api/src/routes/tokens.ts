import { Hono, type MiddlewareHandler } from "hono";
import { zValidator } from "@hono/zod-validator";
import { createTokenSchema, randomBase62, type TokenInfo } from "@redirect/shared";
import type { AppContext } from "../types.js";
import { ApiError } from "../errors.js";
import {
  generateToken,
  maskToken,
  rotateInitialToken,
  TOKEN_ID_LENGTH,
  type StoredTokenMetadata,
} from "../auth/tokens.js";
import { logAuditEvent } from "../utils/audit.js";
import { isBrandingExternalLinksDisabled } from "./app.js";

export const tokensRouter = new Hono<AppContext>();

const requireTokenAdmin: MiddlewareHandler<AppContext> = async (c, next) => {
  const principal = c.get("principal");
  if (!principal || (principal.kind !== "env" && principal.kind !== "initial")) {
    logAuditEvent("auth.forbidden", principal, {
      path: c.req.path,
      method: c.req.method,
    });
    throw new ApiError(
      403,
      "forbidden",
      "Token management requires the initial token or master API_KEY."
    );
  }
  return next();
};

// GET /api/v1/auth/verify
tokensRouter.get("/auth/verify", (c) => {
  const principal = c.get("principal");
  return c.json(
    {
      principal,
      brandingExternalLinks: !isBrandingExternalLinksDisabled(c.env),
    },
    200,
    { "Cache-Control": "no-store" }
  );
});

// GET /api/v1/tokens
tokensRouter.get("/tokens", requireTokenAdmin, async (c) => {
  const tokens: TokenInfo[] = [];

  // Prepend initial token if API_KEY is unset and initial_token exists (initial principal only passes when enabled)
  if (!c.env.API_KEY?.trim()) {
    const { value: initialToken, metadata } =
      await c.env.AUTH_TOKENS.getWithMetadata<{ createdAt?: string }>("initial_token");
    if (initialToken) {
      tokens.push({
        id: "initial",
        name: "Initial token",
        isInitial: true,
        createdAt: metadata?.createdAt ?? new Date().toISOString(),
        expiresAt: null,
        preview: maskToken(initialToken),
      });
    }
  }

  // List all "token:*" keys with metadata (no value reads)
  let cursor: string | undefined = undefined;
  const customTokens: TokenInfo[] = [];
  let pageCount = 0;
  const MAX_KV_LIST_PAGES = 5; // Caps at 5 pages (up to 5,000 keys)

  do {
    pageCount++;
    const listRes: KVNamespaceListResult<StoredTokenMetadata> =
      await c.env.AUTH_TOKENS.list<StoredTokenMetadata>({
        prefix: "token:",
        cursor,
      });

    for (const key of listRes.keys) {
      const id = key.name.slice("token:".length);
      const meta = key.metadata;
      customTokens.push({
        id,
        name: meta?.name ?? "Custom token",
        createdAt: meta?.createdAt ?? new Date().toISOString(),
        expiresAt: meta?.expiresAt ?? null,
        preview: meta?.preview ?? `rdir_${id}_...`,
      });
    }

    if (listRes.list_complete || pageCount >= MAX_KV_LIST_PAGES) {
      break;
    }
    cursor = listRes.cursor;
  } while (cursor);

  // Sort custom tokens by createdAt desc
  customTokens.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  tokens.push(...customTokens);

  return c.json({ data: tokens }, 200, { "Cache-Control": "no-store" });
});

// POST /api/v1/tokens
tokensRouter.post(
  "/tokens",
  requireTokenAdmin,
  zValidator("json", createTokenSchema, (result) => {
    if (!result.success) {
      throw new ApiError(400, "validation_error", "Validation failed", result.error.issues);
    }
  }),
  async (c) => {
    if (c.env.API_KEY && c.env.API_KEY.trim().length > 0) {
      throw new ApiError(
        409,
        "mechanism_disabled",
        "Cannot create custom tokens when API_KEY is set because strict API_KEY lockdown disables custom tokens."
      );
    }

    const { name, expiresAt } = c.req.valid("json");

    if (expiresAt) {
      const expMs = Date.parse(expiresAt);
      if (!Number.isFinite(expMs) || expMs < Date.now() + 120_000) {
        throw new ApiError(
          400,
          "invalid_expiry",
          "Token expiry must be at least 2 minutes in the future."
        );
      }
    }

    const id = randomBase62(TOKEN_ID_LENGTH);
    const token = generateToken(id);
    const createdAt = new Date().toISOString();
    const preview = maskToken(token);

    const metadata: StoredTokenMetadata = {
      name,
      createdAt,
      expiresAt: expiresAt ?? null,
      preview,
    };

    const options: KVNamespacePutOptions = {
      metadata,
    };

    if (expiresAt) {
      options.expiration = Math.floor(Date.parse(expiresAt) / 1000);
    }

    await c.env.AUTH_TOKENS.put(`token:${id}`, token, options);
    logAuditEvent("token.create", c.get("principal"), {
      tokenId: id,
      tokenName: name,
      expiresAt: metadata.expiresAt,
    });

    return c.json(
      {
        token,
        id,
        name,
        createdAt,
        expiresAt: metadata.expiresAt,
        preview,
      },
      201,
      { "Cache-Control": "no-store" }
    );
  }
);

// DELETE /api/v1/tokens — Emergency revocation of all custom tokens ("token:*")
tokensRouter.delete("/tokens", requireTokenAdmin, async (c) => {
  const MAX_KV_LIST_PAGES = 5;
  const DELETE_BATCH_SIZE = 25;
  let cursor: string | undefined = undefined;
  let pageCount = 0;
  let count = 0;
  let truncated = false;

  do {
    pageCount++;
    const listRes: KVNamespaceListResult<StoredTokenMetadata> =
      await c.env.AUTH_TOKENS.list<StoredTokenMetadata>({
        prefix: "token:",
        limit: 100,
        cursor,
      });

    for (let i = 0; i < listRes.keys.length; i += DELETE_BATCH_SIZE) {
      const batch = listRes.keys.slice(i, i + DELETE_BATCH_SIZE);
      await Promise.all(batch.map((key) => c.env.AUTH_TOKENS.delete(key.name)));
      count += batch.length;
    }

    if (listRes.list_complete) {
      break;
    }
    if (pageCount >= MAX_KV_LIST_PAGES || !listRes.cursor) {
      truncated = true;
      break;
    }
    cursor = listRes.cursor;
  } while (cursor);

  logAuditEvent("token.revoke_all", c.get("principal"), { revokedCount: count, truncated });
  return c.json({ deleted: true, count, truncated }, 200, { "Cache-Control": "no-store" });
});

// DELETE /api/v1/tokens/:id
tokensRouter.delete("/tokens/:id", requireTokenAdmin, async (c) => {
  const id = c.req.param("id");

  if (id === "initial") {
    throw new ApiError(
      409,
      "initial_token_protected",
      "Rotate it with POST /api/v1/tokens/initial/rotate or delete the initial_token key in the Cloudflare dashboard."
    );
  }

  if (!/^[A-Za-z0-9]{10}$/.test(id)) {
    throw new ApiError(404, "not_found", `Token with id '${id}' not found.`);
  }

  await c.env.AUTH_TOKENS.delete(`token:${id}`);
  logAuditEvent("token.revoke", c.get("principal"), { tokenId: id });
  return c.json({ deleted: true, id }, 200, { "Cache-Control": "no-store" });
});

// POST /api/v1/tokens/initial/rotate
tokensRouter.post("/tokens/initial/rotate", requireTokenAdmin, async (c) => {
  if (c.env.API_KEY && c.env.API_KEY.trim().length > 0) {
    throw new ApiError(409, "mechanism_disabled", "Cannot rotate initial token when API_KEY is set.");
  }

  const newToken = await rotateInitialToken(c.env);
  logAuditEvent("token.initial_rotate", c.get("principal"));
  return c.json(
    {
      token: newToken,
      id: "initial",
      name: "Initial token",
      isInitial: true,
      preview: maskToken(newToken),
    },
    200,
    { "Cache-Control": "no-store" }
  );
});
