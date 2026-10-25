import type { Env } from "../types.js";

export const APP_SECURITY_HEADERS = {
  "Content-Security-Policy":
    "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
} as const;

/**
 * Returns the 404 page: body of /404.html asset with status 404.
 * If the asset is missing, returns plain text "Not found" with status 404.
 */
export async function renderNotFound(request: Request, env: Env): Promise<Response> {
  if (env.ASSETS) {
    try {
      const res = await env.ASSETS.fetch(new Request(new URL("/404.html", request.url)));
      if (res.status === 200) {
        const headers = new Headers(res.headers);
        headers.set("Cache-Control", "no-store");
        return new Response(res.body, {
          status: 404,
          statusText: "Not Found",
          headers,
        });
      }
    } catch {
      // Ignore and fallback below
    }
  }

  return new Response("Not found", {
    status: 404,
    statusText: "Not Found",
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

/**
 * Serves the SPA frontend under /app/*:
 * 1. Try exact asset matching via env.ASSETS.fetch.
 * 2. If 404 and method is GET/HEAD and last path segment has no '.' (e.g. /app/, /app/dashboard),
 *    fallback to /app/index.html with status 200 (SPA client-side routing).
 * 3. Otherwise return the asset response (e.g. missing /app/missing.js remains 404).
 * 4. Add security headers (CSP, nosniff, Referrer-Policy) to all app responses.
 */
export async function serveApp(request: Request, env: Env): Promise<Response> {
  if (!env.ASSETS) {
    return renderNotFound(request, env);
  }

  let res = await env.ASSETS.fetch(request);
  const url = new URL(request.url);
  const segments = url.pathname.split("/").filter(Boolean);
  const lastSegment = segments.length > 0 ? segments[segments.length - 1]! : "";

  if (
    res.status === 404 &&
    (request.method === "GET" || request.method === "HEAD") &&
    !lastSegment.includes(".")
  ) {
    const indexReq = new Request(new URL("/app/index.html", request.url), request);
    const indexRes = await env.ASSETS.fetch(indexReq);
    res = new Response(indexRes.body, {
      status: 200,
      statusText: "OK",
      headers: indexRes.headers,
    });
  }

  const headers = new Headers(res.headers);
  for (const [key, value] of Object.entries(APP_SECURITY_HEADERS)) {
    headers.set(key, value);
  }

  return new Response(res.body, {
    status: res.status,
    statusText: res.statusText,
    headers,
  });
}
