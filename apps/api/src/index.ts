import { Hono } from "hono";
import { RESERVED_SLUGS, SLUG_REGEX } from "@redirect/shared";
import type { AppContext, Env } from "./types.js";
import { handleApiError, ApiError } from "./errors.js";
import { authMiddleware } from "./auth/middleware.js";
import { tokensRouter } from "./routes/tokens.js";
import { linksRouter } from "./routes/links.js";
import { statsRouter } from "./routes/stats.js";
import { handleRedirect, handleRoot, respondUnknownLink } from "./routes/redirect.js";
import { serveApp, renderNotFound } from "./routes/app.js";

// API Hono app
const apiApp = new Hono<AppContext>();

apiApp.use("*", async (c, next) => {
  await next();
  c.header("X-Robots-Tag", "noindex, nofollow");
  c.header("X-Content-Type-Options", "nosniff");
});

apiApp.onError((err, c) => {
  return handleApiError(err, c);
});

// API v1 Sub-app
const apiV1 = new Hono<AppContext>();
apiV1.use("*", authMiddleware);
apiV1.route("/", tokensRouter);
apiV1.route("/", linksRouter);
apiV1.route("/", statsRouter);

apiApp.route("/api/v1", apiV1);

// Any other /api/* route -> 404 JSON
apiApp.all("/api/*", () => {
  throw new ApiError(404, "not_found", "API endpoint not found.");
});

// Single segment regex: leading slash, slug, optional trailing slash
const SINGLE_SEGMENT_REGEX = /^\/([^\/]+)\/?$/;

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const pathname = url.pathname;

    // 1. /api/v1 or /api/v1/* -> API router (Hono sub-app). Any other path starting with /api -> JSON 404.
    if (pathname === "/api/v1" || pathname.startsWith("/api/v1/")) {
      return apiApp.fetch(request, env, ctx);
    }
    if (pathname === "/api" || pathname.startsWith("/api/")) {
      return apiApp.fetch(request, env, ctx);
    }

    // 2. /app -> 308 redirect to /app/
    if (pathname === "/app") {
      const target = new URL(`/app/${url.search}`, request.url);
      return new Response(null, {
        status: 308,
        headers: {
          Location: target.toString(),
        },
      });
    }

    // 3. /app/* -> serveApp()
    if (pathname.startsWith("/app/")) {
      return serveApp(request, env);
    }

    // 4. / -> rootHandler(): valid FALLBACK_URL -> 307, else the 404 page.
    if (pathname === "/") {
      return handleRoot(request, env);
    }

    // 5. Single segment (one optional trailing /) that matches SLUG_REGEX against raw path -> redirect handler.
    const match = pathname.match(SINGLE_SEGMENT_REGEX);
    if (match && match[1] && SLUG_REGEX.test(match[1])) {
      const segment = match[1];
      if ((RESERVED_SLUGS as readonly string[]).includes(segment.toLowerCase())) {
        if (request.method !== "GET" && request.method !== "HEAD") {
          return new Response("Method Not Allowed", {
            status: 405,
            headers: {
              Allow: "GET, HEAD",
              "Content-Type": "text/plain; charset=utf-8",
            },
          });
        }
        return respondUnknownLink(request, env);
      }
      return handleRedirect(segment, request, env, ctx);
    }

    // 6. Anything else -> try env.ASSETS.fetch(request) for an exact static file (e.g. /favicon.ico); if it returns 404, return the 404 page.
    if (env.ASSETS) {
      try {
        const assetRes = await env.ASSETS.fetch(request);
        if (assetRes.status !== 404) {
          return assetRes;
        }
      } catch {
        // Ignore asset fetch failure and fallback to 404 page
      }
    }

    return renderNotFound(request, env);
  },
};
