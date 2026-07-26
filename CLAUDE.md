# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this service does

Tautulli's webhook template can only emit a **show's** external id for an episode ([Tautulli #2510](https://github.com/Tautulli/Tautulli/issues/2510)), so a raw Tautulli → seenr webhook checks users in on the wrong show. Plex's own webhooks carry correct episode ids but only fire for the server owner, not shared users.

This bridge keeps Tautulli as the event source (it sees every user's playback) and supplies the missing piece: it re-looks-up the item's **own** tmdb/tvdb/imdb ids via the Tautulli API by `rating_key`, rebuilds a Plex `media.scrobble` payload, and forwards it to the right user's seenr token. Matching is ID-based and title-independent.

```
Plex ──play──▶ Tautulli ──webhook {rating_key, username, action}──▶ Bridge
                                                                     │ get_metadata(rating_key) → real ids
                                                                     ▼
                                        POST payload=<plex media.scrobble> ──▶ seenr.app/.../<user token>
```

## Commands

There is **no linter** in this repo — `npm run typecheck` is the only static check, and Vitest is the only test runner.

```bash
npm install
npm run dev         # nuxt dev, single process, http://localhost:8687
npm run build        # nuxt build → .output/ (bundled Nitro server + static client)
npm run preview       # preview the .output/ build
npm start            # node .output/server/index.mjs — runs a prior build
npm test              # vitest run — tests/**/*.spec.ts, 38 tests across 4 files
npm run test:watch     # vitest, watch mode
npm run typecheck       # nuxt typecheck (app/ + server/ + shared/) && typecheck:tests (tests/ + vitest.config.ts)
npm run typecheck:tests  # vue-tsc -p tsconfig.test.json alone — tests/ isn't in nuxt's own generated tsconfig
```

Everything — UI and API — is one process on one port (`8687` in dev and prod). There is no separate client dev server and no proxy config to keep in sync.

## Architecture

This is a single Nuxt 4 application (SPA mode, no SSR — it's a login-gated LAN admin panel, so server rendering buys nothing and complicates auth state).

- **`app/`** — the Nuxt `srcDir`. Pages (`app/pages/`), layouts (`app/layouts/`), components (`app/components/`), and three Pinia stores (`app/stores/auth.ts`, `settings.ts`, `status.ts`). `app/middleware/auth.global.ts` is the client-side route guard — it redirects to `/login` when unauthenticated and away from `/login` once a session exists. `app/app.config.ts` carries the violet/slate Nuxt UI theme, forced dark.
- **`server/api/`** — Nitro request handlers, one file (or one file per HTTP method) per route, e.g. `server/api/settings/index.get.ts`, `server/api/webhook/tautulli.post.ts`. These use Nitro's ambient auto-imports (`defineEventHandler`, `createError`, `getQuery`, etc. are global, not imported) — that's the Nitro convention and is deliberate here. `server/api/[...].ts` is the catch-all for unmatched `/api/*` paths.
- **`server/utils/`** — the domain logic, framework-agnostic: `db.ts` (schema, migrations, all queries, the `*ToWire()` boundary), `auth.ts` (password hashing, session cookies, the public-path allowlist), `tautulli.ts` (the Tautulli API client — `get_metadata`, `get_notifiers`/`add_notifier_config`/`set_notifier_config`, `get_users`, image proxying), `scrobble.ts` (maps a Tautulli action to a Plex event name and shapes the `media.scrobble` payload), `seenr.ts` (posts the payload to a user's seenr token), `pipeline.ts` (`processEvent()` — the one function that does the real work: settings check → mapping lookup → Tautulli metadata → build payload → per-mapping media-type gate → forward → record event row).
- **`server/middleware/auth.ts`** — the Nitro request middleware. Thin by design: it just calls `requiresAuth()` and `currentUser()` from `server/utils/auth.ts`.
- **`shared/types/index.ts`** — the wire contract (`Settings`, `Mapping`, `ScrobbleEvent`, `Stats`, `Status`, `AuthStatus`, etc.), imported by both `app/` and `server/`. Booleans here are real `boolean`s — the `0`/`1` SQLite representation never crosses this boundary directly.
- **`shared/version.ts`** — the single source of truth for the app version.
- **`tests/`** — `db.spec.ts`, `scrobble.spec.ts`, `pipeline.spec.ts`, `auth.spec.ts` (four files). Plain Vitest, not Nuxt's test utils — see the import rule below.

## Conventions that still bite you

- **`server/utils/*` must use explicit relative imports, never Nitro auto-imports.** `server/api/*` and `server/middleware/*` deliberately DO use auto-imports (normal Nitro style) — but plain Vitest has no idea those globals exist, and all four spec files import `server/utils` modules directly. Mixing the two styles inside `server/utils/` breaks the test suite's ability to resolve them. This asymmetry (auto-imports in `api`/`middleware`, explicit imports in `utils`) is intentional, not an oversight.
- **Name collisions with h3 auto-imports are a real hazard.** h3 injects its own `getSession`, `clearSession`, and friends into every Nitro module. Two functions were renamed here specifically to avoid silently shadowing them: the database session lookup is `getSessionByToken` (not `getSession`), and the cookie helpers are `setSessionCookie`/`clearSessionCookie` (not `setSession`/`clearSession`). Before adding a new `server/utils` export, check it doesn't collide with an h3/Nitro auto-import — `npm run typecheck` surfaces such collisions as `WARN Duplicated imports`.
- **`useDb()` caches its handle on `globalThis`**, not a module-level variable, because Nitro re-evaluates modules on HMR — a module-level cache would silently reopen the SQLite file (and re-run migrations) on every dev reload. `closeDb()` clears that cache; it exists for tests, to release WAL locks and force a fresh `DATA_DIR` read between spec files.
- **`requiresAuth(path: string): boolean` in `server/utils/auth.ts`** holds the gate's actual decision logic; `server/middleware/auth.ts` just calls it. This split exists so the gate is unit-testable without constructing an `H3Event`. Its early return for non-`/api/` paths is essential: Nitro middleware runs on *every* request (pages, assets, everything), unlike the legacy Express router which only ever saw `/api` — removing that early return would 401 the entire UI, while every API test would still pass, so the failure mode is invisible from the test suite alone.
- **Adding a public endpoint means adding it to `PUBLIC_API_PATHS`** in `server/utils/auth.ts`; adding an authed one requires nothing.
- **`shared/types` is the wire shape** (real `boolean`s); the SQLite `0`/`1` representation stays behind `settingsToWire`/`mappingToWire`/`eventToWire` in `server/utils/db.ts`. A new boolean column needs the `!!` conversion added there, not scattered elsewhere.
- **Unmatched `/api/*` paths must 404 via `server/api/[...].ts`.** Without it, Nuxt in SPA mode falls through and serves the HTML shell with a 200 for a typo'd endpoint, and the calling `$fetch` then fails with an opaque JSON-parse error instead of a clean 404.
- **The webhook replies `202` before processing.** `processEvent()` runs detached (via `event.waitUntil`) with a swallowed `.catch()`, so failures surface only as rows in the `events` table (visible on the Dashboard) — never as an HTTP error to Tautulli. Debug forwarding problems through `/api/events`, not response codes.
- **`settings.sync_movies` / `settings.sync_episodes` are vestigial.** They're persisted and served by the settings API but the pipeline gates only on the **per-mapping** `mapping.sync_movies` / `mapping.sync_episodes`. Edit the mapping-level flags when changing sync behaviour.
- **`shared/version.ts` is the single source of truth for the version** (served at `/api/version`, shown in sidebar + login). Bump it on release, along with the README badge.
- **`/api/image` must keep its `/library/metadata/` prefix check.** It proxies Plex poster art via Tautulli so the API key stays server-side; without that check the endpoint becomes an open proxy authenticated with the user's Tautulli API key.
- **`syncSeenrWebhook` is authoritative on re-sync**: it writes `on_<action> = 0` for every unselected trigger, so a sync always fully replaces the notifier's trigger set. It finds its notifier by the literal friendly name `Seenr Bridge`.
- **Events are capped at 1000 rows**, trimmed by a DELETE on every insert in `insertEvent`.
- Username matching for mappings is `COLLATE NOCASE`, as is user login lookup.
- **Migrations are append-only `PRAGMA table_info` guards** at the bottom of `db.ts`. To add a column: extend the `CREATE TABLE`, add a matching `if (!cols.includes(...)) ALTER TABLE`, then thread it through the row interface, `getSettings`'s explicit column list, and `saveSettings`'s UPDATE.

## Deployment

`Dockerfile` is a two-stage build: `build` (installs deps with `npm ci`, forces a from-source rebuild of `better-sqlite3` — its published `linux-arm64` prebuild links against a newer glibc than `node:22-bookworm-slim` ships and fails to `dlopen` on arm64 hosts — then runs `npm run build`) and a slim runtime stage that copies only `.output/` (the bundled Nitro server, the static client, and the externalised `better-sqlite3` with its native binding). Defaults: `PORT=8687`, `DATA_DIR=/app/data`. There is no `PUBLIC_DIR` — Nitro serves the client itself. Pushes to `main` and `v*` tags publish to `ghcr.io/isntw/seenr-bridge` via `.github/workflows/docker-publish.yml`. All state is the single SQLite file at `$DATA_DIR/seenr-bridge.db`.
