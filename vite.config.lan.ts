import { defineConfig } from "vite";
import preact from "@preact/preset-vite";
import basicSsl from "@vitejs/plugin-basic-ssl";

// LAN serving needs a secure context for the service worker: a plain-HTTP LAN IP
// is NOT exempt the way localhost is. See docs/architecture.md §6.
export default defineConfig({
  base: "/sport-app/",
  plugins: [preact(), basicSsl()],
  server: { host: true },
  preview: { host: true },
  build: {
    target: "es2022",
    sourcemap: true,
  },
});
