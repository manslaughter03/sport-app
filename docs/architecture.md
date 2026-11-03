# Sport App — Architecture

A local-first, offline-capable web app to track exercise volume and weekly/monthly goals.
Target device: Samsung S24 (Chrome / "Add to Home screen"). No backend, no account, data
never leaves the phone.

Status: **design document**, no code yet.

Build plan for the first shippable version: [`v0-plan.md`](./v0-plan.md).

---

## 1. Decisions (settled)

| Topic | Decision |
|---|---|
| Hosting | Static bundle on **GitHub Pages**, no server logic. |
| Data location | **IndexedDB** in the phone's browser profile only. |
| Tracking model | *Volume per week or per month*, not "must train on specific days". |
| Goals | **Per-exercise volume target** + **one global "active days per week"** target. |
| Measurement kinds | `reps` (push-up, toe touch), `duration` (core/plank). Extensible. |
| Stack | Vite + TypeScript + Preact + Dexie + `vite-plugin-pwa`. |
| Tests | Vitest (unit + integration), Playwright (e2e smoke). No Playwright MCP. |

Rationale for volume-per-week rather than daily streaks: rest days are a feature, not a
failure. A day with zero push-ups is not a missed goal; a *week* under target is.

---

## 2. Domain model

### 2.1 Entities

```ts
type IsoDate = string;      // "2026-11-01" — local calendar day, never a UTC instant
type IsoInstant = string;   // "2026-11-01T18:42:03.123Z" — audit only

type ExerciseKind = "reps" | "duration";
type Period = "week" | "month";

interface Exercise {
  id: string;               // uuid
  name: string;             // "Push-up"
  kind: ExerciseKind;
  unit: string;             // "reps" | "s"    (step derives from kind/unit)
  step: number;             // quick-add increment: 5 | 10 | 30 (seconds)
  order: number;            // display order on Today
  archivedAt?: IsoInstant;  // soft delete — history must survive
}

interface Entry {
  id: string;
  exerciseId: string;
  day: IsoDate;             // LOCAL day, assigned at write time
  amount: number;           // reps, or seconds for duration
  createdAt: IsoInstant;
  note?: string;
}

type GoalScope =
  | { kind: "exercise"; exerciseId: string }
  | { kind: "activeDays" };   // global, not per-exercise

interface Goal {
  id: string;
  scope: GoalScope;
  period: Period;             // "week" | "month"
  target: number;             // reps/seconds per period, or active days per week
  cap: boolean;               // true = upper bound (over target = warning)
  effectiveFrom: IsoDate;     // in force from this day onward
  effectiveTo?: IsoDate;      // exclusive; undefined = still in force
  createdAt: IsoInstant;
}

interface Settings {
  weekStartsOn: 1 | 7;        // Monday (default) or Sunday
  dayCutoffHour: number;      // 0..6 — entries logged before this hour count for yesterday
  activeDayMinAmount: number; // a day counts as "active" if one exercise reaches this (default 1)
  schemaVersion: number;      // persisted; drives migration + export format
  lastExportAt?: IsoInstant;
  lastBackupNudgeAt?: IsoInstant;
}
```

### 2.2 Why these shapes

**`day` is stored, not derived.** Deriving the day from a UTC `createdAt` breaks every
evening session west of UTC. The write path computes `day` once, using `dayCutoffHour`:
a set logged at 00:30 with cutoff 3 → belongs to the previous day.

**One `Entry` per set, not per day.** Push-ups arrive as 20/15/12. Storing each set keeps
per-set history free (max set, fatigue, time of day) and makes daily/weekly totals pure
aggregation. Corrections are "add a row" or "delete one row" — never
read-modify-write a daily bucket.

**Goals are versioned rows, not a mutable field.** `effectiveFrom`/`effectiveTo` means
"I raised push-ups from 300 to 350 in March" does not retroactively rewrite January's
percentage. The progress engine selects the goal in force *at the end of the evaluated
period*. Editing a goal retroactively = split the row into two.

**`activeDays` is global, not per-exercise.** Your "N days per week" is about the habit
overall; per-exercise variants would let three goals disagree about what a good week is.

**`activeDayMinAmount` compares one exercise, not the day's sum.** The threshold exists so a
single stray 1-rep set does not count as training (O3); summing across exercises would let
three 1-rep sets on three exercises clear a threshold of 3 that no single session reached.
Settled in #16 and stated in the UI, not left implicit.

**The three settings have different retroactivity**, and the UI says which is which (#16):

| Setting | Reaches back? | Why |
|---|---|---|
| `weekStartsOn` | **Yes** — past weeks are re-bucketed | Week boundaries are computed at read time from the stored `day`, so every percentage moves. |
| `dayCutoffHour` | **No** — future writes only | `entry.day` is assigned once at write time (§2.2) and never recomputed. Rewriting it would move sets the user has already seen filed. |
| `activeDayMinAmount` | **Yes** — regularity is recomputed | It is a filter applied to stored entries when evaluating a period, not a stored property. |

---

## 3. Progress engine

Pure functions in `src/domain/`. Signature shape:

```ts
evaluate(range: PeriodRange, entries: Entry[], exercises: Exercise[],
         goals: Goal[], settings: Settings, today: IsoDate,
         period: Period = "week")
  : ProgressReport
```

`range` says *when*, `period` says *which goal row to select*. They are separate
because the same seven days can be read against a weekly target or as the first week of
a monthly one, and the two report different percentages: a 700/week and a 3000/month row
coexist for the same exercise (O2), so the selection cannot be inferred from the range
alone. `period` defaults to `"week"`, which is correct for every caller that passes a week
range.

### 3.1 Period ranges

- `week`: `weekStartsOn` (default Monday) → `[start, end)` of 7 local days.
- `month`: calendar month `[1st, 1st of next month)`, rendered as a calendar grid with
  weekday columns derived from `weekStartsOn`.
- Partial periods are normal: mid-week, `elapsedDays < periodDays`. Every surface prints
  the position — `day 3 of 7`, `day 4 of 31` — so a small percentage is never read as
  failure (O4).

### 3.2 Two percentages, two questions

| Metric | Formula | Question answered |
|---|---|---|
| **Volume %** (per exercise) | `Σ amount ÷ goal.target` | "Did I do the work this week?" |
| **Regularity %** (global) | `activeDays ÷ activeDaysTarget` | "Did I show up consistently?" |
| **Pace** (both) | `achieved ÷ (target × elapsedFraction)` | "Am I on track before the week ends?" |

Rendering rules that matter:

- Ring/bar width clamps to `0..100 %`.
- The **printed number is unclamped** — `140 %` is information, not an error.
- Pace is a state, not a number: `on-track` / `behind` / `ahead` / `done`.
  Linear expectation, no penalty for planned rest days.
- When `Goal.cap === true` the goal is a **ceiling**: above target renders as over-cap
  (warning tint), not as "achieved".
- The state is also **named in words** beside the percentage (`src/domain/pace.ts`):
  `on pace` / `ahead of pace` / `behind pace` / `done` / `over target` / `no goal`.
  "Behind pace" is quiet, not a warning — a slow start mid-period is the normal shape of a
  period that has not finished. The forecast states are withheld on the final day, where
  ahead and behind stop meaning anything; the outcome states (`done`, `over target`,
  `no goal`) survive, because they are verdicts rather than forecasts.

**The history list** (`previousRanges()` + `evaluatePeriods()`) is the same engine applied
to past ranges: one query, then a pure loop — never one query per row. Three rules:

- A period is evaluated against the goal that was in force *at that period's end*. This is
  the surface where a goal-versioning regression appears first, so it is asserted directly.
- A tracked period with no entries renders `0 %`; a blank would be a different (and false)
  claim.
- A period ending before the earliest stored `day` is marked "before tracking began", so
  `0 %` of nothing is not read as a missed week.

### 3.3 Streaks and history

- `periodStreak`: consecutive completed periods in which every active goal met target.
- History view = one `ProgressReport` per past period; cheap to recompute
  (a year of data is ~2k entries → sub-millisecond).

---

## 4. Layers

```
src/
  domain/          pure TS. no DB, no DOM, no clock, no fetch. 100 % unit-tested.
    types.ts       entities + branded ids
    period.ts      week/month range math, weekStartsOn, cutoff-hour day resolution
    progress.ts    evaluate(), volume %, regularity %, pace, streaks
    goals.ts       select goal-in-force for a period, split/retire logic
    format.ts      "1 250 reps", "2 m 30 s", percentage rounding
  data/
    db.ts          Dexie schema + versioned upgrades
    repos/         exercises, entries, goals, settings (thin, typed)
    backup.ts      export/import JSON, migration chain for imports
    migrations/    v1→v2→... (+ imported-file migrations)
  ui/
    screens/       Today, Progress, History, Exercises, Goals, Settings
    components/    ProgressRing, QuickAdd, PeriodSwitcher, DayGrid, GoalEditor
    state.ts       signals / liveQuery subscriptions
  sw.ts            service worker registration + update prompt
  main.tsx
```

**Rule:** `domain` may not import from `data` or `ui`, and no file in `domain/` may call
`new Date()` / `Date.now()` — time is always injected. Both enforced by ESLint
(`no-restricted-imports`, `no-restricted-globals`), not by discipline. That boundary is
what makes the tricky logic (day boundaries, week starts, goal versioning, streaks)
testable in milliseconds with plain fixtures.

Reactivity: Dexie `liveQuery` → log a set → ring and totals update with no manual
refresh, no state library.

---

## 5. Storage and migrations

### 5.1 Dexie schema (v1)

```ts
db.version(1).stores({
  exercises: "id, order, archivedAt",
  entries:   "id, exerciseId, day, [exerciseId+day], [day+exerciseId]",
  goals:     "id, effectiveFrom",
  settings:  "id",                    // single row, id = "app"
});
```

The compound indexes carry the two hot queries: "today's entries per exercise" and
"all entries in a period".

### 5.2 Schema upgrade (app update)

Dexie runs versioned upgrade functions on open, inside a transaction:

```ts
db.version(2).stores({ entries: "id, exerciseId, day, [exerciseId+day]" })
            .upgrade(tx => tx.table("entries").toCollection().modify(e => {
              e.day ??= localDayFrom(e.createdAt, DEFAULT_SETTINGS);
            }));
```

Rules:

1. **Forward-only.** No downgrade path; an older build refuses to open a newer DB
   (compare `db.verno` against `MIN_SUPPORTED`) instead of corrupting it.
2. **Every schema bump ships with an upgrade function *and* a fixture test** — build a
   v1 DB in `fake-indexeddb`, open it with v2 code, assert rows survive.
3. **No data loss in upgrades.** Renames are additive-then-copy; deletions are
   `archivedAt` soft-deletes.
4. **Offer an export before a major upgrade.** When the SW finds a build whose
   `schemaVersion > current`, show "New version — export a backup first?" (one tap,
   dismissible).

### 5.3 Data export / import

JSON; the envelope carries the version so imports can be migrated:

```json
{ "format": "sport-app-backup", "schemaVersion": 1, "exportedAt": "…",
  "data": { "exercises": [], "entries": [], "goals": [], "settings": {} } }
```

Import = validate envelope → run the import-migration chain to current version → **merge
by id** (idempotent re-import, never duplicates) → report counts. "Replace all" sits
behind a confirmation. Export is v0; import landed in Phase 2 (#15) — the asymmetry was
the risk, not the format. Plus `navigator.storage.persist()` on first launch (best effort
against eviction) and a nudge when `lastExportAt` is >~14 days old and there are ≥7 days
of entries.

**The import contract** (`src/data/import.ts`), in the order it is applied:

1. **Validate, then write.** `parseBackup` checks the envelope; `validateBackup` checks
   every row and every foreign key (`entry.exerciseId`, an exercise-scoped goal's
   `exerciseId`). A file naming a missing exercise is refused before a single row is
   touched — half-imported history is worse than a refusal.
2. **Merge by id.** Re-importing the same file is a no-op: identical rows count as
   `skipped`, never re-added.
3. **Conflicts: last writer wins, by `createdAt`.** Same id, different content → the row
   with the later `createdAt` survives, and the overwritten count is reported. An older
   file can therefore never roll data back. `Exercise` has no `createdAt`, so there is no
   defensible "later": the local row wins and the disagreement is reported as a skip
   rather than applied silently.
4. **Goals are never merged on content.** Two rows with different ids and the same
   scope+period both survive; `goalInForce` already tie-breaks, and collapsing them here
   would rewrite versioned history.
5. **One transaction.** Merge and replace-all run inside a single Dexie transaction over
   all four tables. Any failure leaves the database exactly as it was.
6. **`seq` is re-derived when it collides.** `seq` is per database; a merged row keeps its
   number only if the slot is free, otherwise it is renumbered in file order above the
   current maximum. Replace-all keeps the file's numbering, so a restore is byte-for-byte
   equal. Because merged rows can carry a high `seq` while being old, `lastForExercise`
   orders on `createdAt` and uses `seq` only as the same-millisecond tiebreak.

### 5.4 App update mechanics (PWA)

- Precache hashed assets; **never** serve a stale-first `index.html`.
- `registerType: "prompt"`: a new SW is detected → non-blocking toast
  "Update ready — Reload". No auto-`skipWaiting` while someone is mid-entry.
- Offline after first load: assets precached, data in IndexedDB → the phone needs the
  network exactly once per version.

---

## 6. Local network install (your question)

Yes — with one **gotcha**. Service workers and "Add to Home screen" need a **secure
context**. `localhost` is exempt; a LAN IP over plain HTTP (`http://192.168.1.x:5173`) is
**not**. Over HTTP on the LAN you get a working page but *no* service worker: no offline,
no install.

So serve HTTPS from the laptop:

```bash
npm run dev -- --host      # HTTP, LAN-visible: fine for quick data checks
npm run dev:lan            # vite --host + @vitejs/plugin-basic-ssl → https://192.168.1.x:5173
npm run preview:lan        # same, but serving the production build
```

Flow: run `dev:lan` → open the HTTPS URL on the S24 → accept the self-signed cert once →
SW installs and precaches → you may **stop the server**; the app keeps working from cache.

Caveat that matters: that cache and its IndexedDB belong to the **dev origin**, not to
your GitHub Pages origin. Data logged against `https://192.168.1.x` will not appear on
`https://<user>.github.io/sport-app/`. Use LAN serving to iterate on UI; do real logging
on the Pages URL (or export/import to move data across).

`file://` is out entirely: opaque origin, no service worker, storage wiped at will.

---

## 7. Testing strategy

Your question — Playwright MCP or integration tests — the answer is **both layers, but
not that tool**. MCP is an agent-facing browser driver: handy for me to poke at the app
while building, useless as a regression gate (no determinism, no CI report, no committed
truth). The committed `@playwright/test` runner is what fails the build.

| Layer | Tool | Covers | v0 count |
|---|---|---|---|
| Unit — domain | **Vitest** | period math, cutoff hour, Mon/Sun week starts, goal selection + versioning, volume %, regularity %, pace states, clamping, streak boundaries, month edges, leap year, DST | ~40 |
| Integration — data | **Vitest + `fake-indexeddb`** | repo CRUD, compound-index queries, Dexie v1→v2 upgrade fixture, export→import round-trip, idempotent merge, archived exercise keeps history | ~15 |
| Component | **Vitest + Testing Library (jsdom)** | QuickAdd emits the right entry, ring clamps at 100 while printing 140 %, goal editor validation | ~8 |
| E2E | **Playwright** (chromium) | seed exercise → log two sets → see volume % → reload → data persists; offline/PWA smoke | ~4 |

Ratio: the domain layer holds ~80 % of the risk and gets ~80 % of the tests. E2E is a
smoke test, not the safety net. Every unit test injects `today`/`now` — no wall clock.

---

## 8. CI/CD (GitHub Actions)

```
.github/workflows/
  ci.yml      PR: install → lint → typecheck → unit+integration → build
              → playwright (chromium, webServer: vite preview) → upload trace on failure
  deploy.yml  push to main: build → upload-pages-artifact → deploy-pages
              (permissions: pages: write, id-token: write)
```

Playwright on PRs only, chromium only, serial workers. Cache `~/.cache/ms-playwright`.
Pages serves a subpath (`/sport-app/`): set `base: "/sport-app/"` in Vite and keep the
manifest `start_url`/`scope` relative-aware, or the installed PWA breaks.

---

## 9. Roadmap

- **Phase 0** — scaffold: Vite/TS/Preact/Dexie, ESLint boundary rules, Vitest config,
  this document, CI workflow.
- **Phase 1 (v0, usable)** — domain layer + tests, Dexie v1, Today screen with QuickAdd,
  seeded Push-up / Core / Toe Touch, per-exercise weekly goal + active-days goal,
  Progress screen (regularity %, volume %, 7-day grid), JSON export.
- **Phase 2** — month periods, pace badges, history view, goal versioning UI, import +
  merge, day-cutoff & week-start settings, install prompt, update toast.
- **Phase 3** — calendar heatmap, streaks, exercise archiving UI, CSV export.
- **Phase 4 (optional)** — body metrics; multi-device only via file transfer.

---

## 10. Open questions

- **O1 — target vs cap. SETTLED:** `target` is **aspirational** (`140 %` = great week, printed
  unclamped). `Goal.cap` stays in the model for per-goal ceilings but no v0 goal uses it.
- **O2 — both periods at once? SETTLED:** both rows are allowed (300/week *and* 1200/month). v0
  ships the weekly surface; the monthly row is stored and evaluated, its screen is Phase 2.
- **O3 — active-day threshold.** Default "≥1 entry that day". Should a single 1-rep entry
  count, or is there a minimum volume?
- **O4 — partial-period display.** On the 2nd of the month, show "% of monthly target"
  (tiny number) or pace only? Proposal: pace until ≥50 % of the period has elapsed.
- **O5 — duration entry UX.** Presets (`:30 / :60 / :90`) vs stopwatch vs manual entry.
  Proposal: presets in v0, stopwatch in Phase 2.
