/**
 * Storage persistence (issue #18, architecture §5.3).
 *
 * `navigator.storage.persist()` asks the browser to exempt this origin from
 * eviction. The result used to be discarded, which meant the app could not tell
 * a user whether their data was actually protected — and a user deciding whether
 * to trust the app deserves a truthful answer, not an optimistic one.
 *
 * Three states, and the difference matters:
 *
 * - `persisted`   — the browser promised not to evict under storage pressure.
 * - `best-effort` — the data can be evicted at any time. Export is the only
 *                   insurance, so the UI has to say so.
 * - `unavailable` — the API does not exist (older Safari, private mode). We do
 *                   not know, and saying "protected" would be a lie.
 *
 * Everything here takes its browser object as a parameter, so it can be tested
 * without a real `navigator.storage`.
 */

export type PersistenceState = "persisted" | "best-effort" | "unavailable";

export interface PersistenceReport {
  readonly state: PersistenceState;
  /** One sentence a user can act on. Never optimistic about an unknown. */
  readonly message: string;
}

/** The slice of `StorageManager` this module needs. */
export interface StorageLike {
  persist?(): Promise<boolean>;
  persisted?(): Promise<boolean>;
  estimate?(): Promise<{ usage?: number | undefined; quota?: number | undefined }>;
}

/** Asks the browser to persist, and reports what it actually promised. */
export async function requestPersistence(storage: StorageLike | undefined): Promise<PersistenceState> {
  if (storage === undefined || typeof storage.persist !== "function") {
    return "unavailable";
  }
  try {
    // The return value is the browser's answer *now*; `persisted()` is the
    // durable statement. Prefer the latter when it exists, because a grant can
    // be revoked and a refusal can later become a grant.
    const granted = await storage.persist();
    if (typeof storage.persisted === "function") {
      const persisted = await storage.persisted();
      return persisted ? "persisted" : "best-effort";
    }
    return granted ? "persisted" : "best-effort";
  } catch {
    // An exception means we do not know, which is not the same as "no".
    return "unavailable";
  }
}

/** Re-reads the current state without asking the browser to change anything. */
export async function readPersistence(storage: StorageLike | undefined): Promise<PersistenceState> {
  if (storage === undefined || typeof storage.persisted !== "function") {
    return "unavailable";
  }
  try {
    return (await storage.persisted()) ? "persisted" : "best-effort";
  } catch {
    return "unavailable";
  }
}

export function describePersistence(state: PersistenceState): PersistenceReport {
  switch (state) {
    case "persisted":
      return {
        state,
        message:
          "Protected from eviction. The browser has promised not to clear this data to free space.",
      };
    case "best-effort":
      return {
        state,
        // The honest sentence: Android *will* evict this under pressure, which
        // is precisely why the export exists.
        message:
          "Not protected. The browser may clear this data if the phone runs low on space — export a backup you can restore from.",
      };
    case "unavailable":
      return {
        state,
        message:
          "This browser cannot report whether storage is protected. Treat the data as best effort and keep an export.",
      };
  }
}

/**
 * Usage against quota, as a percentage, or `undefined` when the browser will not
 * say. Rounded to a whole number: "3 % of 12 GB" is all anyone needs.
 */
export async function storageUsage(
  storage: StorageLike | undefined,
): Promise<{ usedBytes: number; quotaBytes: number; pct: number } | undefined> {
  if (storage === undefined || typeof storage.estimate !== "function") return undefined;
  try {
    const estimate = await storage.estimate();
    const used = estimate.usage;
    const quota = estimate.quota;
    if (used === undefined || quota === undefined || quota <= 0) return undefined;
    return { usedBytes: used, quotaBytes: quota, pct: Math.round((used / quota) * 100) };
  } catch {
    return undefined;
  }
}
