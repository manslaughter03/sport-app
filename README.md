# Sport App

A local-first, offline-capable web app to track exercise volume against weekly and monthly goals.
Target device: a phone, installed to the home screen. **No backend, no account — data never leaves
the device.**

> **Status: scaffold (S1).** No logging yet. See [`docs/v0-plan.md`](./docs/v0-plan.md) for what
> ships in v0 and [`docs/architecture.md`](./docs/architecture.md) for the design.

## Why volume, not streaks

Rest days are a feature, not a failure. A day with zero push-ups is not a missed goal; a *week*
under target is. So progress is measured as volume per period, plus one global "active days per
week" habit target.

## Requirements

- Node 26 LTS (see `.nvmrc`)
- npm

## Getting started

```bash
npm ci
npm run dev
```

Open the printed URL. For phone testing over the LAN, see below.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Vite dev server |
| `npm run dev:lan` | Vite over HTTPS on the LAN (needed for service worker / install) |
| `npm run build` | Type-check, then production build to `dist/` |
| `npm run preview` | Serve the production build locally |
| `npm run typecheck` | `tsc -b --noEmit` |
| `npm run lint` | ESLint, including the domain boundary rules |
| `npm test` | Vitest (unit + integration) |
| `npm run test:coverage` | Vitest with V8 coverage |

## Testing on the phone

Service workers and "Add to Home screen" require a **secure context**. `localhost` is exempt; a
plain-HTTP LAN IP is **not**. So:

```bash
npm run dev:lan   # https://<your-lan-ip>:5173 — accept the self-signed cert once
```

Note that this dev origin has its own IndexedDB, separate from the deployed origin. Use LAN
serving to iterate on UI; do real logging on the deployed URL.

## Architecture in one paragraph

`src/domain/` is pure TypeScript — no database, no DOM, no clock, no network — and holds all the
tricky logic (day boundaries, week starts, goal versioning, percentages). `src/data/` owns Dexie
and IndexedDB. `src/ui/` is Preact. The boundary is enforced by ESLint, not by discipline, which
is what keeps the domain testable in milliseconds with plain fixtures.

## License

Private project, no license granted.
