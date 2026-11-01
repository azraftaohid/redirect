/**
 * Statistics and analytics utilities for time-series charts and dimension breakdowns.
 */

export interface DailyClickPoint {
  day: string; // "YYYY-MM-DD"
  clicks: number;
}

/**
 * Ensures a continuous daily time-series by zero-filling missing UTC days
 * from `from` to `to` inclusive.
 */
export function zeroFillDailySeries(
  records: Array<{ day: string; clicks: number }>,
  from: string,
  to: string
): DailyClickPoint[] {
  const recordMap = new Map<string, number>();
  for (const r of records) {
    recordMap.set(r.day, r.clicks);
  }

  const result: DailyClickPoint[] = [];
  const fromParts = from.split("-").map(Number);
  const toParts = to.split("-").map(Number);
  if (fromParts.length !== 3 || toParts.length !== 3) {
    return records.map((r) => ({ day: r.day, clicks: r.clicks }));
  }

  const current = new Date(Date.UTC(fromParts[0]!, fromParts[1]! - 1, fromParts[2]!));
  const end = new Date(Date.UTC(toParts[0]!, toParts[1]! - 1, toParts[2]!));
  const pad = (n: number) => String(n).padStart(2, "0");

  while (current.getTime() <= end.getTime()) {
    const dayKey = `${current.getUTCFullYear()}-${pad(current.getUTCMonth() + 1)}-${pad(current.getUTCDate())}`;
    result.push({
      day: dayKey,
      clicks: recordMap.get(dayKey) ?? 0,
    });
    current.setUTCDate(current.getUTCDate() + 1);
  }

  return result;
}

/**
 * Formats a "YYYY-MM-DD" UTC string into a short readable label, e.g. "Oct 25".
 */
export function formatUtcDay(dayString: string): string {
  const parts = dayString.split("-").map(Number);
  if (parts.length !== 3 || parts.some(isNaN)) return dayString;

  const y = parts[0];
  const m = parts[1];
  const d = parts[2];
  if (y === undefined || m === undefined || d === undefined) return dayString;

  const date = new Date(Date.UTC(y, m - 1, d));

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(date);
}

/**
 * Converts a 2-letter ISO country code into a flag emoji and localized country name.
 * e.g. "US" -> "🇺🇸 United States"
 * "XX" returns "Unknown" without flag.
 */
export function formatCountryName(isoCode: string): string {
  if (!isoCode || isoCode.length !== 2) {
    return isoCode || "Unknown";
  }

  const upper = isoCode.toUpperCase();
  if (upper === "XX") {
    return "Unknown";
  }

  let flag = "";
  try {
    flag = String.fromCodePoint(
      ...[...upper].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65)
    );
  } catch {
    flag = "";
  }

  let countryName = upper;
  try {
    if (typeof Intl !== "undefined" && Intl.DisplayNames) {
      const displayNames = new Intl.DisplayNames(["en"], { type: "region" });
      const name = displayNames.of(upper);
      if (name) countryName = name;
    }
  } catch {
    countryName = upper;
  }

  return flag ? `${flag} ${countryName}` : countryName;
}
