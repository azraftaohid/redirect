import { describe, it, expect } from "vitest";
import {
  zeroFillDailySeries,
  formatUtcDay,
  formatCountryName,
} from "../src/utils/stats";

describe("stats utilities", () => {
  describe("zeroFillDailySeries", () => {
    it("returns array of exact requested length", () => {
      const records = [{ day: "2026-10-25", clicks: 5 }];
      const result = zeroFillDailySeries(7, records);
      expect(result).toHaveLength(7);
    });

    it("preserves click counts for matching UTC days and zero-fills others", () => {
      const now = new Date();
      const pad = (n: number) => String(n).padStart(2, "0");
      const today = `${now.getUTCFullYear()}-${pad(now.getUTCMonth() + 1)}-${pad(
        now.getUTCDate()
      )}`;

      const records = [{ day: today, clicks: 42 }];
      const result = zeroFillDailySeries(3, records);

      expect(result).toHaveLength(3);
      // Last element should be today with 42 clicks
      expect(result[2]?.day).toBe(today);
      expect(result[2]?.clicks).toBe(42);
      // Earlier days should be 0 clicks
      expect(result[0]?.clicks).toBe(0);
      expect(result[1]?.clicks).toBe(0);
    });
  });

  describe("formatUtcDay", () => {
    it("formats YYYY-MM-DD into human-readable label", () => {
      const formatted = formatUtcDay("2026-10-25");
      expect(formatted).toBe("Oct 25");
    });

    it("returns raw input if malformed", () => {
      expect(formatUtcDay("invalid")).toBe("invalid");
    });
  });

  describe("formatCountryName", () => {
    it("formats US with flag and name", () => {
      const name = formatCountryName("US");
      expect(name).toContain("United States");
      expect(name).toContain("🇺🇸");
    });

    it("formats GB with flag and name", () => {
      const name = formatCountryName("GB");
      expect(name).toContain("United Kingdom");
      expect(name).toContain("🇬🇧");
    });

    it("returns fallback for unknown or empty codes", () => {
      expect(formatCountryName("")).toBe("Unknown");
      expect(formatCountryName("XYZ")).toBe("XYZ");
    });
  });
});
