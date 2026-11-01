/**
 * Service worker registration and update prompt (docs/architecture.md §5.4).
 *
 * `registerType: "prompt"` means a new version is *offered*, never imposed.
 * Auto-`skipWaiting` can swap the worker while someone is mid-entry, so the
 * user taps "Reload" when it suits them.
 *
 * This module is deliberately tiny and defensive: a registration failure must
 * never stop the app from working online.
 */

import { registerSW } from "virtual:pwa-register";

export interface UpdateHandle {
  /** Ask the waiting worker to take over and reload. */
  apply(): void;
}

type Listener = (available: boolean) => void;

let listener: Listener | undefined;
let applyUpdate: (() => void) | undefined;

export function onUpdateAvailable(callback: Listener): void {
  listener = callback;
}

export function applyPendingUpdate(): void {
  applyUpdate?.();
}

/** Registers the service worker. Safe to call once, at startup. */
export function registerServiceWorker(): void {
  if (!("serviceWorker" in navigator)) return;

  try {
    applyUpdate = registerSW({
      immediate: true,
      onNeedRefresh() {
        listener?.(true);
      },
      onOfflineReady() {
        listener?.(false);
      },
      onRegisteredSW(_url, registration) {
        // Poll occasionally so a long-lived installed app notices a new build.
        if (registration === undefined) return;
        setInterval(() => {
          void registration.update();
        }, 60 * 60 * 1000);
      },
      onRegisterError(error: unknown) {
        // Offline support is a bonus; never let it break the app.
        console.warn("Service worker registration failed", error);
      },
    });
  } catch (error) {
    console.warn("Service worker registration threw", error);
  }
}
