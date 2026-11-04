import type { MiddlewareHandler } from "hono";
import type { AppContext } from "../types.js";
import { formatErrorResponse } from "../errors.js";
import { authenticate, ensureInitialToken, extractToken } from "./tokens.js";

export const authMiddleware: MiddlewareHandler<AppContext> = async (c, next) => {
  const token = extractToken(c.req.raw);

  if (token && token.length <= 512) {
    const principal = await authenticate(c.env, token);
    if (principal) {
      c.set("principal", principal);
      return next();
    }
  }

  // Lazy bootstrap on unauthenticated verify request (Decision F6 / H2.2)
  if (c.req.path === "/api/v1/auth/verify" && !token) {
    try {
      await ensureInitialToken(c.env);
    } catch (err) {
      console.error("Error in ensureInitialToken during auth failure:", err);
    }
  }

  const { status, body } = formatErrorResponse(
    401,
    "unauthorized",
    "Authentication required. Provide a valid Bearer token or X-API-Key."
  );

  return c.json(body, status, {
    "WWW-Authenticate": "Bearer",
    "Cache-Control": "no-store",
  });
};
