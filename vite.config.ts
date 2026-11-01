import { defineConfig } from "vite";
import preact from "@preact/preset-vite";
import { VitePWA } from "vite-plugin-pwa";

// GitHub Pages serves this repo under a subpath. Getting `base` wrong breaks
// asset URLs and the installed PWA's scope — see docs/architecture.md §8.
export default defineConfig({
  base: "/sport-app/",
  plugins: [
    preact(),
    VitePWA({
      // Never auto-skipWaiting: swapping the service worker mid-entry can drop
      // what the user is doing. A new version is offered, not imposed (§5.4).
      registerType: "prompt",
      injectRegister: null,
      includeAssets: ["icons/apple-touch-icon.png"],
      manifest: {
        name: "Sport",
        short_name: "Sport",
        description: "Track exercise volume against weekly targets. Local-first, works offline.",
        // Relative-aware for the Pages subpath, or the installed app breaks (§8).
        start_url: "/sport-app/",
        scope: "/sport-app/",
        display: "standalone",
        orientation: "portrait",
        background_color: "#0f172a",
        theme_color: "#0f172a",
        icons: [
          { src: "icons/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icons/icon-512.png", sizes: "512x512", type: "image/png" },
          {
            src: "icons/icon-maskable-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,png,svg,woff2}"],
        // The app is offline-first, so every asset is precached. index.html is
        // served network-first below: a stale-first HTML shell is the classic
        // way to pin users to an old build forever (§5.4).
        navigateFallback: "/sport-app/index.html",
        cleanupOutdatedCaches: true,
        clientsClaim: false,
        skipWaiting: false,
        runtimeCaching: [
          {
            urlPattern: ({ request }) => request.mode === "navigate",
            handler: "NetworkFirst",
            options: {
              cacheName: "html-navigations",
              networkTimeoutSeconds: 3,
              expiration: { maxEntries: 8 },
            },
          },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
  build: {
    target: "es2022",
    sourcemap: true,
  },
});
