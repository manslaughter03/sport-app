/**
 * Browser entry point: builds the real context (real IndexedDB, real clock)
 * and hands it to the app. Tests build the same context with a fixed clock and
 * an isolated database, so nothing here is special-cased for production.
 */

import { render } from "preact";
import { App } from "./ui/App.tsx";
import { createApp } from "./ui/app.ts";
import { createDatabase } from "./data/db.ts";
import { systemClock } from "./data/clock.ts";
import { createExercisesRepo } from "./data/repos/exercises.ts";
import { createEntriesRepo } from "./data/repos/entries.ts";
import { createGoalsRepo } from "./data/repos/goals.ts";
import { createSettingsRepo } from "./data/repos/settings.ts";
import { seedIfEmpty } from "./data/seed.ts";
import { registerServiceWorker } from "./sw.ts";
import "./ui/styles.css";

const db = createDatabase();
const clock = systemClock();
const settings = createSettingsRepo(db);
const exercises = createExercisesRepo(db, clock);
const entries = createEntriesRepo(db, clock, settings);
const goals = createGoalsRepo(db, clock);

const ctx = createApp({ db, clock, settings, exercises, entries, goals });

const root = document.getElementById("app");
if (!root) throw new Error("#app mount point missing from index.html");

async function start(): Promise<void> {
  // First run only: idempotent, never overwrites edits.
  await seedIfEmpty(db, clock);

  // Best effort against Android evicting site data (architecture §5.3).
  if (navigator.storage?.persist) {
    try {
      await navigator.storage.persist();
    } catch {
      // Persistence is a nice-to-have; never block startup on it.
    }
  }

  render(<App ctx={ctx} />, root!);
  registerServiceWorker();
}

void start();
