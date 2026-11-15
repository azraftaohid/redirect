import type { Env } from "../types.js";

export type AnalyticsDimension = "country" | "referrer";

export const BOT_UA_REGEX =
  /bot|crawl|spider|slurp|preview|facebookexternalhit|facebot|slackbot|whatsapp|telegrambot|discordbot|linkedinbot|embedly|skypeuripreview|mastodon|pleroma|akkoma|misskey|friendica|http\.rb|curl|wget|python-requests|python-urllib|go-http-client|okhttp|axios|node-fetch|undici|libwww-perl|headlesschrome|lighthouse|uptimerobot|pingdom|statuscake|meta-externalagent|google-inspectiontool|googleother|iframely/i;

export function parseEnabledDimensions(raw?: string): AnalyticsDimension[] {
  if (!raw) return [];
  const validDims: AnalyticsDimension[] = ["country", "referrer"];
  const unique = Array.from(new Set(raw.split(",").map((d) => d.trim().toLowerCase())));
  return unique.filter((d): d is AnalyticsDimension => validDims.includes(d as AnalyticsDimension));
}

export function normalizeReferrer(refererHeader?: string | null): string {
  if (!refererHeader) return "(direct)";
  try {
    const parsed = new URL(refererHeader);
    if (!parsed.hostname || !/^[a-z0-9.-]+$/i.test(parsed.hostname)) {
      return "(direct)";
    }
    let host = parsed.hostname.toLowerCase().replace(/\.+$/, "");
    // If IPv4 or simple localhost, return as-is
    if (/^(\d{1,3}\.){3}\d{1,3}$/.test(host) || host === "localhost") {
      return host.slice(0, 64);
    }
    // Collapse arbitrary subdomains to base registrable domain (e.g. uuid.twitter.com -> twitter.com)
    const parts = host.split(".");
    if (parts.length > 2) {
      const twoPartTlds = ["co.uk", "com.au", "co.jp", "org.uk", "gov.uk", "edu.au", "ac.uk", "net.au"];
      const lastTwo = parts.slice(-2).join(".");
      if (twoPartTlds.includes(lastTwo) && parts.length > 3) {
        host = parts.slice(-3).join(".");
      } else if (!twoPartTlds.includes(lastTwo)) {
        host = parts.slice(-2).join(".");
      }
    }
    return host.slice(0, 64);
  } catch {
    return "(direct)";
  }
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
export function isAnalyticsDisabled(env: Env): boolean {
  const raw = env.ANALYTICS_ENABLED?.trim().toLowerCase();
  return raw === "false" || raw === "0" || raw === "off" || raw === "no";
}

function expandIpv4SuffixToHextets(part: string): string[] | null {
  const octets = part.split(".");
  if (octets.length !== 4) return null;
  const nums = octets.map((o) => (/^\d{1,3}$/.test(o) ? Number(o) : -1));
  if (nums.some((n) => n < 0 || n > 255)) return null;
  const hi = ((nums[0]! << 8) | nums[1]!).toString(16);
  const lo = ((nums[2]! << 8) | nums[3]!).toString(16);
  return [hi, lo];
}

/**
 * Normalizes an IP address for rate-limit bucketing:
 * - Empty/missing -> "local"
 * - IPv4 -> lowercased IPv4 string
 * - IPv6 -> normalized /64 prefix (e.g. "2001:db8:0:1::/64") so single-user /64 subnets share a bucket
 */
export function normalizeIpBucket(rawIp?: string | null): string {
  const trimmed = rawIp?.trim() ?? "";
  if (!trimmed) return "local";

  if (!trimmed.includes(":")) {
    return trimmed.toLowerCase();
  }

  const zoneIdx = trimmed.indexOf("%");
  const withoutZone = zoneIdx >= 0 ? trimmed.slice(0, zoneIdx) : trimmed;

  const halves = withoutZone.split("::");
  if (halves.length > 2) {
    return withoutZone.toLowerCase();
  }

  const parseGroups = (seg: string, allowIpv4Tail: boolean): string[] | null => {
    if (!seg) return [];
    const parts = seg.split(":");
    const out: string[] = [];
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i] ?? "";
      if (part.includes(".")) {
        if (!allowIpv4Tail || i !== parts.length - 1) return null;
        const expanded = expandIpv4SuffixToHextets(part);
        if (!expanded) return null;
        out.push(...expanded);
      } else {
        if (!/^[0-9a-fA-F]{1,4}$/.test(part)) return null;
        out.push(parseInt(part, 16).toString(16));
      }
    }
    return out;
  };

  let groups: string[];
  if (halves.length === 2) {
    const left = parseGroups(halves[0] ?? "", false);
    const right = parseGroups(halves[1] ?? "", true);
    if (!left || !right || left.length + right.length > 8) {
      return withoutZone.toLowerCase();
    }
    const padCount = 8 - (left.length + right.length);
    groups = [...left, ...Array<string>(padCount).fill("0"), ...right];
  } else {
    const parsed = parseGroups(withoutZone, true);
    if (!parsed || parsed.length !== 8) {
      return withoutZone.toLowerCase();
    }
    groups = parsed;
  }

  return `${groups[0]}:${groups[1]}:${groups[2]}:${groups[3]}::/64`;
}

export async function recordClick(
  env: Env,
  linkId: string,
  request: Request,
  now = new Date()
): Promise<D1Response[]> {
  if (isAnalyticsDisabled(env)) {
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
      const refererHeader = request.headers.get("referer") || request.headers.get("referrer");
      const referrer = normalizeReferrer(refererHeader);
      statements.push(
        env.DB.prepare(
          "INSERT INTO link_daily_dims (link_id, day, dim, value, clicks) VALUES (?, ?, ?, ?, 1) ON CONFLICT (link_id, day, dim, value) DO UPDATE SET clicks = clicks + 1"
        ).bind(linkId, day, "referrer", referrer)
      );
    }
  }

  return await env.DB.batch(statements);
}
