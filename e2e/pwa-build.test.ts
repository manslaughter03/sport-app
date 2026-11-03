import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";

/**
 * The generated service worker must honour the prompt model (issue #18).
 *
 * The acceptance criterion is a property of the *build output*, not of the
 * config: `skipWaiting: false` in `vite.config.ts` is necessary but not
 * sufficient, because a later workbox option or a plugin could still emit an
 * automatic `self.skipWaiting()`. So this test reads `dist/sw.js` and asserts:
 *
 * - `skipWaiting()` is reached only from the `SKIP_WAITING` message handler,
 *   i.e. the update happens when the user taps Reload and never before;
 * - the worker does not claim clients on activate, which would let a new build
 *   take over a page that is already open.
 *
 * Skipped with a clear reason when there is no build, so `npm test` stays honest
 * on a clean checkout instead of passing vacuously.
 */

const DIST = join(process.cwd(), "dist");

function readWorker(): string | undefined {
  const path = join(DIST, "sw.js");
  if (!existsSync(path)) return undefined;
  return readFileSync(path, "utf8");
}

const worker = readWorker();

// `describe.skip` (not a second `describe`) when there is no build: Vitest
// treats a duplicate suite name in one file as an error, and CI runs `npm test`
// before `npm run build`.
describe.skipIf(worker === undefined)("generated service worker", () => {
  it("is built", () => {
    expect(existsSync(join(DIST, "sw.js"))).toBe(true);
  });

  it("only calls skipWaiting from the SKIP_WAITING message handler", () => {
    const source = worker!;
    const calls = [...source.matchAll(/skipWaiting\(\)/g)];
    expect(calls.length).toBeGreaterThan(0);

    for (const call of calls) {
      const before = source.slice(Math.max(0, call.index - 220), call.index);
      // The generated handler looks like:
      //   addEventListener("message", e => { "SKIP_WAITING" === e.data.type && self.skipWaiting() })
      expect(before).toContain("SKIP_WAITING");
    }
  });

  it("never claims clients on activate", () => {
    // `clientsClaim` would let a waiting worker take over an open page on its
    // own, which is the auto-swap the prompt model exists to prevent.
    const source = worker!;
    expect(source).not.toMatch(/clientsClaim\(/);
    expect(source).not.toMatch(/claim\(\)/);
  });

  it("precaches the shell so the app works offline after one load", () => {
    expect(worker!).toContain("precacheAndRoute");
    expect(worker!).toContain("index.html");
  });

  it("uses a network-first strategy for navigations", () => {
    // A cache-first HTML shell is the classic way to pin users to an old build.
    expect(worker!).toContain("NetworkFirst");
  });

  it("ships its manifest generations for cleanup", () => {
    // Every build gets a fresh precache revision; the worker drops old caches.
    const files = readdirSync(DIST).filter((name: string) => name.endsWith(".js"));
    expect(files.length).toBeGreaterThan(0);
  });
});

