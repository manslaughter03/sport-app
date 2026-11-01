import { defineConfig } from "vite";
import preact from "@preact/preset-vite";

// GitHub Pages serves this repo under a subpath. Getting `base` wrong breaks
// asset URLs and the installed PWA's scope — see docs/architecture.md §8.
export default defineConfig({
  base: "/sport-app/",
  plugins: [preact()],
  build: {
    target: "es2022",
    sourcemap: true,
  },
});
