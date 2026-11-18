import { describe, expect, it } from "vitest";
import { parseDuration, parseTime } from "../src/config.js";

describe("time parsing", () => {
  it("handles relative, unix and ISO times", () => {
    expect(parseTime("+2h", 1000n)).toBe(1000n + 7200n);
    expect(parseTime("+30m", 0n)).toBe(1800n);
    expect(parseTime("1800000000", 0n)).toBe(1_800_000_000n);
    expect(parseTime("2026-12-31T00:00:00Z", 0n)).toBe(1798675200n);
  });

  it("parses durations", () => {
    expect(parseDuration("1h")).toBe(3600n);
    expect(parseDuration("7d")).toBe(604_800n);
  });

  it("rejects garbage", () => {
    expect(() => parseTime("next tuesday-ish", 0n)).toThrow();
  });
});
