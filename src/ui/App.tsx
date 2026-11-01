/**
 * App shell: two screens and a bottom nav.
 *
 * Deliberately not a router — v0 has two destinations, and a signal is enough.
 * A router would be another dependency to justify (and another thing to break
 * on a GitHub Pages subpath).
 */

import { useState } from "preact/hooks";
import type { AppContext } from "./app.ts";
import { Today } from "./screens/Today.tsx";
import { Progress } from "./screens/Progress.tsx";

export interface AppProps {
  ctx: AppContext;
}

type Screen = "today" | "progress";

export function App({ ctx }: AppProps) {
  const [screen, setScreen] = useState<Screen>("today");

  return (
    <main class="app">
      {screen === "today" ? <Today ctx={ctx} /> : <Progress ctx={ctx} />}

      <nav class="nav" aria-label="Main">
        <button
          type="button"
          class="nav__item"
          aria-current={screen === "today" ? "page" : undefined}
          onClick={() => setScreen("today")}
        >
          Today
        </button>
        <button
          type="button"
          class="nav__item"
          aria-current={screen === "progress" ? "page" : undefined}
          onClick={() => setScreen("progress")}
        >
          Progress
        </button>
      </nav>
    </main>
  );
}
