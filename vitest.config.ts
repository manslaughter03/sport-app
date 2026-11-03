import { defineConfig } from "vitest/config";
import preact from "@preact/preset-vite";

export default defineConfig({
  plugins: [preact()],
  test: {
    globals: false,
    environment: "node",
    // `e2e/pwa-build.test.ts` is a unit test that reads the *build output*
    // (dist/sw.js), which needs Node types the app project deliberately does
    // not include. It lives beside the Playwright specs but runs under Vitest;
    // the `*.spec.ts` glob there keeps it out of Playwright's way.
    include: ["src/**/*.{test,spec}.{ts,tsx}", "e2e/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["src/**/*.{test,spec}.{ts,tsx}", "src/main.tsx"],
    },
  },
});
