# AGENTS.md — sport-app

Project-level instructions. **This file overrides `~/AGENTS.md`**, which is a generic template
that names a `v1` branch and Go commands — both wrong here. Trunk is `main`.

Local-first PWA for tracking exercise volume. No backend, no accounts, no network calls, ever.

## Commands

```bash
npm ci                  # install (Node 26 LTS — see .nvmrc)
npm run dev             # dev server
npm run dev:lan         # HTTPS on the LAN, so the service worker works on the phone
npm run typecheck       # tsc -b --noEmit
npm run lint            # eslint (includes the domain boundary rules)
npm test                # vitest run
npm run build           # tsc -b && vite build
```

Run `npm run typecheck && npm run lint && npm test && npm run build` before opening a PR.
CI runs the same four and is required on `main`.

## Layers — and the rules that are enforced, not suggested

```
src/domain/   pure TS. no DB, no DOM, no clock, no network.
src/data/     Dexie schema, repos, backup/export.
src/ui/       screens, components, liveQuery wiring.
```

Two invariants are enforced by ESLint (`eslint.config.js`) and a PR that breaks them cannot merge:

1. **`domain/` imports nothing from `data/` or `ui/`** — and no framework/storage libraries.
2. **`domain/` never reads the wall clock** — no `new Date()`, no `Date.now()`,
   no `performance.now()`. Time is always a parameter (`now` / `today`).

Beyond lint:

3. **`day` is computed once, on write, from injected settings** — never derived from a UTC
   instant. This is the #1 correctness risk (evening sessions west of UTC).
4. **No network requests.** Local-first is the product, not a preference.
5. **Nothing from the "NOT in v0" list** in [`docs/v0-plan.md`](./docs/v0-plan.md) §1.

## Conventions

- **Trunk:** `main`, protected — PR only, never commit directly.
- **Branches:** `feature/<name>`, `fix/<name>`, `docs/<name>`.
- **Commits:** Conventional Commits (`feat:`, `fix:`, `docs:`, `refactor:`, `chore:`, `test:`).
- **Staging:** explicit paths. Never `git add -A` / `git add -f`.
- **Secrets:** the repo is public. No tokens, keys, or `.env` files — ever. `.gitignore` covers
  the usual shapes, but do not rely on it as the only guard.

## Where things are decided

- [`docs/architecture.md`](./docs/architecture.md) — data model, layers, storage, PWA, testing.
- [`docs/v0-plan.md`](./docs/v0-plan.md) — what ships in v0, slice by slice, and what does not.

When a slice changes a command, update this file in the same PR.
