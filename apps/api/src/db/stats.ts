import type { DimRow, LinkStats } from "@redirect/shared";
import type { AnalyticsDimension } from "../utils/analytics.js";
import { mapRowToLinkRecord } from "./links.js";

export async function getLinkStats(
  db: D1Database,
  id: string,
  days: number,
  enabledDimensions: AnalyticsDimension[] = []
): Promise<LinkStats | null> {
  const toDate = new Date();
  const fromDate = new Date(toDate.getTime() - (days - 1) * 24 * 60 * 60 * 1000);

  const toStr = toDate.toISOString().slice(0, 10);
  const fromStr = fromDate.toISOString().slice(0, 10);

  const linkStmt = db.prepare("SELECT * FROM links WHERE id = ? LIMIT 1").bind(id);

  const dailySql = `
    SELECT day, clicks
    FROM link_daily_clicks
    WHERE link_id = ? AND day >= ? AND day <= ?
    ORDER BY day ASC
  `;
  const dailyStmt = db.prepare(dailySql).bind(id, fromStr, toStr);

  const statements: D1PreparedStatement[] = [linkStmt, dailyStmt];
  const dimNames: AnalyticsDimension[] = [];

  for (const dim of enabledDimensions) {
    if (dim === "country" || dim === "referrer") {
      dimNames.push(dim);
      const dimSql = `
        SELECT value, SUM(clicks) as clicks
        FROM link_daily_dims
        WHERE link_id = ? AND dim = ? AND day >= ? AND day <= ?
        GROUP BY value
        ORDER BY clicks DESC
        LIMIT 10
      `;
      statements.push(db.prepare(dimSql).bind(id, dim, fromStr, toStr));
    }
  }

  const results = await db.batch(statements);
  const linkRow = results[0]?.results?.[0] as Record<string, unknown> | undefined;
  if (!linkRow) {
    return null;
  }
  const link = mapRowToLinkRecord(linkRow);

  const dailyRows = (results[1]?.results ?? []) as Array<{ day: string; clicks: number }>;
  const daily = dailyRows.map((r) => ({
    day: r.day,
    clicks: Number(r.clicks),
  }));

  const dimensions: { country?: DimRow[]; referrer?: DimRow[] } = {};
  for (let i = 0; i < dimNames.length; i++) {
    const dim = dimNames[i]!;
    const dimRows = (results[2 + i]?.results ?? []) as Array<{ value: string; clicks: number }>;
    dimensions[dim] = dimRows.map((r) => ({
      value: r.value,
      clicks: Number(r.clicks),
    }));
  }

  return {
    link,
    range: {
      days,
      from: fromStr,
      to: toStr,
    },
    daily,
    dimensions,
  };
}
