import { describe, expect, it } from "vitest";
import {
  clampPct,
  formatAmount,
  formatAmountCompact,
  formatDuration,
  formatPercent,
  formatPercentRounded,
  formatReps,
} from "./format.ts";

// Proves the runner is wired for pure domain code in a `node` environment:
// no jsdom, no DOM, no clock. The real domain suite starts in S2 (period.ts).
describe("format", () => {
  it("clamps a percentage into 0..100 for rendering", () => {
    expect(clampPct(140)).toBe(100);
    expect(clampPct(-10)).toBe(0);
    expect(clampPct(42.5)).toBe(42.5);
  });

  it("prints the number unclamped, so 140 % stays visible", () => {
    expect(formatPercent(140)).toBe("140 %");
    expect(formatPercent(140)).not.toBe(formatPercent(100));
  });

  it("never prints NaN", () => {
    expect(clampPct(Number.NaN)).toBe(0);
    expect(formatPercent(Number.NaN)).toBe("—");
    expect(formatPercent(Number.POSITIVE_INFINITY)).toBe("—");
  });
});

describe("formatAmount", () => {
  it("groups thousands with a thin space", () => {
    expect(formatReps(1250)).toBe("1 250 reps");
    expect(formatReps(1)).toBe("1 rep");
    expect(formatReps(0)).toBe("0 reps");
    expect(formatReps(999)).toBe("999 reps");
    expect(formatReps(1_000_000)).toBe("1 000 000 reps");
  });

  it("formats durations", () => {
    expect(formatDuration(45)).toBe("45 s");
    expect(formatDuration(60)).toBe("1 m");
    expect(formatDuration(90)).toBe("1 m 30 s");
    expect(formatDuration(3000)).toBe("50 m");
    expect(formatDuration(0)).toBe("0 s");
  });

  it("picks the format from the exercise kind", () => {
    expect(formatAmount(1250, "reps")).toBe("1 250 reps");
    expect(formatAmount(150, "duration")).toBe("2 m 30 s");
  });

  it("formats compactly", () => {
    expect(formatAmountCompact(1250, "reps")).toBe("1 250");
    expect(formatAmountCompact(150, "duration")).toBe("2:30");
    expect(formatAmountCompact(45, "duration")).toBe("0:45");
  });
});

describe("formatPercentRounded", () => {
  it("never hides a missed target", () => {
    expect(formatPercentRounded(99.99)).toBe("100 %");
    expect(formatPercentRounded(99.94)).toBe("99.9 %");
    expect(formatPercentRounded(100.01)).toBe("100 %");
    expect(formatPercentRounded(100.06)).toBe("100.1 %");
  });

  it("prints a dash for non-finite values", () => {
    expect(formatPercentRounded(Number.NaN)).toBe("—");
  });
});
