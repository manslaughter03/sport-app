import type { AppContext } from "./app.ts";
import { Today } from "./screens/Today.tsx";

export interface AppProps {
  ctx: AppContext;
}

export function App({ ctx }: AppProps) {
  return (
    <main class="app">
      <Today ctx={ctx} />
    </main>
  );
}
