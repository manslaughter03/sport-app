/**
 * Period switcher.
 *
 * v0 ships the weekly surface only (plan §0, O2): the month button is present
 * so the affordance is discoverable, but disabled until Phase 2.
 */

export interface PeriodSwitcherProps {
  period: "week" | "month";
  onChange(period: "week" | "month"): void;
  monthEnabled?: boolean;
}

export function PeriodSwitcher({ period, onChange, monthEnabled = false }: PeriodSwitcherProps) {
  return (
    <div class="period-switcher" data-testid="period-switcher" role="group" aria-label="Period">
      <button
        type="button"
        class="chip"
        aria-pressed={period === "week"}
        onClick={() => onChange("week")}
      >
        Week
      </button>
      <button
        type="button"
        class="chip"
        aria-pressed={period === "month"}
        disabled={!monthEnabled}
        title={monthEnabled ? undefined : "Monthly view arrives in a later version"}
        onClick={() => onChange("month")}
      >
        Month
      </button>
    </div>
  );
}
