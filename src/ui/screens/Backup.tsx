/**
 * Backup screen (S9).
 *
 * Export is the only recovery path if Android clears site data, so this is in
 * v0 and not "later" (docs/architecture.md §5.3). It is deliberately boring:
 * one button, one honest sentence about what the file contains.
 */

import { useCallback, useState } from "preact/hooks";
import type { AppContext } from "../app.ts";
import { useLiveQuery } from "../live.ts";
import {
  backupFilename,
  buildBackup,
  needsBackupNudge,
  serializeBackup,
  stampExport,
} from "../../data/backup.ts";

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
    </section>
  );
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
