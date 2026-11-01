import type { Env } from "../types.js";

export type AnalyticsDimension = "country" | "referrer";

export const BOT_UA_REGEX =
  /bot|crawl|spider|slurp|preview|facebookexternalhit|facebot|slackbot|whatsapp|telegrambot|discordbot|linkedinbot|embedly|skypeuripreview|mastodon|pleroma|akkoma|misskey|friendica|http\.rb|curl|wget|python-requests|python-urllib|go-http-client|okhttp|axios|node-fetch|undici|libwww-perl|headlesschrome|lighthouse|uptimerobot|pingdom|statuscake|meta-externalagent|google-inspectiontool|googleother|iframely/i;

export function parseEnabledDimensions(raw?: string): AnalyticsDimension[] {
  if (!raw) return [];
  const validDims: AnalyticsDimension[] = ["country", "referrer"];
  return raw
    .split(",")
    .map((d) => d.trim().toLowerCase())
    .filter((d): d is AnalyticsDimension => validDims.includes(d as AnalyticsDimension));
}

/**
 * Determines if a request should be counted as a real user click.
 * Filter out non-GET requests, prefetch/prerender requests, empty user agents, and known bots/crawlers.
 */
export function isCountableClick(request: Request): boolean {
  if (request.method !== "GET") {
    return false;
  }

  const secPurpose = request.headers.get("sec-purpose") ?? "";
  const purpose = request.headers.get("purpose") ?? "";
  if (/prefetch|prerender/i.test(secPurpose) || /prefetch|prerender/i.test(purpose)) {
    return false;
  }

  const ua = request.headers.get("user-agent")?.trim() ?? "";
  if (!ua) {
    return false;
  }

  if (BOT_UA_REGEX.test(ua)) {
    return false;
  }

  return true;
}

/**
 * Records a click asynchronously into D1:
 * 1. Increment total click_count and update last_clicked_at on links table.
 * 2. Upsert daily click rollup into link_daily_clicks table.
 * 3. Upsert optional dimension rollups into link_daily_dims table if enabled.
 *
 * Strict cost budget:
 * - Default: exactly 2 statements / 2 rows written.
 * - With country: 3 statements / 3 rows written.
 * - With country, referrer: 4 statements / 4 rows written.
 */
export async function recordClick(
  env: Env,
  linkId: string,
  request: Request,
  now = new Date()
): Promise<D1Response[]> {
  if (env.ANALYTICS_ENABLED === "false") {
    return [];
  }

  const day = now.toISOString().slice(0, 10);
  const isoTimestamp = now.toISOString();

  const statements: D1PreparedStatement[] = [
    env.DB.prepare(
      "UPDATE links SET click_count = click_count + 1, last_clicked_at = ? WHERE id = ?"
    ).bind(isoTimestamp, linkId),
    env.DB.prepare(
      "INSERT INTO link_daily_clicks (link_id, day, clicks) VALUES (?, ?, 1) ON CONFLICT (link_id, day) DO UPDATE SET clicks = clicks + 1"
    ).bind(linkId, day),
  ];

  const enabledDims = parseEnabledDimensions(env.ANALYTICS_DIMENSIONS);

  for (const dim of enabledDims) {
    if (dim === "country") {
      const cfCountry = (request as unknown as { cf?: { country?: string } }).cf?.country;
      const country =
        typeof cfCountry === "string" && cfCountry.length === 2
          ? cfCountry.toUpperCase()
          : "XX";
      statements.push(
        env.DB.prepare(
          "INSERT INTO link_daily_dims (link_id, day, dim, value, clicks) VALUES (?, ?, ?, ?, 1) ON CONFLICT (link_id, day, dim, value) DO UPDATE SET clicks = clicks + 1"
        ).bind(linkId, day, "country", country)
      );
    } else if (dim === "referrer") {
      let referrer = "(direct)";
      const refererHeader = request.headers.get("referer") || request.headers.get("referrer");
      if (refererHeader) {
        try {
          const parsed = new URL(refererHeader);
          if (parsed.hostname) {
            referrer = parsed.hostname.toLowerCase().slice(0, 64);
          }
        } catch {
          // ignore invalid URLs, keep "(direct)"
        }
      }
      statements.push(
        env.DB.prepare(
          "INSERT INTO link_daily_dims (link_id, day, dim, value, clicks) VALUES (?, ?, ?, ?, 1) ON CONFLICT (link_id, day, dim, value) DO UPDATE SET clicks = clicks + 1"
        ).bind(linkId, day, "referrer", referrer)
      );
    }
  }

  return await env.DB.batch(statements);
}
