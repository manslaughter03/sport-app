/**
 * Backup screen (S9 export, Phase 2 import — issue #15).
 *
 * Export is the only recovery path if Android clears site data, so it has been
 * here since v0. Import is the other half: until a backup can be restored, the
 * file is decoration.
 *
 * The screen follows one rule — nothing destructive happens without a stated
 * confirmation, and every outcome (added / updated / skipped / refused) is
 * reported in words, not just a colour.
 */

import { useCallback, useRef, useState } from "preact/hooks";
import type { AppContext } from "../app.ts";
import { useLiveQuery } from "../live.ts";
import {
  backupFilename,
  buildBackup,
  needsBackupNudge,
  parseBackup,
  serializeBackup,
  stampExport,
} from "../../data/backup.ts";
import {
  describeImport,
  importBackup,
  ImportValidationError,
  type ImportMode,
  type ImportReport,
} from "../../data/import.ts";

export interface BackupProps {
  ctx: AppContext;
}

interface BackupData {
  entryCount: number;
  distinctDays: number;
  exerciseCount: number;
  goalCount: number;
  lastExportAt: string | undefined;
  nudge: boolean;
  today: string;
}

export function Backup({ ctx }: BackupProps) {
  const [status, setStatus] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [importStatus, setImportStatus] = useState<string | undefined>(undefined);
  const [importError, setImportError] = useState<string | undefined>(undefined);
  // A file that parsed and validated, waiting for the user to choose a mode.
  const [pending, setPending] = useState<{ name: string; text: string } | undefined>(undefined);
  const [details, setDetails] = useState<string[]>([]);
  const fileInput = useRef<HTMLInputElement>(null);

  const { data } = useLiveQuery<BackupData>(
    async () => {
      const now = ctx.clock.now();
      const settings = await ctx.settings.get();
      const [entryCount, exercises, goals, entries] = await Promise.all([
        ctx.entries.count(),
        ctx.exercises.all(),
        ctx.goals.all(),
        ctx.entries.all(),
      ]);
      const distinctDays = new Set(entries.map((e) => e.day)).size;

      return {
        entryCount,
        distinctDays,
        exerciseCount: exercises.length,
        goalCount: goals.length,
        lastExportAt: settings.lastExportAt,
        nudge: needsBackupNudge(settings, distinctDays, now.day),
        today: now.day,
      };
    },
    [ctx],
  );

  const handleExport = useCallback(async () => {
    try {
      setError(undefined);
      setDetails([]);
      const backup = await buildBackup(ctx.db, ctx.clock);
      const text = serializeBackup(backup);
      downloadJson(backupFilename(backup.exportedAt), text);
      await stampExport(ctx.db, ctx.clock);
      setStatus(
        `Exported ${backup.data.entries.length} sets across ${backup.data.exercises.length} exercises.`,
      );
    } catch (cause) {
      setStatus(undefined);
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [ctx]);

  /**
   * Reads and validates the file, then *stops*: choosing between merge and
   * replace-all is the user's call, and the choice must be visible before any
   * write. `parseBackup` runs here so a bad file is rejected before the
   * confirmation appears, not after.
   */
  const handleFile = useCallback(async (file: File) => {
    setImportStatus(undefined);
    setImportError(undefined);
    setDetails([]);
    setPending(undefined);

    try {
      const text = await file.text();
      // Parse now for the message; `importBackup` re-parses the same object
      // cheaply and validates every row before writing.
      parseBackup(text);
      setPending({ name: file.name, text });
    } catch (cause) {
      setImportError(message(cause));
      setDetails(cause instanceof ImportValidationError ? [...cause.issues] : []);
    }
  }, []);

  const runImport = useCallback(
    async (mode: ImportMode) => {
      if (pending === undefined) return;
      try {
        setImportError(undefined);
        setDetails([]);
        const backup = parseBackup(pending.text);
        const report = await importBackup(ctx.db, backup, { mode });
        setPending(undefined);
        setImportStatus(describeImport(report));
        setDetails(importDetails(report));
      } catch (cause) {
        setPending(undefined);
        setImportStatus(undefined);
        setImportError(message(cause));
        setDetails(cause instanceof ImportValidationError ? [...cause.issues] : []);
      }
    },
    [ctx, pending],
  );

  if (data === undefined) {
    return (
      <section class="backup">
        <h1>Backup</h1>
        <p class="muted">Loading…</p>
      </section>
    );
  }

  return (
    <section class="backup">
      <h1>Backup</h1>
      <p class="muted">
        Everything lives on this phone and nowhere else. If the browser clears its storage — or you
        lose the phone — this file is the only way back.
      </p>

      {data.nudge ? (
        <p class="notice" data-testid="backup-nudge" role="status">
          You have {data.distinctDays} days of data and the last export was{" "}
          {data.lastExportAt === undefined ? "never" : "a while ago"}. Worth doing now.
        </p>
      ) : null}

      <dl class="stats" data-testid="backup-stats">
        <div>
          <dt>Sets</dt>
          <dd data-testid="stat-entries">{data.entryCount}</dd>
        </div>
        <div>
          <dt>Days</dt>
          <dd data-testid="stat-days">{data.distinctDays}</dd>
        </div>
        <div>
          <dt>Exercises</dt>
          <dd data-testid="stat-exercises">{data.exerciseCount}</dd>
        </div>
        <div>
          <dt>Goal rows</dt>
          <dd data-testid="stat-goals">{data.goalCount}</dd>
        </div>
      </dl>

      <p class="muted" data-testid="last-export">
        {data.lastExportAt === undefined
          ? "Never exported."
          : `Last export: ${data.lastExportAt.slice(0, 10)}`}
      </p>

      <button type="button" class="btn btn--add btn--wide" data-testid="export" onClick={() => { void handleExport(); }}>
        Export JSON
      </button>

      <h2 class="section-title">Restore from a backup</h2>
      <p class="muted">
        Import does not overwrite anything until you choose. Rows are matched by id, so importing
        the same file twice changes nothing.
      </p>

      <input
        ref={fileInput}
        type="file"
        accept="application/json,.json"
        class="visually-hidden"
        data-testid="import-input"
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          // Reset so choosing the same file twice still fires a change event.
          event.currentTarget.value = "";
          if (file !== undefined) void handleFile(file);
        }}
      />
      <button
        type="button"
        class="btn btn--wide"
        data-testid="import-choose"
        onClick={() => fileInput.current?.click()}
      >
        Choose backup file
      </button>

      {pending === undefined ? null : (
        <div class="confirm" data-testid="import-confirm" role="group" aria-label="Import mode">
          <p>
            <strong>{pending.name}</strong> is a valid backup. What should happen to the data
            already on this phone?
          </p>
          <button
            type="button"
            class="btn btn--add btn--wide"
            data-testid="import-merge"
            onClick={() => { void runImport("merge"); }}
          >
            Merge — keep existing data
          </button>
          <p class="muted">
            Adds sets that are missing. Rows already here are kept unless the file's copy is newer.
          </p>
          <button
            type="button"
            class="btn btn--wide btn--danger"
            data-testid="import-replace"
            onClick={() => { void runImport("replace"); }}
          >
            Replace all — {countLabel(data.entryCount, "set")} will be deleted
          </button>
          <p class="muted">
            For restoring onto a fresh install. Everything currently on this phone is removed
            first, including goals and settings.
          </p>
          <button
            type="button"
            class="btn btn--undo btn--wide"
            data-testid="import-cancel"
            onClick={() => setPending(undefined)}
          >
            Cancel
          </button>
        </div>
      )}

      {status === undefined ? null : (
        <p class="saved" role="status" data-testid="export-status">
          {status}
        </p>
      )}
      {error === undefined ? null : (
        <p class="error" role="alert" data-testid="export-error">
          Export failed: {error}
        </p>
      )}

      {importStatus === undefined ? null : (
        <p class="saved" role="status" data-testid="import-status">
          {importStatus}
        </p>
      )}
      {importError === undefined ? null : (
        <p class="error" role="alert" data-testid="import-error">
          Import failed: {importError}
        </p>
      )}
      {details.length === 0 ? null : (
        <ul class="muted" data-testid="import-details">
          {details.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** `1 set` / `3 sets`, so the destructive button never reads "1 sets". */
function countLabel(count: number, singular: string): string {
  return `${count} ${count === 1 ? singular : `${singular}s`}`;
}

function message(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/** The report, broken into the lines a user can actually act on. */
export function importDetails(report: ImportReport): string[] {
  const lines: string[] = [];

  if (report.overwritten.entries > 0) {
    lines.push(`${report.overwritten.entries} sets were updated from the file (the file's copy was newer).`);
  }
  if (report.skipped.entries > 0) {
    lines.push(`${report.skipped.entries} sets were already here and left alone.`);
  }
  if (report.resequenced > 0) {
    lines.push(
      `${report.resequenced} sets were re-numbered so undo still points at the latest set.`,
    );
  }
  if (report.removed.entries > 0) {
    lines.push(`${report.removed.entries} sets that were only on this phone were removed.`);
  }

  return lines;
}

/** Triggers a file download without leaving the page. */
export function downloadJson(filename: string, text: string): void {
  const blob = new Blob([text], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Revoke on the next tick: revoking synchronously can cancel the download in
  // some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
