import type { LinkStats } from "@redirect/shared";

export async function getLinkStats(
  db: D1Database,
  linkId: string,
  totalClicks: number,
  lastClickedAt: string | null,
  days: number,
  enabledDimensions: string[] = []
): Promise<LinkStats> {
  const toDate = new Date();
  const fromDate = new Date(toDate.getTime() - (days - 1) * 24 * 60 * 60 * 1000);

  const toStr = toDate.toISOString().slice(0, 10);
  const fromStr = fromDate.toISOString().slice(0, 10);

  // Daily clicks query
  const dailySql = `
    SELECT day, clicks
    FROM link_daily_clicks
    WHERE link_id = ? AND day >= ? AND day <= ?
    ORDER BY day ASC
  `;
  const { results: dailyResults } = await db
    .prepare(dailySql)
    .bind(linkId, fromStr, toStr)
    .all<{ day: string; clicks: number }>();

  const daily = dailyResults.map((r) => ({
    day: r.day,
    clicks: Number(r.clicks),
  }));

  const dimensions: Record<string, Array<{ value: string; clicks: number }>> = {};

  for (const dim of enabledDimensions) {
    if (dim === "country" || dim === "referrer") {
      const dimSql = `
        SELECT value, SUM(clicks) as clicks
        FROM link_daily_dims
        WHERE link_id = ? AND dim = ? AND day >= ? AND day <= ?
        GROUP BY value
        ORDER BY clicks DESC
        LIMIT 10
      `;
      const { results: dimResults } = await db
        .prepare(dimSql)
        .bind(linkId, dim, fromStr, toStr)
        .all<{ value: string; clicks: number }>();

      dimensions[dim] = dimResults.map((r) => ({
        value: r.value,
        clicks: Number(r.clicks),
      }));
    }
  }

  return {
    linkId,
    totalClicks,
    lastClickedAt,
    range: {
      days,
      from: fromStr,
      to: toStr,
    },
    daily,
    dimensions,
  };
}
