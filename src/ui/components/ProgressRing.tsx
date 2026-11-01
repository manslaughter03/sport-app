/**
 * Weekly progress ring for one exercise.
 *
 * Rendering rule (docs/architecture.md §3.2): the arc width clamps to 100 %,
 * but the printed number does not — 140 % is information, not an error.
 * `data-width` carries the clamped value so the rule is testable without
 * measuring the DOM.
 */

import { formatPercentRounded } from "../../domain/format.ts";
import type { PaceState } from "../../domain/types.ts";

const SIZE = 96;
const STROKE = 10;
const RADIUS = (SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export interface ProgressRingProps {
  exerciseId: string;
  /** Unclamped percentage, or null when the exercise has no goal. */
  volumePct: number | null;
  pace: PaceState;
  label: string;
}

export function ProgressRing({ exerciseId, volumePct, pace, label }: ProgressRingProps) {
  const clamped = volumePct === null ? 0 : Math.min(100, Math.max(0, volumePct));
  const dash = (clamped / 100) * CIRCUMFERENCE;

  return (
    <div class="ring" data-testid={`ring-${exerciseId}`} data-pace={pace}>
      <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} role="img" aria-label={label}>
        <circle
          class="ring__track"
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={RADIUS}
          fill="none"
          stroke-width={STROKE}
        />
        <circle
          class="ring__fill"
          data-testid={`ringbar-${exerciseId}`}
          data-width={String(clamped)}
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={RADIUS}
          fill="none"
          stroke-width={STROKE}
          stroke-dasharray={`${dash} ${CIRCUMFERENCE - dash}`}
          stroke-linecap="round"
          transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
        />
      </svg>
      <span class="ring__value">{formatPercentRounded(volumePct ?? Number.NaN)}</span>
    </div>
  );
}
