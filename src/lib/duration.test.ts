import { describe, expect, it } from "vitest";
import { parseDurationMs } from "./duration.js";

describe("parseDurationMs", () => {
  it("uses the fallback when unset", () => {
    expect(parseDurationMs(undefined, 10 * 60 * 1000)).toBe(10 * 60 * 1000);
  });

  it("parses units", () => {
    expect(parseDurationMs("250ms", 0)).toBe(250);
    expect(parseDurationMs("30s", 0)).toBe(30_000);
    expect(parseDurationMs("5m", 0)).toBe(5 * 60 * 1000);
    expect(parseDurationMs("1h", 0)).toBe(60 * 60 * 1000);
    expect(parseDurationMs("2d", 0)).toBe(2 * 24 * 60 * 60 * 1000);
  });

  it("treats a bare number as minutes", () => {
    expect(parseDurationMs("3", 0)).toBe(3 * 60 * 1000);
  });

  it("throws on invalid values", () => {
    expect(() => parseDurationMs("soon", 0)).toThrow(/Invalid duration/);
  });
});
