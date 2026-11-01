import { describe, it, expect } from "vitest";
import {
  zeroFillDailySeries,
  formatUtcDay,
  formatCountryName,
} from "../src/utils/stats";

describe("stats utilities", () => {
  describe("zeroFillDailySeries", () => {
    it("returns array of exact requested date range inclusive", () => {
      const records = [{ day: "2026-10-25", clicks: 5 }];
      const result = zeroFillDailySeries(records, "2026-10-20", "2026-10-26");
      expect(result).toHaveLength(7);
      expect(result[0]?.day).toBe("2026-10-20");
      expect(result[0]?.clicks).toBe(0);
      expect(result[5]?.day).toBe("2026-10-25");
      expect(result[5]?.clicks).toBe(5);
      expect(result[6]?.day).toBe("2026-10-26");
      expect(result[6]?.clicks).toBe(0);
    });

    it("handles month and year boundaries correctly", () => {
      const records = [
        { day: "2025-12-31", clicks: 10 },
        { day: "2026-01-01", clicks: 20 },
      ];
      const result = zeroFillDailySeries(records, "2025-12-30", "2026-01-02");
      expect(result).toHaveLength(4);
      expect(result.map((r) => r.day)).toEqual([
        "2025-12-30",
        "2025-12-31",
        "2026-01-01",
        "2026-01-02",
      ]);
      expect(result.map((r) => r.clicks)).toEqual([0, 10, 20, 0]);
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

    it("returns Unknown for XX without flag (B15)", () => {
      expect(formatCountryName("XX")).toBe("Unknown");
      expect(formatCountryName("xx")).toBe("Unknown");
    });

    it("returns fallback for unknown or empty codes", () => {
      expect(formatCountryName("")).toBe("Unknown");
      expect(formatCountryName("XYZ")).toBe("XYZ");
    });
  });
});
