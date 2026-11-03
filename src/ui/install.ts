/**
 * Install prompt capture (issue #18).
 *
 * Chrome fires `beforeinstallprompt` once, and only if the app is installable.
 * If nothing captures it, the event is gone and the user has to find the browser
 * menu themselves — which most people never do, so an installable app goes
 * uninstalled.
 *
 * The event is held and replayed on an explicit "Install" tap. It can only be
 * used **once**: after `prompt()` it is spent, so the stored reference is dropped
 * whether the user accepted or dismissed, and the control disappears.
 *
 * Kept separate from Preact so the state machine is testable without a DOM
 * framework: `captureInstallPrompt(event)` in, `promptInstall()` out.
 */

/** The slice of `BeforeInstallPromptEvent` this module uses. */
export interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export type InstallState = "unavailable" | "available" | "installing" | "installed" | "dismissed";

type Listener = (state: InstallState) => void;

let deferred: InstallPromptEvent | undefined;
let state: InstallState = "unavailable";
const listeners = new Set<Listener>();

function emit(next: InstallState): void {
  state = next;
  for (const listener of listeners) listener(next);
}

export function installState(): InstallState {
  return state;
}

export function onInstallStateChange(listener: Listener): () => void {
  listeners.add(listener);
  listener(state);
  return () => {
    listeners.delete(listener);
  };
}

/** Call from a `beforeinstallprompt` handler. Returns nothing to stop. */
export function captureInstallPrompt(event: InstallPromptEvent): void {
  event.preventDefault();
  deferred = event;
  emit("available");
}

/** True once the app is already running installed — then never offer it. */
export function markInstalled(): void {
  deferred = undefined;
  emit("installed");
}

/**
 * Replays the captured prompt. Resolves with the user's choice, or `undefined`
 * when there was nothing to replay (already installed, already spent, or a
 * browser that never fired the event).
 */
export async function promptInstall(): Promise<"accepted" | "dismissed" | undefined> {
  const event = deferred;
  if (event === undefined) return undefined;

  // The event is single-use: drop it *before* awaiting, so a double tap cannot
  // call `prompt()` twice and throw.
  deferred = undefined;
  emit("installing");

  try {
    await event.prompt();
    const { outcome } = await event.userChoice;
    // A dismissal is not a failure, but it does mean we should stop nagging.
    emit(outcome === "accepted" ? "installed" : "dismissed");
    return outcome;
  } catch {
    // Never leave the UI stuck on "installing".
    emit("unavailable");
    return undefined;
  }
}

/** For tests and for a full reset. */
export function resetInstallPrompt(): void {
  deferred = undefined;
  state = "unavailable";
  listeners.clear();
}
