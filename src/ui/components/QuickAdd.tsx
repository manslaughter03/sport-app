/**
 * Quick-add row for one exercise (docs/architecture.md §3.2 / S6).
 *
 * Reps exercises get `+step / +2×step`; duration exercises get seconds presets
 * (`:30 / :60 / :90`). Every tap writes exactly one entry — no batching, so a
 * correction is a single delete.
 */

import type { Exercise } from "../../domain/types.ts";
import { formatAmountCompact } from "../../domain/format.ts";

export interface QuickAddProps {
  exercise: Exercise;
  todayTotal: number;
  canUndo: boolean;
  onAdd(amount: number): void;
  onUndo(): void;
}

/** Presets per kind. Duration is fixed at 30 s steps; reps follow `step`. */
export function presetsFor(exercise: Exercise): number[] {
  if (exercise.kind === "duration") {
    return [30, 60, 90];
  }
  const step = exercise.step > 0 ? exercise.step : 5;
  return [step, step * 2];
}

function presetLabel(amount: number, exercise: Exercise): string {
  return exercise.kind === "duration" ? `:${amount}` : `+${amount}`;
}

function ariaLabel(amount: number, exercise: Exercise): string {
  return exercise.kind === "duration"
    ? `Add ${amount} seconds to ${exercise.name}`
    : `Add ${amount} reps to ${exercise.name}`;
}

export function QuickAdd({ exercise, todayTotal, canUndo, onAdd, onUndo }: QuickAddProps) {
  const presets = presetsFor(exercise);

  return (
    <li class="exercise" data-testid={`exercise-${exercise.id}`}>
      <div class="exercise__head">
        <span class="exercise__name">{exercise.name}</span>
        <span class="exercise__total">{formatAmountCompact(todayTotal, exercise.kind)}</span>
      </div>

      <div class="exercise__actions">
        {presets.map((amount) => (
          <button
            key={amount}
            type="button"
            class="btn btn--add"
            aria-label={ariaLabel(amount, exercise)}
            onClick={() => onAdd(amount)}
          >
            {presetLabel(amount, exercise)}
          </button>
        ))}

        <button
          type="button"
          class="btn btn--undo"
          aria-label={`Undo last set for ${exercise.name}`}
          disabled={!canUndo}
          onClick={onUndo}
        >
          Undo
        </button>
      </div>
    </li>
  );
}
