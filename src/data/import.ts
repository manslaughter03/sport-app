/**
 * Backup import + merge (docs/architecture.md §5.3, issue #15).
 *
 * Export shipped in v0 and import did not, which made the backup one-way: a
 * backup you cannot restore is not a backup. This is the other half.
 *
 * Four rules, and they are the whole design:
 *
 * 1. **Validate before writing.** `parseBackup` checks the envelope; this module
 *    checks every row *and* that every foreign key resolves. A file naming a
 *    missing exercise is refused before a single row is touched.
 * 2. **Merge by id.** Re-importing the same file is a no-op: rows present with
 *    identical content are counted as `skipped`, never re-added. That is what
 *    makes it safe to import the same backup twice, or an old one over newer
 *    data.
 * 3. **Last writer wins, by `createdAt`.** Same id with different content is a
 *    conflict: the row with the later `createdAt` survives and the count of
 *    overwritten rows is reported. Equal content is not a conflict, so a
 *    re-import stays a no-op instead of churning `put`s.
 * 4. **One transaction.** Merge and replace-all both run inside a single Dexie
 *    transaction, so a failure halfway leaves the database exactly as it was.
 *    There is no partial import to clean up after.
 *
 * `entries.seq` is monotonic *per database* and drives "undo last". An imported
 * row keeps its `seq` when that slot is free (which is what makes a replace-all
 * restore byte-for-byte equal); where it collides, or where the file's own
 * numbering is not strictly increasing, it is re-derived while preserving the
 * file's relative order. Trusting the file outright would let undo delete the
 * wrong set.
 */

import type { SportDatabase, SettingsRow } from "./db.ts";
import { SCHEMA_VERSION } from "./db.ts";
import type { Backup } from "./backup.ts";
import { defaultSettings } from "./repos/settings.ts";
import type { Entry, Exercise, Goal } from "../domain/types.ts";

/** Which rows to touch. `merge` is additive and idempotent; `replace` wipes first. */
export type ImportMode = "merge" | "replace";

/** Table sizes, for reporting what an import did. */
export interface TableCounts {
  readonly exercises: number;
  readonly entries: number;
  readonly goals: number;
}

export interface ImportReport {
  readonly mode: ImportMode;
  /** Rows written that were not present locally. */
  readonly added: TableCounts;
  /** Rows replaced because the file's copy was newer (last-write-wins). */
  readonly overwritten: TableCounts;
  /** Rows already present and identical, or older than the local copy. */
  readonly skipped: TableCounts;
  /** Rows deleted by `replace` to make room for the file's copy. */
  readonly removed: TableCounts;
  /** Entries whose `seq` was re-derived instead of trusted. */
  readonly resequenced: number;
  /** True when the database was left exactly as it was. */
  readonly noop: boolean;
}

export interface ImportOptions {
  /** Defaults to `merge`: additive, idempotent, and the safe choice. */
  mode?: ImportMode;
}

/**
 * Raised when the file is structurally valid JSON but cannot be applied safely:
 * a dangling `exerciseId`, a duplicate id inside one file, a row with no `day`.
 * `issues` carries the detail so the UI can show what is wrong with the file
 * rather than a shrug.
 */
export class ImportValidationError extends Error {
  readonly issues: readonly string[];

  constructor(message: string, issues: readonly string[] = []) {
    super(message);
    this.name = "ImportValidationError";
    this.issues = issues;
  }
}

const MAX_REPORTED_ISSUES = 5;

function summarise(issues: readonly string[]): string {
  const shown = issues.slice(0, MAX_REPORTED_ISSUES).join("; ");
  const rest = issues.length - MAX_REPORTED_ISSUES;
  return rest > 0 ? `${shown}; and ${rest} more` : shown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isIsoDate(value: unknown): value is string {
  return typeof value === "string" && ISO_DATE_PATTERN.test(value);
}

/** Instants are only audited and compared, so a shape check is enough. */
function isIsoInstant(value: unknown): value is string {
  return typeof value === "string" && value.length >= 20;
}

function isPositiveNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

// ---------------------------------------------------------------------------
// Row validation
//
// Each helper takes its *own* issues array so one bad row cannot poison the
// verdict on the rows after it.
// ---------------------------------------------------------------------------

/**
 * Projects a stored row onto the fields this app knows about.
 *
 * Unknown keys are dropped rather than carried: a build importing a file from a
 * slightly newer one keeps only what it understands, which is the same
 * guarantee the forward-only migration rule gives (§5.2).
 */
function toExercise(value: unknown, issues: string[]): Exercise | undefined {
  if (!isRecord(value)) {
    issues.push("is not an object");
    return undefined;
  }
  const { id, name, kind, unit, step, order, archivedAt } = value;
  if (!isNonEmptyString(id)) issues.push("has no id");
  if (!isNonEmptyString(name)) issues.push("has no name");
  if (kind !== "reps" && kind !== "duration") issues.push("has an unknown kind");
  if (!isNonEmptyString(unit)) issues.push("has no unit");
  if (!isPositiveNumber(step)) issues.push("has no positive step");
  if (typeof order !== "number" || !Number.isFinite(order)) issues.push("has no order");
  if (archivedAt !== undefined && !isNonEmptyString(archivedAt)) {
    issues.push("has an unusable archivedAt");
  }
  if (issues.length > 0) return undefined;

  return {
    id: id as string,
    name: name as string,
    kind: kind as Exercise["kind"],
    unit: unit as string,
    step: step as number,
    order: order as number,
    ...(archivedAt === undefined ? {} : { archivedAt: archivedAt as string }),
  };
}

function toEntry(value: unknown, issues: string[]): Entry | undefined {
  if (!isRecord(value)) {
    issues.push("is not an object");
    return undefined;
  }
  const { id, exerciseId, day, amount, createdAt, seq, note } = value;
  if (!isNonEmptyString(id)) issues.push("has no id");
  if (!isNonEmptyString(exerciseId)) issues.push("has no exerciseId");
  // `day` is stored, never derived (§2.2). An entry without one cannot be
  // placed in a period, and inventing one would silently move history.
  if (!isIsoDate(day)) issues.push("has no usable day");
  if (!isPositiveNumber(amount)) issues.push("has no positive amount");
  if (!isIsoInstant(createdAt)) issues.push("has no createdAt");
  if (typeof seq !== "number" || !Number.isInteger(seq)) issues.push("has no integer seq");
  if (note !== undefined && typeof note !== "string") issues.push("has a non-string note");
  if (issues.length > 0) return undefined;

  return {
    id: id as string,
    exerciseId: exerciseId as string,
    day: day as string,
    amount: amount as number,
    createdAt: createdAt as string,
    seq: seq as number,
    ...(note === undefined ? {} : { note: note as string }),
  };
}

function toGoal(value: unknown, issues: string[]): Goal | undefined {
  if (!isRecord(value)) {
    issues.push("is not an object");
    return undefined;
  }
  const { id, scope, period, target, cap, effectiveFrom, effectiveTo, createdAt } = value;
  if (!isNonEmptyString(id)) issues.push("has no id");
  if (!isRecord(scope)) {
    issues.push("has no scope");
  } else if (scope["kind"] === "exercise") {
    if (!isNonEmptyString(scope["exerciseId"])) {
      issues.push("has an exercise scope with no exerciseId");
    }
  } else if (scope["kind"] !== "activeDays") {
    issues.push("has an unknown scope");
  }
  if (period !== "week" && period !== "month") issues.push("has an unknown period");
  if (!isPositiveNumber(target)) issues.push("has no positive target");
  if (typeof cap !== "boolean") issues.push("has no cap flag");
  if (!isIsoDate(effectiveFrom)) issues.push("has no usable effectiveFrom");
  if (effectiveTo !== undefined && !isIsoDate(effectiveTo)) {
    issues.push("has an unusable effectiveTo");
  }
  if (!isIsoInstant(createdAt)) issues.push("has no createdAt");
  if (issues.length > 0) return undefined;

  return {
    id: id as string,
    scope: scope as Goal["scope"],
    period: period as Goal["period"],
    target: target as number,
    cap: cap as boolean,
    effectiveFrom: effectiveFrom as string,
    ...(effectiveTo === undefined ? {} : { effectiveTo: effectiveTo as string }),
    createdAt: createdAt as string,
  };
}

function toSettings(value: unknown, issues: string[]): SettingsRow | undefined {
  if (!isRecord(value)) {
    issues.push("is not an object");
    return undefined;
  }
  const { weekStartsOn, dayCutoffHour, activeDayMinAmount } = value;
  if (weekStartsOn !== 1 && weekStartsOn !== 7) issues.push("weekStartsOn must be 1 or 7");
  if (
    typeof dayCutoffHour !== "number" ||
    !Number.isInteger(dayCutoffHour) ||
    dayCutoffHour < 0 ||
    dayCutoffHour > 23
  ) {
    issues.push("dayCutoffHour must be an integer 0..23");
  }
  if (!isPositiveNumber(activeDayMinAmount)) {
    issues.push("activeDayMinAmount must be a positive number");
  }
  if (issues.length > 0) return undefined;

  const lastExportAt = value["lastExportAt"];
  const lastBackupNudgeAt = value["lastBackupNudgeAt"];

  return {
    id: defaultSettings().id,
    weekStartsOn: weekStartsOn as 1 | 7,
    dayCutoffHour: dayCutoffHour as number,
    activeDayMinAmount: activeDayMinAmount as number,
    // Always stamped with what *this* build understands, never the file's
    // claim: after migration the row matches the code that now reads it.
    schemaVersion: SCHEMA_VERSION,
    ...(isNonEmptyString(lastExportAt) ? { lastExportAt } : {}),
    ...(isNonEmptyString(lastBackupNudgeAt) ? { lastBackupNudgeAt } : {}),
  };
}

/** What a backup looks like once it is known to be safe to apply. */
export interface ValidatedBackup {
  readonly exercises: readonly Exercise[];
  readonly entries: readonly Entry[];
  readonly goals: readonly Goal[];
  readonly settings: SettingsRow;
  readonly schemaVersion: number;
}

/**
 * Validates every row of a parsed backup, and the links between them.
 *
 * The envelope check lives in `parseBackup`; this is the part a UI that trusted
 * the counts would skip — and then apply a file whose entries point at an
 * exercise that does not exist, producing periods that quietly drop sets.
 */
export function validateBackup(backup: Backup): ValidatedBackup {
  if (backup.schemaVersion > SCHEMA_VERSION) {
    // Belt and braces: `parseBackup` already refuses this, but `importBackup`
    // also accepts an already-parsed object, so the gate belongs here too.
    throw new ImportValidationError(
      `This backup was made by a newer version of the app (schema ${backup.schemaVersion}, this build supports ${SCHEMA_VERSION}). Update the app first.`,
    );
  }

  const issues: string[] = [];

  function collect<T>(
    section: string,
    raw: readonly unknown[],
    parse: (value: unknown, issues: string[]) => T | undefined,
  ): T[] {
    const out: T[] = [];
    const seen = new Set<string>();
    raw.forEach((value, index) => {
      const rowIssues: string[] = [];
      const parsed = parse(value, rowIssues);
      if (parsed !== undefined) {
        const id = (parsed as { id: string }).id;
        if (seen.has(id)) {
          rowIssues.push("has a duplicate id");
        } else {
          seen.add(id);
          out.push(parsed);
        }
      }
      for (const issue of rowIssues) issues.push(`${section}[${index}] ${issue}`);
    });
    return out;
  }

  const exercises = collect("exercises", backup.data.exercises, toExercise);
  const entries = collect("entries", backup.data.entries, toEntry);
  const goals = collect("goals", backup.data.goals, toGoal);

  const settingsIssues: string[] = [];
  const settings = toSettings(backup.data.settings, settingsIssues);
  for (const issue of settingsIssues) issues.push(`settings ${issue}`);

  // Foreign keys. An entry whose exercise is missing is unreachable history: it
  // would still count towards regularity while inflating no exercise's volume.
  const exerciseIds = new Set(exercises.map((exercise) => exercise.id));
  for (const entry of entries) {
    if (!exerciseIds.has(entry.exerciseId)) {
      issues.push(`entry ${entry.id} refers to unknown exercise ${entry.exerciseId}`);
    }
  }
  for (const goal of goals) {
    if (goal.scope.kind === "exercise" && !exerciseIds.has(goal.scope.exerciseId)) {
      issues.push(`goal ${goal.id} refers to unknown exercise ${goal.scope.exerciseId}`);
    }
  }

  if (issues.length > 0 || settings === undefined) {
    throw new ImportValidationError(
      `This backup cannot be imported safely: ${summarise(issues)}.`,
      issues,
    );
  }

  return { exercises, entries, goals, settings, schemaVersion: backup.schemaVersion };
}

// ---------------------------------------------------------------------------
// Migration seam
// ---------------------------------------------------------------------------

/**
 * Runs the file's rows through the import-migration chain.
 *
 * v1 is the oldest schema this build can read, so today every reachable file is
 * already current and this is a no-op — but the seam is here, in one place,
 * *before* merging, because that is where the next schema bump has to hook in
 * (docs/architecture.md §5.2: forward-only, never guess).
 */
export function migrateToCurrent(validated: ValidatedBackup): ValidatedBackup {
  // Older files get a step here, e.g. `if (v.schemaVersion < 2) v = migrateV1toV2(v)`.
  // A file *newer* than this build never reaches here: `validateBackup` throws.
  if (validated.schemaVersion > SCHEMA_VERSION) {
    throw new ImportValidationError(
      `Cannot migrate a backup from schema ${validated.schemaVersion} down to ${SCHEMA_VERSION}.`,
    );
  }
  return { ...validated, schemaVersion: SCHEMA_VERSION };
}

// ---------------------------------------------------------------------------
// Merge
// ---------------------------------------------------------------------------

/** How one id-keyed row resolved against the local copy. */
type Resolution = "add" | "overwrite" | "skip";

/**
 * The conflict rule: last writer wins, keyed on `createdAt`.
 *
 * `createdAt` is the only audit trail this model has, so it is the only honest
 * tiebreak for "same id, different content". A local row that is newer means the
 * file is stale for that id: the file loses, the local row is kept.
 */
function resolveStamped(
  incoming: { readonly id: string; readonly createdAt: string },
  existing: { readonly id: string; readonly createdAt: string } | undefined,
  same: boolean,
): Resolution {
  if (existing === undefined) return "add";
  if (same) return "skip";
  return incoming.createdAt > existing.createdAt ? "overwrite" : "skip";
}

/**
 * The conflict rule for rows that carry no `createdAt` (`Exercise`, whose
 * timestamps live only in `archivedAt`).
 *
 * There is no timestamp to compare, so there is no defensible "later" — and
 * inventing one would silently rewrite a local exercise's name or step. The
 * local row therefore wins and the fact is reported as a skip, which is visible
 * in the UI rather than silent.
 */
function resolveUnstamped(
  _incoming: { readonly id: string },
  existing: { readonly id: string } | undefined,
  _same: boolean,
): Resolution {
  return existing === undefined ? "add" : "skip";
}

function sameContent(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  for (const key of keys) {
    if (!sameContent(left[key], right[key])) return false;
  }
  return true;
}

interface Tally {
  added: number;
  overwritten: number;
  skipped: number;
}

interface Resolved<T> {
  readonly row: T;
  readonly resolution: Resolution;
}

function tally(resolved: readonly Resolved<unknown>[]): Tally {
  const result: Tally = { added: 0, overwritten: 0, skipped: 0 };
  for (const item of resolved) {
    if (item.resolution === "add") result.added += 1;
    else if (item.resolution === "overwrite") result.overwritten += 1;
    else result.skipped += 1;
  }
  return result;
}

/** Resolves every incoming row against the local copy of the same id. */
function resolveAll<T extends { readonly id: string }>(
  incoming: readonly T[],
  existingById: ReadonlyMap<string, T>,
  rule: (incoming: T, existing: T | undefined, same: boolean) => Resolution,
): Resolved<T>[] {
  return incoming.map((row) => {
    const existing = existingById.get(row.id);
    return {
      row,
      resolution: rule(row, existing, existing !== undefined && sameContent(row, existing)),
    };
  });
}

/**
 * Assigns `seq` to the entries about to be written, leaving local rows alone.
 *
 * Rules, in order:
 * - A free, strictly-increasing `seq` from the file is kept, so a restore is
 *   byte-for-byte equal.
 * - If the file's numbering is not strictly increasing, it is renumbered by
 *   relative order: a tie inside the file is as broken as a collision with a
 *   local row, because both make "undo last" pick an arbitrary set.
 * - A `seq` still held by a local row that this import is not replacing is a
 *   collision and is re-derived from the current maximum.
 */
export function assignSeq(
  incoming: readonly Entry[],
  survivors: readonly Entry[],
): { entries: Entry[]; resequenced: number } {
  const taken = new Set(survivors.map((entry) => entry.seq));
  let maxSeq = survivors.reduce((max, entry) => (entry.seq > max ? entry.seq : max), 0);

  let trustworthy = true;
  const entries: Entry[] = [];
  let resequenced = 0;

  for (const entry of incoming) {
    if (trustworthy && !taken.has(entry.seq)) {
      taken.add(entry.seq);
      if (entry.seq > maxSeq) maxSeq = entry.seq;
      entries.push(entry);
      continue;
    }
    // From here on the file's numbering cannot be trusted at all.
    trustworthy = false;
    resequenced += 1;
    maxSeq += 1;
    taken.add(maxSeq);
    entries.push({ ...entry, seq: maxSeq });
  }

  return { entries, resequenced };
}

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

async function countAll(db: SportDatabase): Promise<TableCounts> {
  const [exercises, entries, goals] = await Promise.all([
    db.exercises.count(),
    db.entries.count(),
    db.goals.count(),
  ]);
  return { exercises, entries, goals };
}

/**
 * Applies a backup to the database and reports what changed.
 *
 * Everything happens in one transaction over all four tables: either the file
 * lands completely or the database is untouched. Do not wrap this in another
 * transaction — Dexie would promote it, and the counts are read inside.
 */
export async function importBackup(
  db: SportDatabase,
  backup: Backup,
  options: ImportOptions = {},
): Promise<ImportReport> {
  const mode = options.mode ?? "merge";
  const validated = migrateToCurrent(validateBackup(backup));

  return db.transaction("rw", db.exercises, db.entries, db.goals, db.settings, async () => {
    const before = await countAll(db);

    const emptyRemoved: TableCounts = { exercises: 0, entries: 0, goals: 0 };
    const removed = mode === "replace" ? before : emptyRemoved;

    // Replace-all is the "restore onto a clean install" path: the file becomes
    // the database, so nothing local can win a conflict. The confirmation lives
    // in the UI; by the time we get here the intent is explicit.
    if (mode === "replace") {
      await db.exercises.clear();
      await db.entries.clear();
      await db.goals.clear();
    }

    const existingExercises: Exercise[] = mode === "replace" ? [] : await db.exercises.toArray();
    const existingEntries: Entry[] = mode === "replace" ? [] : await db.entries.toArray();
    const existingGoals: Goal[] = mode === "replace" ? [] : await db.goals.toArray();

    const exerciseById = new Map(existingExercises.map((row) => [row.id, row]));
    const goalById = new Map(existingGoals.map((row) => [row.id, row]));
    const entryById = new Map(existingEntries.map((row) => [row.id, row]));

    // --- exercises and goals: pure id merges -------------------------------
    const resolvedExercises = resolveAll(validated.exercises, exerciseById, resolveUnstamped);
    const exerciseWrites = resolvedExercises
      .filter((item) => item.resolution !== "skip")
      .map((item) => item.row);
    const exerciseTally = tally(resolvedExercises);

    const resolvedGoals = resolveAll(validated.goals, goalById, resolveStamped);
    const goalWrites = resolvedGoals
      .filter((item) => item.resolution !== "skip")
      .map((item) => item.row);
    const goalTally = tally(resolvedGoals);

    // --- entries: resolve first, then sequence what will be written ---------
    const resolvedEntries = resolveAll(validated.entries, entryById, resolveStamped);
    const entryCandidates = resolvedEntries
      .filter((item) => item.resolution !== "skip")
      .map((item) => item.row);
    const entryTally = tally(resolvedEntries);

    // Local rows that this import does not replace keep their `seq` slots:
    // re-using one would point "undo last" at a different set.
    const overwrittenIds = new Set(
      resolvedEntries
        .filter((item) => item.resolution === "overwrite")
        .map((item) => item.row.id),
    );
    const survivingEntries = existingEntries.filter((row) => !overwrittenIds.has(row.id));
    const { entries: entryWrites, resequenced } = assignSeq(entryCandidates, survivingEntries);

    if (exerciseWrites.length > 0) await db.exercises.bulkPut(exerciseWrites);
    if (goalWrites.length > 0) await db.goals.bulkPut(goalWrites);
    if (entryWrites.length > 0) await db.entries.bulkPut(entryWrites);

    // Settings is a single row. Replace-all takes the file's copy; a merge keeps
    // the local one, because adopting another device's week start would move
    // every week boundary under history the user already has. A database with no
    // row at all is a clean install, so the file's defaults are an improvement.
    if (mode === "replace") {
      await db.settings.put(validated.settings);
    } else {
      const local = await db.settings.get("app");
      if (local === undefined) await db.settings.put(validated.settings);
    }

    const added: TableCounts = {
      exercises: exerciseTally.added,
      entries: entryTally.added,
      goals: goalTally.added,
    };
    const overwritten: TableCounts = {
      exercises: exerciseTally.overwritten,
      entries: entryTally.overwritten,
      goals: goalTally.overwritten,
    };
    const skipped: TableCounts = {
      exercises: exerciseTally.skipped,
      entries: entryTally.skipped,
      goals: goalTally.skipped,
    };

    const noop =
      mode === "merge" &&
      resequenced === 0 &&
      added.exercises === 0 &&
      added.entries === 0 &&
      added.goals === 0 &&
      overwritten.exercises === 0 &&
      overwritten.entries === 0 &&
      overwritten.goals === 0;

    return { mode, added, overwritten, skipped, removed, resequenced, noop };
  });
}

/** `1 set`, `2 sets` — the report is read by a person, so it reads like one. */
function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

/** One human-readable line, e.g. `+12 exercises, +340 sets, 2 sets already present`. */
export function describeImport(report: ImportReport): string {
  const parts: string[] = [];

  if (report.mode === "replace") parts.push("Replaced everything in this app");

  if (report.added.exercises > 0) parts.push(`+${plural(report.added.exercises, "exercise")}`);
  if (report.added.goals > 0) parts.push(`+${plural(report.added.goals, "goal row")}`);
  if (report.added.entries > 0) parts.push(`+${plural(report.added.entries, "set")}`);

  if (report.overwritten.exercises > 0) {
    parts.push(`${plural(report.overwritten.exercises, "exercise")} updated`);
  }
  if (report.overwritten.goals > 0) {
    parts.push(`${plural(report.overwritten.goals, "goal row")} updated`);
  }
  if (report.overwritten.entries > 0) {
    parts.push(`${plural(report.overwritten.entries, "set")} updated`);
  }

  // Structural rows (exercises, goals) are reported separately from sets: "4
  // rows already present" hides the one number the user came here for.
  if (report.skipped.entries > 0) {
    parts.push(`${plural(report.skipped.entries, "set")} already present`);
  }
  const structuralSkips = report.skipped.exercises + report.skipped.goals;
  if (structuralSkips > 0) {
    parts.push(`${plural(structuralSkips, "row")} of setup already present`);
  }

  // A repeated import is the common case, and "4 rows already present" buries
  // the answer the user wants: nothing changed.
  if (report.noop) return "Nothing to do — this backup is already in the app";

  return parts.join(", ") || "Nothing to do";
}
