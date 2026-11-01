import { describe, expect, it } from "vitest";
import { clampPct, formatPercent } from "./format.ts";

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
