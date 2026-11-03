import { describe, expect, it } from "vitest";
import { presetsFor } from "./QuickAdd.tsx";
import type { Exercise } from "../../domain/types.ts";

/**
 * Presets are derived from `Exercise.step` so one control on the Targets screen
 * serves every exercise. The rule that matters: the buttons must always be
 * distinct and ascending, because two buttons adding the same amount is a bug
 * the user cannot see.
 *
 * Pure logic, so this runs in the `node` environment — no jsdom needed.
 */

function exercise(over: Partial<Exercise>): Exercise {
  return {
    id: "ex-1",
    name: "Toe Touch",
    kind: "reps",
    unit: "reps",
    step: 5,
    order: 1,
    ...over,
  };
}

describe("presetsFor — reps", () => {
  it("offers step and 2x step for a small step", () => {
    expect(presetsFor(exercise({ step: 5 }))).toEqual([5, 10]);
    expect(presetsFor(exercise({ step: 10 }))).toEqual([10, 20]);
  });

  it("offers the high-volume pair for a 50 step", () => {
    expect(presetsFor(exercise({ step: 50 }))).toEqual([50, 100]);
  });

  it("offers 100 and 200 for a 100 step", () => {
    expect(presetsFor(exercise({ step: 100 }))).toEqual([100, 200]);
  });

  it("never returns duplicate buttons for step 1", () => {
    const presets = presetsFor(exercise({ step: 1 }));
    expect(new Set(presets).size).toBe(presets.length);
    expect(presets).toEqual([1, 2]);
  });

  it("always returns ascending amounts", () => {
    for (const step of [1, 2, 5, 10, 25, 50, 100, 250]) {
      const presets = presetsFor(exercise({ step }));
      expect(presets.length).toBeGreaterThanOrEqual(2);
      for (let i = 1; i < presets.length; i += 1) {
        expect(presets[i]!).toBeGreaterThan(presets[i - 1]!);
      }
    }
  });

  it("falls back to a usable step when stored data is corrupt", () => {
    // A 0-step exercise would render a "+0" button that writes nothing.
    for (const broken of [0, -5, Number.NaN]) {
      const presets = presetsFor(exercise({ step: broken }));
      expect(presets.every((p) => p > 0 && Number.isFinite(p))).toBe(true);
    }
  });
});

describe("presetsFor — duration", () => {
  it("keeps the fixed second presets regardless of step", () => {
    expect(presetsFor(exercise({ kind: "duration", unit: "s", step: 30 }))).toEqual([30, 60, 90]);
    expect(presetsFor(exercise({ kind: "duration", unit: "s", step: 5 }))).toEqual([30, 60, 90]);
  });
});
