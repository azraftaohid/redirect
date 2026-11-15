import { parseOwnHostnames, validateTargetUrl } from "@redirect/shared";
import type { Env } from "../types.js";
import { mergeQuery } from "../utils/query.js";
import { isAnalyticsDisabled, isCountableClick, normalizeIpBucket, recordClick } from "../utils/analytics.js";
import { renderNotFound } from "./app.js";

interface LinkRedirectRow {
  id: string;
  target_url: string;
  status_code: number;
  is_active: number;
  forward_query: number;
  expires_at: string | null;
}

/**
 * Responds to unknown, inactive, expired, or reserved links:
 * If a valid and loop-free FALLBACK_URL is configured, redirect to it (307).
 * Otherwise, render the 404 page.
 */
export async function respondUnknownLink(request: Request, env: Env): Promise<Response> {
  const fallbackUrl = env.FALLBACK_URL?.trim();
  if (fallbackUrl) {
    const ownHostnames = parseOwnHostnames(new URL(request.url).hostname, env.OWN_HOSTNAMES);
    const validation = validateTargetUrl(fallbackUrl, ownHostnames);
    if (validation.ok) {
      try {
        return new Response(null, {
          status: 307,
          headers: {
            Location: fallbackUrl,
            "Cache-Control": "no-store",
            "X-Content-Type-Options": "nosniff",
          },
        });
      } catch {
        console.error("Failed to construct fallback redirect response");
      }
    }
  }
  return renderNotFound(request, env);
}

/**
 * Handles incoming single-slug redirection:
 * 1. Queries D1 for exact matching slug.
 * 2. On DB failure, returns 503 (never 404).
 * 3. On miss (unknown, inactive, expired), redirects to FALLBACK_URL (307) if valid and loop-free,
 *    otherwise renders the 404 page.
 * 4. On hit, merges raw query parameters byte-for-byte, applies correct Cache-Control,
 *    and schedules non-blocking analytics recording via waitUntil (rate-limited per IP/subnet).
 */
export async function handleRedirect(
  slug: string,
  request: Request,
  env: Env,
  ctx?: ExecutionContext
): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method Not Allowed", {
      status: 405,
      headers: {
        Allow: "GET, HEAD",
        "Content-Type": "text/plain; charset=utf-8",
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "no-referrer",
      },
    });
  }

  let link: LinkRedirectRow | null = null;
  try {
    link = await env.DB.prepare(
      "SELECT id, target_url, status_code, is_active, forward_query, expires_at FROM links WHERE slug = ?"
    )
      .bind(slug)
      .first<LinkRedirectRow>();
  } catch {
    return new Response("Service Unavailable", {
      status: 503,
      statusText: "Service Unavailable",
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "X-Content-Type-Options": "nosniff",
      },
    });
  }

  const now = new Date().toISOString();
  if (
    !link ||
    link.is_active !== 1 ||
    (link.expires_at !== null && link.expires_at <= now)
  ) {
    return respondUnknownLink(request, env);
  }

  const url = new URL(request.url);
  const destination = mergeQuery(link.target_url, url.search, Boolean(link.forward_query));
  const status = link.status_code;
  const cacheControl = status === 301 || status === 308 ? "private, max-age=3600" : "no-store";

  let response: Response;
  try {
    response = new Response(null, {
      status,
      headers: {
        Location: destination,
        "Cache-Control": cacheControl,
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    console.error(`Failed to construct redirect response for link ${link.id}`);
    return respondUnknownLink(request, env);
  }

  if (isCountableClick(request) && !isAnalyticsDisabled(env)) {
    const ipBucket = normalizeIpBucket(request.headers.get("cf-connecting-ip"));
    const analyticsTask = (async () => {
      if (env.CLICK_LIMITER) {
        try {
          const { success } = await env.CLICK_LIMITER.limit({ key: `click:${ipBucket}` });
          if (!success) return;
        } catch {
          // Fail open on limiter error
        }
      }
      await recordClick(env, link.id, request);
    })().catch(() => {});

    if (ctx && typeof ctx.waitUntil === "function") {
      ctx.waitUntil(analyticsTask);
    }
  }

  return response;
}

/**
 * Handles requests to root '/':
 * Uses shared respondUnknownLink helper.
 */
export async function handleRoot(request: Request, env: Env): Promise<Response> {
  return respondUnknownLink(request, env);
}
