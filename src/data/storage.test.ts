import { describe, expect, it } from "vitest";
import {
  describePersistence,
  readPersistence,
  requestPersistence,
  storageUsage,
  type StorageLike,
} from "./storage.ts";

function fakeStorage(over: Partial<StorageLike>): StorageLike {
  return over;
}

describe("requestPersistence", () => {
  it("reports persisted when the browser granted and still reports persisted", async () => {
    const storage = fakeStorage({
      persist: async () => true,
      persisted: async () => true,
    });
    expect(await requestPersistence(storage)).toBe("persisted");
  });

  it("reports best-effort when the request was refused", async () => {
    const storage = fakeStorage({
      persist: async () => false,
      persisted: async () => false,
    });
    expect(await requestPersistence(storage)).toBe("best-effort");
  });

  it("does not trust a grant that `persisted()` contradicts", async () => {
    // A grant can be revoked; the durable statement is what counts.
    const storage = fakeStorage({
      persist: async () => true,
      persisted: async () => false,
    });
    expect(await requestPersistence(storage)).toBe("best-effort");
  });

  it("falls back to the grant when `persisted()` is missing", async () => {
    expect(await requestPersistence(fakeStorage({ persist: async () => true }))).toBe("persisted");
    expect(await requestPersistence(fakeStorage({ persist: async () => false }))).toBe("best-effort");
  });

  it("reports unavailable when the API does not exist", async () => {
    expect(await requestPersistence(undefined)).toBe("unavailable");
    expect(await requestPersistence(fakeStorage({}))).toBe("unavailable");
  });

  it("reports unavailable rather than a guess when the call throws", async () => {
    const storage = fakeStorage({
      persist: async () => {
        throw new Error("SecurityError");
      },
    });
    // "We do not know" is not "no": claiming best-effort here would be a guess.
    expect(await requestPersistence(storage)).toBe("unavailable");
  });
});

describe("readPersistence", () => {
  it("reads without asking the browser to change anything", async () => {
    let called = false;
    const storage = fakeStorage({
      persist: async () => {
        called = true;
        return true;
      },
      persisted: async () => true,
    });

    expect(await readPersistence(storage)).toBe("persisted");
    expect(called).toBe(false);
  });

  it("is unavailable without `persisted()`", async () => {
    expect(await readPersistence(fakeStorage({}))).toBe("unavailable");
  });
});

describe("describePersistence", () => {
  it("never claims protection it does not have", () => {
    expect(describePersistence("persisted").message).toMatch(/protected from eviction/i);
    expect(describePersistence("best-effort").message).toMatch(/not protected/i);
    expect(describePersistence("unavailable").message).toMatch(/cannot report/i);
  });

  it("says platform eviction out loud and points at the export", () => {
    // This is the sentence that makes the export button meaningful.
    const message = describePersistence("best-effort").message;
    expect(message).toMatch(/clear this data/i);
    expect(message).toMatch(/export/i);
  });

  it("carries the state through unchanged", () => {
    for (const state of ["persisted", "best-effort", "unavailable"] as const) {
      expect(describePersistence(state).state).toBe(state);
    }
  });
});

describe("storageUsage", () => {
  it("rounds to a whole percentage", async () => {
    const usage = await storageUsage(
      fakeStorage({ estimate: async () => ({ usage: 30_000_000, quota: 1_000_000_000 }) }),
    );
    expect(usage?.pct).toBe(3);
    expect(usage?.usedBytes).toBe(30_000_000);
  });

  it("is undefined when the browser will not say", async () => {
    expect(await storageUsage(undefined)).toBeUndefined();
    expect(await storageUsage(fakeStorage({}))).toBeUndefined();
    expect(await storageUsage(fakeStorage({ estimate: async () => ({}) }))).toBeUndefined();
  });

  it("is undefined rather than Infinity for a zero quota", async () => {
    expect(
      await storageUsage(fakeStorage({ estimate: async () => ({ usage: 10, quota: 0 }) })),
    ).toBeUndefined();
  });

  it("survives an estimate that throws", async () => {
    expect(
      await storageUsage(
        fakeStorage({
          estimate: async () => {
            throw new Error("nope");
          },
        }),
      ),
    ).toBeUndefined();
  });
});
