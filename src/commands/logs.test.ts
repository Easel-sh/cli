import { describe, expect, it } from "vitest";
import { parseTimeBound } from "../commands/logs.js";

describe("parseTimeBound", () => {
  const now = new Date("2026-07-10T15:00:00.000Z");

  it("parses relative durations as time ago", () => {
    expect(parseTimeBound("1h", now)).toBe("2026-07-10T14:00:00.000Z");
    expect(parseTimeBound("30m", now)).toBe("2026-07-10T14:30:00.000Z");
  });

  it("treats a bare number as minutes ago, not a date", () => {
    expect(parseTimeBound("90", now)).toBe("2026-07-10T13:30:00.000Z");
    expect(parseTimeBound("2001", now)).toBe(new Date(now.getTime() - 2001 * 60_000).toISOString());
  });

  it("parses ISO timestamps", () => {
    expect(parseTimeBound("2026-07-10T12:00:00.000Z", now)).toBe(
      "2026-07-10T12:00:00.000Z",
    );
  });

  it("returns undefined for empty values", () => {
    expect(parseTimeBound(undefined, now)).toBeUndefined();
    expect(parseTimeBound("  ", now)).toBeUndefined();
  });

  it("throws on invalid values", () => {
    expect(() => parseTimeBound("not-a-time", now)).toThrow(/Invalid time/);
  });
});
