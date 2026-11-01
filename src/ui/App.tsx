/**
 * App shell: two screens and a bottom nav.
 *
 * Deliberately not a router — v0 has two destinations, and a signal is enough.
 * A router would be another dependency to justify (and another thing to break
 * on a GitHub Pages subpath).
 */

import { useEffect, useState } from "preact/hooks";
import type { AppContext } from "./app.ts";
import { Today } from "./screens/Today.tsx";
import { Progress } from "./screens/Progress.tsx";
import { Targets } from "./screens/Targets.tsx";
import { Backup } from "./screens/Backup.tsx";
import { applyPendingUpdate, onUpdateAvailable } from "../sw.ts";

export interface AppProps {
  ctx: AppContext;
}

type Screen = "today" | "progress" | "targets" | "backup";

export function App({ ctx }: AppProps) {
  const [screen, setScreen] = useState<Screen>("today");
  const [updateReady, setUpdateReady] = useState(false);

  useEffect(() => {
    onUpdateAvailable(setUpdateReady);
  }, []);

  return (
    <main class="app">
      {screen === "today" ? <Today ctx={ctx} /> : null}
      {screen === "progress" ? <Progress ctx={ctx} /> : null}
      {screen === "targets" ? <Targets ctx={ctx} /> : null}
      {screen === "backup" ? <Backup ctx={ctx} /> : null}

      {updateReady ? (
        <div class="toast" role="status" data-testid="update-toast">
          <span>Update ready</span>
          <button type="button" class="btn btn--add" onClick={() => applyPendingUpdate()}>
            Reload
          </button>
        </div>
      ) : null}

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
        <button
          type="button"
          class="nav__item"
          aria-current={screen === "targets" ? "page" : undefined}
          onClick={() => setScreen("targets")}
        >
          Targets
        </button>
        <button
          type="button"
          class="nav__item"
          aria-current={screen === "backup" ? "page" : undefined}
          onClick={() => setScreen("backup")}
        >
          Backup
        </button>
      </nav>
    </main>
  );
}
