import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { createTokenSchema, type TokenInfo } from "@redirect/shared";
import type { AppContext } from "../types.js";
import { ApiError } from "../errors.js";
import {
  generateToken,
  generateTokenId,
  maskToken,
  rotateInitialToken,
  type StoredTokenRecord,
} from "../auth/tokens.js";

export const tokensRouter = new Hono<AppContext>();

// GET /api/v1/auth/verify
tokensRouter.get("/auth/verify", (c) => {
  const principal = c.get("principal");
  return c.json({ principal }, 200, { "Cache-Control": "no-store" });
});

// GET /api/v1/tokens
tokensRouter.get("/tokens", async (c) => {
  const tokens: TokenInfo[] = [];

  // Prepend initial token if API_KEY is unset and initial_token exists
  if (!c.env.API_KEY) {
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

  // List all "token:*" keys with metadata
  let cursor: string | undefined = undefined;
  let pages = 0;
  const maxPages = 10;

  do {
    const listRes: KVNamespaceListResult<StoredTokenRecord> =
      await c.env.AUTH_TOKENS.list<StoredTokenRecord>({
        prefix: "token:",
        cursor,
      });
    pages++;

    for (const key of listRes.keys) {
      const actualToken = key.name.replace(/^token:/, "");
      const meta = key.metadata;
      tokens.push({
        id: meta?.id ?? "unknown",
        name: meta?.name ?? "Custom token",
        createdAt: meta?.createdAt ?? new Date().toISOString(),
        expiresAt: meta?.expiresAt ?? null,
        preview: maskToken(actualToken),
      });
    }

    if (listRes.list_complete || pages >= maxPages) {
      break;
    }
    cursor = listRes.cursor;
  } while (cursor);

  return c.json({ data: tokens }, 200, { "Cache-Control": "no-store" });
});

// POST /api/v1/tokens
tokensRouter.post(
  "/tokens",
  zValidator("json", createTokenSchema, (result) => {
    if (!result.success) {
      throw new ApiError(400, "validation_error", "Validation failed", result.error.issues);
    }
  }),
  async (c) => {
    const { name, expiresAt } = c.req.valid("json");
    const rawToken = generateToken();
    const id = generateTokenId();
    const createdAt = new Date().toISOString();

    const record: StoredTokenRecord = {
      id,
      name,
      createdAt,
      expiresAt: expiresAt ?? null,
    };

    const options: KVNamespacePutOptions = {
      metadata: record,
    };

    if (expiresAt) {
      const expSeconds = Math.floor(new Date(expiresAt).getTime() / 1000);
      if (Number.isFinite(expSeconds) && expSeconds > Math.floor(Date.now() / 1000)) {
        options.expiration = expSeconds;
      }
    }

    await c.env.AUTH_TOKENS.put(`token:${rawToken}`, JSON.stringify(record), options);

    return c.json(
      {
        token: rawToken,
        id,
        name,
        createdAt,
        expiresAt: record.expiresAt,
        preview: maskToken(rawToken),
      },
      201,
      { "Cache-Control": "no-store" }
    );
  }
);

// DELETE /api/v1/tokens/:id
tokensRouter.delete("/tokens/:id", async (c) => {
  const id = c.req.param("id");

  if (id === "initial") {
    throw new ApiError(
      409,
      "initial_token_protected",
      "Rotate it with POST /api/v1/tokens/initial/rotate or delete the initial_token key in the Cloudflare dashboard."
    );
  }

  // Find the token by id via list
  let cursor: string | undefined = undefined;
  let targetKey: string | null = null;
  let pages = 0;

  do {
    const listRes: KVNamespaceListResult<StoredTokenRecord> =
      await c.env.AUTH_TOKENS.list<StoredTokenRecord>({
        prefix: "token:",
        cursor,
      });
    pages++;

    for (const key of listRes.keys) {
      if (key.metadata?.id === id) {
        targetKey = key.name;
        break;
      }
    }

    if (targetKey || listRes.list_complete || pages >= 10) {
      break;
    }
    cursor = listRes.cursor;
  } while (cursor);

  if (!targetKey) {
    throw new ApiError(404, "not_found", `Token with id '${id}' not found.`);
  }

  await c.env.AUTH_TOKENS.delete(targetKey);
  return c.json({ deleted: true, id }, 200, { "Cache-Control": "no-store" });
});

// POST /api/v1/tokens/initial/rotate
tokensRouter.post("/tokens/initial/rotate", async (c) => {
  if (c.env.API_KEY && c.env.API_KEY.length > 0) {
    throw new ApiError(409, "mechanism_disabled", "Cannot rotate initial token when API_KEY is set.");
  }

  const newToken = await rotateInitialToken(c.env);
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
