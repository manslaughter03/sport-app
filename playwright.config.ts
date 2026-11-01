import { defineConfig, devices } from "@playwright/test";

/**
 * E2E is a smoke test, not the safety net (docs/architecture.md §7). The domain
 * layer holds ~80 % of the risk and gets ~80 % of the tests; this proves the
 * built app works in a real browser, including the service worker.
 *
 * Runs against `vite preview` so the base path, the manifest and the service
 * worker are the production ones — not the dev server's.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: !!process.env["CI"],
  retries: process.env["CI"] ? 1 : 0,
  workers: 1,
  reporter: process.env["CI"] ? [["list"], ["html", { open: "never" }]] : "list",
  timeout: 30_000,
  use: {
    baseURL: "http://127.0.0.1:4173/sport-app/",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Pixel 7"] } }],
  webServer: {
    // `--host 127.0.0.1` is not optional: `vite preview` otherwise binds to
    // `localhost`, which can resolve to ::1 only, while Playwright polls the
    // IPv4 address below. That mismatch shows up as a webServer timeout in CI
    // and nowhere else.
    command: "npm run build && npm run preview -- --host 127.0.0.1 --port 4173 --strictPort",
    url: "http://127.0.0.1:4173/sport-app/",
    reuseExistingServer: !process.env["CI"],
    timeout: 120_000,
  },
});
