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
npm test              # vitest run — tests/**/*.spec.ts, 90 tests across 6 files
npm run test:watch     # vitest, watch mode
npm run typecheck       # nuxt typecheck (app/ + server/ + shared/) && typecheck:tests (tests/ + vitest.config.ts)
npm run typecheck:tests  # vue-tsc -p tsconfig.test.json alone — tests/ isn't in nuxt's own generated tsconfig
```

Everything — UI and API — is one process on one port (`8687` in dev and prod). There is no separate client dev server and no proxy config to keep in sync.

## Architecture

This is a single Nuxt 4 application (SPA mode, no SSR — it's a login-gated LAN admin panel, so server rendering buys nothing and complicates auth state).

- **`app/`** — the Nuxt `srcDir`. Pages (`app/pages/`), layouts (`app/layouts/`), components (`app/components/`), and three Pinia stores (`app/stores/auth.ts`, `settings.ts`, `status.ts`). `app/middleware/auth.global.ts` is the client-side route guard — it redirects to `/login` when unauthenticated and away from `/login` once a session exists. `app/app.config.ts` carries the violet/slate Nuxt UI theme, forced dark.
- **`server/api/`** — Nitro request handlers, one file (or one file per HTTP method) per route, e.g. `server/api/settings/index.get.ts`, `server/api/webhook/tautulli.post.ts`. These use Nitro's ambient auto-imports (`defineEventHandler`, `createError`, `getQuery`, etc. are global, not imported) — that's the Nitro convention and is deliberate here. `server/api/[...].ts` is the catch-all for unmatched `/api/*` paths.
- **`server/utils/`** — the domain logic, framework-agnostic: `db.ts` (schema, migrations, all queries, the `*ToWire()` boundary), `auth.ts` (password hashing, session cookies, the public-path allowlist), `tautulli.ts` (the Tautulli API client — `get_metadata`, `get_notifiers`/`add_notifier_config`/`set_notifier_config`, `get_users`, `get_libraries`/`get_library_media_info`, `get_children_metadata` via `getChildren()` for the show → season → episode drill-down, `get_history`, image proxying), `scrobble.ts` (maps a Tautulli action to a Plex event name and shapes the `media.scrobble` payload), `seenr.ts` (posts the payload to a user's seenr token), `pipeline.ts` (`processEvent()` — the one function that does the real work: settings check → mapping lookup → Tautulli metadata → build payload → per-mapping media-type gate → forward → record event row).
- **`server/middleware/auth.ts`** — the Nitro request middleware. Thin by design: it just calls `requiresAuth()` and `currentUser()` from `server/utils/auth.ts`.
- **`shared/types/index.ts`** — the wire contract (`Settings`, `Mapping`, `ScrobbleEvent`, `Stats`, `Status`, `AuthStatus`, etc.), imported by both `app/` and `server/`. Booleans here are real `boolean`s — the `0`/`1` SQLite representation never crosses this boundary directly.
- **`shared/version.ts`** — the single source of truth for the app version.
- **`tests/`** — `db.spec.ts`, `scrobble.spec.ts`, `pipeline.spec.ts`, `auth.spec.ts`, `tautulli.spec.ts`, `event-group.spec.ts` (six files). Plain Vitest, not Nuxt's test utils — see the import rule below. `tautulli.spec.ts` is the only one that stubs `global.fetch` (via `vi.stubGlobal`); it covers `getChildren`'s parsing of Tautulli's `get_children_metadata` envelope and makes no network calls. `event-group.spec.ts` covers `app/utils/event-group.ts` — the only `app/` code under test, because it is a pure function and the fan-out grouping it does is easy to get subtly wrong.

## Conventions that still bite you

- **`server/utils/*` must use explicit relative imports, never Nitro auto-imports.** `server/api/*` and `server/middleware/*` deliberately DO use auto-imports (normal Nitro style) — but plain Vitest has no idea those globals exist, and the spec files import `server/utils` modules directly. Mixing the two styles inside `server/utils/` breaks the test suite's ability to resolve them. This asymmetry (auto-imports in `api`/`middleware`, explicit imports in `utils`) is intentional, not an oversight.
- **Name collisions with h3 auto-imports are a real hazard.** h3 injects its own `getSession`, `clearSession`, and friends into every Nitro module. Two functions were renamed here specifically to avoid silently shadowing them: the database session lookup is `getSessionByToken` (not `getSession`), and the cookie helpers are `setSessionCookie`/`clearSessionCookie` (not `setSession`/`clearSession`). Before adding a new `server/utils` export, check it doesn't collide with an h3/Nitro auto-import — `npm run typecheck` surfaces such collisions as `WARN Duplicated imports`.
- **`useDb()` caches its handle on `globalThis`**, not a module-level variable, because Nitro re-evaluates modules on HMR — a module-level cache would silently reopen the SQLite file (and re-run migrations) on every dev reload. `closeDb()` clears that cache; it exists for tests, to release WAL locks and force a fresh `DATA_DIR` read between spec files.
- **`requiresAuth(path: string): boolean` in `server/utils/auth.ts`** holds the gate's actual decision logic; `server/middleware/auth.ts` just calls it. This split exists so the gate is unit-testable without constructing an `H3Event`. Its early return for non-`/api/` paths is essential: Nitro middleware runs on *every* request (pages, assets, everything), unlike the legacy Express router which only ever saw `/api` — removing that early return would 401 the entire UI, while every API test would still pass, so the failure mode is invisible from the test suite alone.
- **Adding a public endpoint means adding it to `PUBLIC_API_PATHS`** in `server/utils/auth.ts`; adding an authed one requires nothing.
- **`/api/_nuxt_icon/<collection>.json` has to stay public**, and the way it is allowed matters. `@nuxt/icon` fetches collections from the server at runtime, so gating that path means *no icon renders on any page reachable without a session* — the login button's `:loading` spinner is one, and it fails invisibly. It is allowed by prefix plus a single-plain-segment regex, deliberately **not** a bare `startsWith`: Nitro decodes `%2e%2e` before routing, so `/api/_nuxt_icon/%2e%2e/settings` reaches the `/api/settings` handler while the middleware still sees the literal encoded path. A bare prefix match there would serve settings — Tautulli API key and seenr tokens included — to an unauthenticated caller. This is covered by tests in `tests/auth.spec.ts`.
- **`shared/types` is the wire shape** (real `boolean`s); the SQLite `0`/`1` representation stays behind `settingsToWire`/`mappingToWire`/`eventToWire` in `server/utils/db.ts`. A new boolean column needs the `!!` conversion added there, not scattered elsewhere.
- **Unmatched `/api/*` paths must 404 via `server/api/[...].ts`.** Without it, Nuxt in SPA mode falls through and serves the HTML shell with a 200 for a typo'd endpoint, and the calling `$fetch` then fails with an opaque JSON-parse error instead of a clean 404.
- **Adding a page means adding its route to `nitro.prerender.routes`, or that page ships blank.** With `ssr: false` Nitro is supposed to serve an SPA shell from a built-in template, but in Nuxt 4.5.0 that template compiles to an empty string (`.output/server/chunks/virtual/_virtual_spa-template.mjs` contains `const template = ""`). A route without a prerendered `index.html` therefore gets a bare shell — no entry script, no `<title>`, an empty `#__nuxt` div — so the bundle never loads and the page is blank. Prerendering each page emits a real `index.html` per route with the module script injected. This only affects **production builds**; `nuxt dev` is unaffected, which is what let it go unnoticed. Note that an HTTP check cannot catch it: the blank shell returns `200`. Verify a production build by grepping the served HTML for `<script ... src="/_nuxt/`, or by loading it in a browser. A new page also needs an entry in the `TITLES` map in `app/layouts/default.vue` (it drives the mobile top-bar heading) and an item in `app/components/AppNav.vue`.
- **A misspelled Nuxt UI component name passes `typecheck` AND `build`, then renders nothing.** `vue-tsc` does not flag unknown global components, so the only reliable check is `.nuxt/components.d.ts`. This is not hypothetical: Nuxt UI v4 renamed `UButtonGroup` to **`UFieldGroup`**, and the old name silently produced an invisible segmented control on the Shared page. Grep `.nuxt/components.d.ts` for any component you are using for the first time.
- **The webhook replies `202` before processing.** `processEvent()` runs detached (via `event.waitUntil`) with a swallowed `.catch()`, so failures surface only as rows in the `events` table (visible on the Dashboard) — never as an HTTP error to Tautulli. Debug forwarding problems through `/api/events`, not response codes.
- **`settings.sync_movies` / `settings.sync_episodes` are vestigial.** They're persisted and served by the settings API but the pipeline gates only on the **per-mapping** `mapping.sync_movies` / `mapping.sync_episodes`. Edit the mapping-level flags when changing sync behaviour.
- **Tautulli's media-info table is a cache it only rebuilds when you pass `refresh=true`.** `get_library_media_info` otherwise serves whatever snapshot it last built, and the failure is silent in both directions: titles added in Plex are missing from the picker, and titles removed still appear with a `rating_key` that `get_metadata` no longer resolves — which renders as Plex's generic chevron placeholder and would scrobble nothing. Seen live: the "Movies" section served 99 of its 308 films and offered an "Avatar" whose key was long gone. The library row's own `count` (from `get_libraries`) *does* track Plex, so `getLibraryItems` treats a disagreement with `recordsTotal` as the staleness signal and refreshes once — sub-second, and it sticks. A per-section cooldown keeps a debounced search from rebuilding on every keystroke. `resetLibraryRefreshCooldown()` exists only so that module state doesn't leak between specs.
- **Two active libraries can hold the same title under different `rating_key`s** — a real setup here has both `Movies`/`Filme` and `TV Shows`/`Seriale`. `getLibraryItems` merges every selected section of a type, so such a title legitimately appears twice, and since the pipeline gates on `section_id`, sharing the copy from a library you don't actually play from forwards nothing. That's why `LibraryItem` carries `library_name` and the picker prints it under the title: the two rows must be tellable apart.
- **An empty `settings.libraries` means *every* library, not none.** The column defaults to `''`, so an existing install upgrades to "all libraries selected" without a migration step, and the UI saves `[]` back when every box is ticked so libraries added in Tautulli later are included automatically. `parseLibraries()` in `db.ts` is deliberately tolerant — `''`, `null`, malformed JSON and a non-array payload all collapse to `[]`. The filter is applied **server-side in `server/api/tautulli/library.get.ts`**, so both item pickers inherit the selection without knowing the setting exists, and again in `pipeline.ts` as a gate that *records* the skip (unlike the unmapped-user case, which returns silently) — sitting after the `dryRun` return so Preview is never blocked.
- **`shared/version.ts` is the single source of truth for the version** (served at `/api/version`, shown in sidebar + login). Bump it on release, along with the README badge.
- **`/api/image` must keep its `/library/metadata/` prefix check.** It proxies Plex poster art via Tautulli so the API key stays server-side; without that check the endpoint becomes an open proxy authenticated with the user's Tautulli API key.
- **`syncSeenrWebhook` is authoritative on re-sync**: it writes `on_<action> = 0` for every unselected trigger, so a sync always fully replaces the notifier's trigger set. It finds its notifier by the literal friendly name `Seenr Bridge`.
- **Events are capped at 1000 rows**, trimmed by a DELETE on every insert in `insertEvent`.
- Username matching for mappings is `COLLATE NOCASE`, as is user login lookup.
- **Migrations are append-only `PRAGMA table_info` guards** at the bottom of `db.ts`. To add a column: extend the `CREATE TABLE`, add a matching `if (!cols.includes(...)) ALTER TABLE`, then thread it through the row interface, `getSettings`'s explicit column list, and `saveSettings`'s UPDATE.

## Deployment

`Dockerfile` is a two-stage build: `build` (installs deps with `npm ci`, forces a from-source rebuild of `better-sqlite3` — its published `linux-arm64` prebuild links against a newer glibc than `node:22-bookworm-slim` ships and fails to `dlopen` on arm64 hosts — then runs `npm run build`) and a slim runtime stage that copies only `.output/` (the bundled Nitro server, the static client, and the externalised `better-sqlite3` with its native binding). Defaults: `PORT=8687`, `DATA_DIR=/app/data`. There is no `PUBLIC_DIR` — Nitro serves the client itself. All state is the single SQLite file at `$DATA_DIR/seenr-bridge.db`.

**Releasing is automatic — bump `shared/version.ts` and push, nothing else.** `.github/workflows/docker-publish.yml` reads the version out of that file on every push to `main`, and if no `v<version>` tag exists it creates the tag and publishes the release after the image builds. So do NOT run `git tag` or `gh release create` by hand; that races the workflow. Details that are load-bearing:

- **The release is driven by the version file, not by a pushed tag.** A tag created with `GITHUB_TOKEN` does not trigger workflows, so the usual "release job tags, tag triggers the build" split would silently never publish the versioned image. One job does both instead.
- **`:<version>` and `:<major>.<minor>` are only applied when the version has no tag yet**, which keeps `:2.2.1` immutable — pushing to `main` again without a bump refreshes `:latest` alone and skips the release entirely.
- **Release notes come from a `CHANGELOG.md` section matching the version** (`## 2.3.0`, read up to the next `## `), falling back to `--generate-notes` when there isn't one, so a release never blocks on prose.
- The tag-and-release step runs **after** the image push, so a version is never tagged when its build failed.
- The published image is **amd64 only** — there is no `platforms:` line — despite the Dockerfile's arm64 accommodation. Fine on x86 hosts; add `platforms: linux/amd64,linux/arm64` to `build-push-action` if that changes.
