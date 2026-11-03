/**
 * Pace badges: naming the pace state (issue #13).
 *
 * `paceState()` already classifies progress as `on-track` / `behind` / `ahead` /
 * `done` / `over-cap` / `untargeted`. The ring colour used it; nothing said it in
 * words. This module is the words — and only the words, so the decision "should
 * this badge be shown at all?" is testable without rendering anything.
 *
 * Two rules drive the wording:
 *
 * 1. **"Behind pace" must not read as failure.** Rest days are a feature (§1),
 *    so the tone is quiet, never alarming, and the label names the *pace*, not
 *    the person.
 * 2. **A settled period has no pace.** On the last day of a period, ahead and
 *    behind stop meaning anything — there is no time left to act on them — so
 *    the badge is withdrawn rather than left to say something false.
 */

import type { PaceState } from "./types.ts";

/** How a badge should look. Deliberately not a CSS class: that is the UI's call. */
export type PaceTone = "good" | "quiet" | "warning" | "muted";

export interface PaceBadge {
  readonly state: PaceState;
  /** Shown to the user. Unambiguous without the percentage next to it. */
  readonly label: string;
  readonly tone: PaceTone;
}

const LABELS: Record<PaceState, string> = {
  "on-track": "on pace",
  ahead: "ahead of pace",
  // Not "falling behind" and not "off track": the goal is a volume target over
  // a period, so a slow start is information, not a verdict.
  behind: "behind pace",
  done: "done",
  "over-cap": "over target",
  untargeted: "no goal",
};

const TONES: Record<PaceState, PaceTone> = {
  "on-track": "good",
  ahead: "good",
  // Quiet, not warning: being behind mid-period is the normal shape of a week
  // that has not happened yet.
  behind: "quiet",
  done: "good",
  "over-cap": "warning",
  untargeted: "muted",
};

export interface PaceBadgeOptions {
  /** Days elapsed so far, inclusive of today. */
  readonly elapsedDays: number;
  /** Days in the whole period. */
  readonly totalDays: number;
}

/**
 * The badge for a pace state, or `undefined` when there is nothing honest to say.
 *
 * Withheld in three cases:
 * - a target-less exercise has no pace at all (the `untargeted` label is still
 *   worth showing, so it is kept — a blank cell reads like a bug);
 * - a finished period: `ahead`/`behind`/`on pace` describe a race that is over;
 * - a period of zero days, which should not exist but must not divide by it.
 */
export function paceBadge(state: PaceState, options: PaceBadgeOptions): PaceBadge | undefined {
  const { elapsedDays, totalDays } = options;
  if (!Number.isFinite(totalDays) || totalDays <= 0) return undefined;

  const finished = elapsedDays >= totalDays;
  // The verdict states survive the final day: "done" and "over target" are
  // outcomes, not forecasts. So does "no goal", which is not about time.
  const isVerdict = state === "done" || state === "over-cap" || state === "untargeted";
  if (finished && !isVerdict) return undefined;

  return { state, label: LABELS[state], tone: TONES[state] };
}

/** Everything a badge can say, for a legend or a test table. */
export function paceLabel(state: PaceState): string {
  return LABELS[state];
}
