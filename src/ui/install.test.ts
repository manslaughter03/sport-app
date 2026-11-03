import { afterEach, describe, expect, it, vi } from "vitest";
import {
  captureInstallPrompt,
  installState,
  markInstalled,
  onInstallStateChange,
  promptInstall,
  resetInstallPrompt,
  type InstallPromptEvent,
  type InstallState,
} from "./install.ts";

function fakeEvent(outcome: "accepted" | "dismissed" = "accepted") {
  const prompt = vi.fn(async () => undefined);
  const event = {
    preventDefault: vi.fn(),
    prompt,
    userChoice: Promise.resolve({ outcome }),
  } as unknown as InstallPromptEvent;
  return { event, prompt };
}

afterEach(() => {
  resetInstallPrompt();
});

describe("install prompt capture", () => {
  it("is unavailable until the browser fires the event", () => {
    expect(installState()).toBe("unavailable");
  });

  it("captures the event and suppresses the browser's own banner", () => {
    const { event } = fakeEvent();
    captureInstallPrompt(event);

    expect(installState()).toBe("available");
    // Without preventDefault the browser shows its own prompt and the captured
    // event is wasted.
    expect(event.preventDefault).toHaveBeenCalled();
  });

  it("replays the prompt on demand and reports the choice", async () => {
    const { event, prompt } = fakeEvent("accepted");
    captureInstallPrompt(event);

    expect(await promptInstall()).toBe("accepted");
    expect(prompt).toHaveBeenCalledTimes(1);
    expect(installState()).toBe("installed");
  });

  it("treats a dismissal as dismissed, not as an error", async () => {
    const { event } = fakeEvent("dismissed");
    captureInstallPrompt(event);
    expect(await promptInstall()).toBe("dismissed");
    expect(installState()).toBe("dismissed");
  });

  it("spends the event: a second call cannot prompt again", async () => {
    const { event, prompt } = fakeEvent();
    captureInstallPrompt(event);

    await promptInstall();
    expect(await promptInstall()).toBeUndefined();
    // Calling prompt() twice throws in Chrome; the guard is the point.
    expect(prompt).toHaveBeenCalledTimes(1);
  });

  it("does nothing when no event was ever captured", async () => {
    expect(await promptInstall()).toBeUndefined();
    expect(installState()).toBe("unavailable");
  });

  it("survives a prompt that throws, without sticking on installing", async () => {
    const event = {
      preventDefault: vi.fn(),
      prompt: async () => {
        throw new Error("not allowed");
      },
      userChoice: Promise.resolve({ outcome: "dismissed" as const }),
    } as unknown as InstallPromptEvent;
    captureInstallPrompt(event);

    expect(await promptInstall()).toBeUndefined();
    expect(installState()).toBe("unavailable");
  });

  it("never offers install once the app is running installed", async () => {
    const { event } = fakeEvent();
    captureInstallPrompt(event);
    markInstalled();

    expect(installState()).toBe("installed");
    expect(await promptInstall()).toBeUndefined();
  });
});

describe("install state listeners", () => {
  it("notifies on capture and on the outcome", async () => {
    const seen: InstallState[] = [];
    onInstallStateChange((state) => seen.push(state));

    const { event } = fakeEvent("accepted");
    captureInstallPrompt(event);
    await promptInstall();

    expect(seen).toEqual(["unavailable", "available", "installing", "installed"]);
  });

  it("unsubscribes cleanly", () => {
    const seen: InstallState[] = [];
    const unsubscribe = onInstallStateChange((state) => seen.push(state));
    unsubscribe();

    captureInstallPrompt(fakeEvent().event);
    expect(seen).toEqual(["unavailable"]);
  });
});
