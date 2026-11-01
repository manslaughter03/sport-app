# Sport App — v0 Plan

Execution plan for **v0: the first version you can actually log workouts in on your phone.**

Companion to [`architecture.md`](./architecture.md). The architecture answers *what the system
is*; this document answers *what to build, in which order, and how we know it is done.*

Status: **planning**. No code yet.

---

## 0. Decisions locked by this round

| # | Question | Decision |
|---|---|---|
| O1 | Is a per-exercise `target` aspirational or a ceiling? | **Aspirational.** `140 %` is a great week, printed unclamped. `Goal.cap = true` remains available per goal for ceilings (renders as over-cap warning), but **no v0 goal uses it**. |
| O2 | Both periods at once? | **Yes — both rows allowed.** A push-up goal can be `300/week` *and* `1200/month`. v0 ships the **weekly** surface only; the monthly row is stored and evaluated but its screen arrives in Phase 2. |

These two were the only open questions that could have changed the data model. They did not:
`Goal.cap` and multi-row goals were already in the schema, so v0 needs **no schema change** from
§2.1 of the architecture.

Still open (O3–O5) and **do not block v0** — defaults chosen below, revisit in Phase 2:

- **O3 — active-day threshold.** v0 default: `activeDayMinAmount = 1` (any entry counts).
  Already a `Settings` field, so flipping it later is a setting, not a migration.
- **O4 — partial-period display.** v0 shows volume % plus an explicit
  `day 3 of 7` line, so a small percentage is never read as failure. Pace *badges* are Phase 2.
- **O5 — duration UX.** v0 ships **presets** (`:30 / :60 / :90`). Stopwatch is Phase 2.

---

## 1. What "v0" means

**v0 is done when this works, on your S24, from the GitHub Pages URL:**

> Open the app → log `20` push-ups with one tap → the weekly ring moves → reload the page →
> the 20 is still there → open Progress → see volume % for each exercise and your active-days
> count for the week → export a JSON backup → turn on airplane mode → the app still opens and
> still logs.

That is the whole bar. Everything else is Phase 2+.

### In scope for v0

- Scaffold: Vite + TypeScript + Preact + Dexie, ESLint layer boundaries, Vitest, CI.
- Pure domain layer: period math, goal selection, volume %, regularity %, formatting. Fully tested.
- Dexie schema v1 + typed repositories.
- Seeded exercises (Push-up / Core / Toe Touch) and a first-run goal set.
- **Today** screen: per-exercise quick-add, today's total, weekly progress ring.
- **Progress** screen: volume % per exercise, regularity %, 7-day grid.
- Minimal **targets editor** (3 numbers + active days/week) so the rings mean something.
- **JSON export** + `navigator.storage.persist()` + stale-backup nudge.
- PWA: manifest, service worker, installable, offline after first load.
- Deploy workflow to GitHub Pages; Playwright smoke test in CI.

### Explicitly NOT in v0

Month-period UI · pace badges · history view · goal versioning UI · import + merge ·
day-cutoff & week-start settings · streaks · calendar heatmap · exercise archiving UI ·
CSV · stopwatch · body metrics · any network call.

Naming these now is the point: each is a Phase 2 issue, not a v0 "while we're here".

---

## 2. Repository prerequisites (do these before any code)

These are not code slices; they are one-time repo settings. **They block CI and deploy**, so they
come first.

| # | Action | Why |
|---|---|---|
| P1 | Create `main` from `docs/architecture`, **set it as the default branch** | Today the default branch is `docs/architecture`. `deploy.yml` triggers on `main` (§8) and a long-lived doc branch should not be the trunk. |
| P2 | Enable branch protection on `main`: require PR + green CI, no direct pushes | Keeps the trunk deployable. This is what makes `Closes #N` meaningful. |
| P3 | **Check repo visibility.** Pages on a *private* repo needs a paid plan | If the repo is private on a free account, the deploy job will fail at `deploy-pages`. Decide: make it public, or drop Pages from v0 and install via LAN. |
| P4 | Confirm Node 22 LTS is the target (`.nvmrc`) | This sandbox has no Node, so CI is the source of truth for the first slices. Pin it in one place. |
| P5 | Create the v0 issues from §4 so PRs can say `Closes #N` | One issue per slice. |

> **Note on branch naming:** the repo-level convention is `feature/<name>` / `fix/<name>` off the
> integration branch. `~/AGENTS.md` mentions a `v1` branch — that is the generic template and does
> not match this repo (architecture §8 deploys on `main`). **This plan uses `main`.**

---

## 3. Slice sequence

Nine PR-sized slices. Each is independently reviewable and leaves `main` green.
Order matters: the domain slices have no UI dependency, so they land first and fast.

| # | Slice | Branch | Depends on | Tests added |
|---|---|---|---|---|
| S0 | Repo prerequisites (§2) | — (settings only) | — | — |
| S1 | Scaffold + CI | `feature/scaffold` | S0 | 1 smoke |
| S2 | Domain: types + period math | `feature/domain-period` | S1 | ~16 |
| S3 | Domain: goals + versioning | `feature/domain-goals` | S2 | ~10 |
| S4 | Domain: progress + format | `feature/domain-progress` | S3 | ~16 |
| S5 | Data: Dexie v1 + repos | `feature/data-repos` | S4 | ~12 |
| S6 | UI: Today + QuickAdd | `feature/ui-today` | S5 | ~8 |
| S7 | UI: Progress screen | `feature/ui-progress` | S6 | ~3 |
| S8 | Targets editor | `feature/ui-targets` | S7 | ~3 |
| S9 | Backup: JSON export | `feature/backup-export` | S5 | ~4 |
| S10 | PWA + deploy + e2e | `feature/pwa-deploy` | S7, S9 | ~4 |

S9 can run in parallel with S6–S8 (it only needs S5). S10 must be last: it is the only slice that
needs everything on a real phone.

---

## 4. Slice detail

Each slice: **goal → files → tests → done-when**. The `done-when` line is the PR acceptance
criterion and the issue body.

### S1 — Scaffold + CI  · `feature/scaffold`

**Goal:** `npm ci && npm run build` produces a deployable bundle; CI enforces it.

Files: `package.json`, `tsconfig.json`, `.nvmrc`, `.gitignore`, `vite.config.ts`,
`eslint.config.js`, `index.html`, `src/main.tsx`, `src/ui/screens/Today.tsx` (placeholder),
`.github/workflows/ci.yml`, `README.md`.

Key config:
- `base: "/sport-app/"` — Pages serves a subpath; get this wrong and the PWA 404s (§8).
- ESLint: `no-restricted-imports` forbidding `domain → data`/`ui`, and
  `no-restricted-globals` banning `Date`, `Date.now`, `performance.now` **inside `src/domain/`**.
  This rule is the enforcement mechanism for the whole testing strategy — land it here, not later.
- `ci.yml`: `install → lint → typecheck → test → build`, on PRs.

Tests: one trivial domain test so the runner is proven wired.

**Done when:** a PR with an empty commit is green on CI, and `npm run build` output loads at
`/sport-app/`.

---

### S2 — Domain: types + period math · `feature/domain-period`

**Goal:** every calendar question in the app is answered by a pure function.

Files: `src/domain/types.ts`, `src/domain/period.ts`, `src/domain/period.test.ts`.

Functions: `resolveDay(now, cutoffHour) → IsoDate`, `weekRange(anchorDay, weekStartsOn) → PeriodRange`,
`monthRange(anchorDay) → PeriodRange`, `elapsedFraction(range, today) → number`,
`daysIn(range) → IsoDate[]`, `isInRange(day, range)`.

Tests (~16) — these are the ones that break in production if wrong:
- cutoff 3: `00:30` → previous day; `03:30` → same day; cutoff 0 → never shifts.
- Monday vs Sunday week start on the same anchor date.
- A week spanning a month boundary; a week spanning a **year** boundary.
- Month edges: 28/29/30/31 days; leap February.
- `elapsedFraction` is `0 < f ≤ 1`, and `1` for a finished period.
- DST transition day: the local day is still one day (this is why we never derive `day` from UTC).

**Done when:** no test constructs a `Date` — every case passes explicit `today`/`now` values.

---

### S3 — Domain: goals + versioning · `feature/domain-goals`

**Goal:** "which goal was in force?" is a pure, tested decision.

Files: `src/domain/goals.ts`, `src/domain/goals.test.ts`.

Functions: `goalInForce(goals, scope, period, rangeEnd) → Goal | undefined`,
`splitGoal(goal, atDay, newTarget) → [Goal, Goal]`, `activeGoals(goals, atDay)`.

Rule (architecture §2.2): select the goal in force **at the end of the evaluated period**, so
raising a target in March never rewrites January's percentage.

Tests (~10): single open-ended goal; a retired goal (`effectiveTo` set); two rows where the later
one starts mid-period; gap between rows → `undefined`; `splitGoal` produces adjacent,
non-overlapping ranges and is lossless (the original target survives in the closed row).

**Done when:** changing a goal's `target` mid-history is provably a no-op for past periods.

---

### S4 — Domain: progress + format · `feature/domain-progress`

**Goal:** the two percentages, the pace state, and the strings the UI prints.

Files: `src/domain/progress.ts`, `src/domain/format.ts`, `*.test.ts`.

`evaluate(range, entries, goals, settings) → ProgressReport` with, per exercise:
`achieved`, `target`, `volumePct` (unclamped), `clampedPct` (0–100), `pace` state; plus
`activeDays`, `activeDaysTarget`, `regularityPct`. `format.ts`: `"1 250 reps"`, `"2 m 30 s"`,
`"140 %"`.

Tests (~16): zero entries → `0 %`, pace `behind`; exactly at target → `100 %`, `done`;
`140 %` reported while clamp yields `100`; over-target with `cap: true` → `over-cap`;
active-days counts distinct days, not entries (3 sets in one day = 1 active day);
a day below `activeDayMinAmount` does not count; empty period does not divide by zero;
duration formatting (`90 s` → `"1 m 30 s"`); rounding never prints `99.99 %` or `100.01 %`.

**Done when:** the domain layer is feature-complete for v0 and `npm run test` is < 1 s.

---

### S5 — Data: Dexie v1 + repositories · `feature/data-repos`

**Goal:** typed persistence with the two hot queries indexed.

Files: `src/data/db.ts`, `src/data/repos/{exercises,entries,goals,settings}.ts`,
`src/data/seed.ts`, `*.test.ts` (Vitest + `fake-indexeddb`).

Schema is exactly architecture §5.1 (`exercises` by `order`, `entries` by
`[exerciseId+day]` and `[day+exerciseId]`, `goals` by `effectiveFrom`, single `settings` row).

Seed on first run: **Push-up** (reps, step 5, 300/wk) · **Core** (duration, step 30 s, 900 s/wk) ·
**Toe Touch** (reps, step 5, 150/wk) · active days **4/wk**. These are placeholders — S8 exists so
you change them without a code edit.

Tests (~12): CRUD per repo; `entriesForDay` and `entriesInRange` hit the compound indexes;
`day` is written by the repo using injected settings, never by the caller's clock; seeding is
idempotent (re-open does not duplicate); archiving an exercise keeps its entries queryable.

**Done when:** the repos are the *only* place that touches Dexie, and the domain is imported by
them (never the reverse).

---

### S6 — UI: Today + QuickAdd · `feature/ui-today`

**Goal:** log a set in one tap and see the ring move with no manual refresh.

Files: `src/ui/state.ts` (Dexie `liveQuery` → signals), `src/ui/screens/Today.tsx`,
`src/ui/components/{QuickAdd,ProgressRing}.tsx`, component tests.

Layout per exercise: name, today's total, `+5 / +10` (or `:30 / :60 / :90`), long-press to
undo the last set. Top: weekly ring for the selected exercise.

Tests (~8): `+5` emits one entry with the right `exerciseId`/`amount`/`day`; duration preset
emits seconds; undo removes exactly one row; ring width clamps at 100 while the label prints
`140 %`.

**Done when:** on a phone, tapping `+20` twice shows `40` and a moved ring without a reload.

---

### S7 — UI: Progress screen · `feature/ui-progress`

**Goal:** answer "did I do the work?" and "did I show up?" on one screen.

Files: `src/ui/screens/Progress.tsx`, `src/ui/components/{PeriodSwitcher,DayGrid}.tsx`.

Content: volume % per exercise for the current week, regularity % (`3 of 4 days`), 7-day grid of
active days, and a `day 3 of 7` line so partial weeks read correctly (O4). PeriodSwitcher is
present but **week-only** in v0.

Tests (~3): renders N exercises from a report fixture; empty week renders zeros, not `NaN`;
`day 3 of 7` appears mid-week.

**Done when:** both percentages are visible and correct against a hand-checked week.

---

### S8 — Targets editor · `feature/ui-targets`

**Goal:** change a weekly target without editing code.

Files: `src/ui/screens/Settings.tsx` (minimal), goal repo usage.

Four numeric inputs (3 exercises + active days). Saving writes a **new `Goal` row** via
`splitGoal` (S3) with `effectiveFrom = today`, retiring the previous row — never mutating the old
one. This is the whole reason goal versioning exists; exercising it in v0 keeps it honest.

Tests (~3): saving writes a new row and closes the old one; history before today is unchanged;
invalid input (0, negative, non-numeric) is rejected.

**Done when:** raising Push-up 300 → 350 changes this week's % but not last week's.

---

### S9 — Backup: JSON export · `feature/backup-export`

**Goal:** the only recovery path if Android clears site data. Architecture §5.3 says v0, not later.

Files: `src/data/backup.ts`, `src/ui/components/ExportButton.tsx`, tests.

Export writes the §5.3 envelope (`format`, `schemaVersion`, `exportedAt`, `data`), downloads via
`Blob` + `<a download>`, and stamps `lastExportAt`. Also: `navigator.storage.persist()` on first
launch, and a dismissible nudge when `lastExportAt` is > 14 days old with ≥ 7 days of entries.

Tests (~4): envelope shape and `schemaVersion`; round-trip export → parse → same row counts;
`lastExportAt` is stamped; nudge logic fires at 15 days and not at 13.

**Done when:** the downloaded file contains every entry, and re-importing it (Phase 2) will be
possible without a format change.

---

### S10 — PWA + deploy + e2e · `feature/pwa-deploy`

**Goal:** installable on the S24, offline, auto-deployed. This is the slice that makes it real.

Files: `vite.config.ts` (add `vite-plugin-pwa`), `src/sw.ts`, `public/icons/*`,
`manifest` in Vite config, `.github/workflows/deploy.yml`, `playwright.config.ts`,
`e2e/smoke.spec.ts`.

Config: `registerType: "prompt"` (never auto-`skipWaiting` mid-entry); precache hashed assets;
**never** serve a stale-first `index.html`; manifest `start_url`/`scope` relative-aware for the
`/sport-app/` base; `deploy.yml` with `pages: write` + `id-token: write`.

E2E (~4): seed → log two sets → volume % changes → **reload** → data persists; offline reload
serves the app from cache; export downloads a file; empty-state renders.

**Done when:** the acceptance script in §5 passes on the phone, from the Pages URL.

---

## 5. v0 acceptance script (run on the S24, Pages URL)

1. Open `https://<user>.github.io/sport-app/` in Chrome → **Add to Home screen** → launch from icon.
2. Log `20` push-ups, then `15`, then `12`. Today shows `47`; the ring moves after each tap.
3. Log `:60` core. Core shows `1 m 0 s`.
4. Reload / kill Chrome / relaunch from the icon → `47` and `1 m 0 s` are still there.
5. Progress → volume % for Push-up, Core, Toe Touch; `1 of 4 days`; `day X of 7` line.
6. Settings → raise Push-up to 350 → the weekly % drops; no crash.
7. Settings → Export → a `.json` file lands in Downloads.
8. **Airplane mode** → relaunch from the icon → app opens, a new set still logs.
9. Airplane off → the app never needed the network for any of the above.

All nine pass → **v0 shipped**. Any failure → the slice that owns it is not done.

---

## 6. Risks

| # | Risk | Mitigation |
|---|---|---|
| R1 | **Private repo + free account → `deploy-pages` fails.** | Resolve at P3, before S10. Fallback: LAN install (architecture §6). |
| R2 | **`base` path wrong → installed PWA 404s.** Blank page is the classic symptom. | Set `base: "/sport-app/"` in S1, verify the built `index.html` asset URLs, and run the E2E against `vite preview` with the same base. |
| R3 | **Stale service worker** serves an old `index.html` forever. | `registerType: "prompt"` + never cache `index.html` stale-first. Test by deploying twice in S10. |
| R4 | **Android evicts site data** → all history gone. | Export in v0 (S9) + `storage.persist()` + the 14-day nudge. This is the highest-consequence risk in the whole project. |
| R5 | **Time-zone / day-boundary bugs** corrupt the weekly numbers. | All of it is in `period.ts` (S2) behind injected time, with DST + cutoff cases. This is why the domain has no clock. |
| R6 | **Scope creep into Phase 2** (month view, import, streaks). | The "NOT in v0" list in §1 is the gate. New ideas become Phase 2 issues, not v0 commits. |
| R7 | **No Node in the build sandbox** → slices cannot be verified locally here. | CI is the gate; keep `ci.yml` from S1 and require it green before merge (P2). |

---

## 7. Sequencing and effort

Relative effort, not calendar promises. Domain slices are fast and low-risk; UI and PWA slices
carry the unknowns.

```
S1 scaffold      ████░░░░░░   ~1 session
S2 period        ███░░░░░░░
S3 goals         ██░░░░░░░░
S4 progress      ███░░░░░░░
S5 data          ███░░░░░░░
S6 today UI      █████░░░░░   ~1 session
S7 progress UI   ███░░░░░░░
S8 targets       ██░░░░░░░░
S9 export        ███░░░░░░░
S10 pwa+deploy   ██████░░░░   the risky one — real device, real cache
```

Critical path: **S1 → S2 → S3 → S4 → S5 → S6 → S10**. S7/S8/S9 are parallelisable off S6/S5.
Roughly **4–6 focused sessions** to the §5 script passing.

---

## 8. Definition of done (v0)

- [ ] `main` is the default branch, protected, CI green (P1, P2).
- [ ] §5 acceptance script passes on the S24 from the Pages URL.
- [ ] `npm run lint && npm run typecheck && npm run test && npm run build` clean.
- [ ] Domain coverage ≥ 90 % lines; ~42 unit + ~12 integration + ~14 component + 4 e2e.
- [ ] ESLint boundary rules active: `domain` imports nothing from `data`/`ui`, no clock in `domain`.
- [ ] Offline works after first load; update shows the prompt toast, never a silent swap.
- [ ] Export produces a valid `sport-app-backup` v1 envelope.
- [ ] Every Phase 2 item from §1 exists as an issue, so nothing is "forgotten" — just deferred.

---

## 9. Open items to confirm before S1

1. **`main` as trunk** (P1) — confirms the branch model this plan assumes.
2. **Repo visibility** (P3) — decides whether S10 deploys to Pages or installs over LAN.
3. **Seed numbers** (§S5: 300 push-ups / 15 min core / 150 toe touch / 4 active days) — are
   these close enough to your real targets to ship as defaults, or should the first-run set be
   lower so v0 opens on a good week?
