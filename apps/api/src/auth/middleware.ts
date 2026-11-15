import type { MiddlewareHandler } from "hono";
import type { AppContext } from "../types.js";
import { formatErrorResponse } from "../errors.js";
import { normalizeIpBucket } from "../utils/analytics.js";
import { authenticate, ensureInitialToken, extractToken } from "./tokens.js";

function rateLimitedResponse(c: Parameters<MiddlewareHandler<AppContext>>[0]) {
  const { status, body } = formatErrorResponse(
    429,
    "rate_limited",
    "Too many API requests. Please try again later."
  );
  return c.json(body, status, {
    "Retry-After": "60",
    "Cache-Control": "no-store",
  });
}

async function checkApiRateLimit(
  limiter: RateLimit | undefined,
  key: string
): Promise<boolean> {
  if (!limiter) {
    return true;
  }
  try {
    const { success } = await limiter.limit({ key });
    return success;
  } catch (err) {
    console.error("API rate limiter failed:", err);
    return true;
  }
}

export const authMiddleware: MiddlewareHandler<AppContext> = async (c, next) => {
  const cfIp = c.req.header("cf-connecting-ip")?.trim();
  if (cfIp && !(await checkApiRateLimit(c.env.API_LIMITER, `api:${normalizeIpBucket(cfIp)}`))) {
    return rateLimitedResponse(c);
  }

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
