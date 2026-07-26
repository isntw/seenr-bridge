# Converting Seenr Bridge to Nuxt + Vue

**Date:** 2026-07-26
**Status:** Approved, pending implementation plan

## Goal

Replace the current split React/Vite client and Express server with a single Nuxt 4 application, using Nuxt UI for components and Pinia for cross-page state. The app keeps doing exactly what it does today — receive Tautulli webhooks, enrich them with real episode/movie IDs, forward ID-based scrobbles to seenr — with a responsive UI that works on phones.

## Constraints and decisions

**Backward compatibility: none required.** No API path, database schema, environment variable, or port needs to be preserved for existing deployments. This frees the design but also removes the option of verifying the port by diffing against a compatible old build — which is why a test suite is in scope (see Testing).

To be explicit about what that means for existing data: the schema and its migration guards are carried over unchanged, so an existing `seenr-bridge.db` from v1.0.1 will in practice still open and work. That is a side effect, not a supported guarantee — no upgrade path is tested, and a fresh database is the assumed starting point. The migration guards are retained because the app still needs to migrate itself across *future* schema changes, which is independent of compatibility with v1.0.1.

**Rendering mode: SPA (`ssr: false`).** This is a login-gated, self-hosted admin dashboard. There is no SEO surface, no public content, and no cold-load performance story that matters on a LAN. SSR would only add hydration complexity around auth state and pull `better-sqlite3` into the render path. Nuxt's default is SSR; we deliberately turn it off.

**Port strategy: relocate domain logic, don't rewrite it.** The value in this repository is `pipeline.ts`, `tautulli.ts`, and `scrobble.ts` — specifically the knowledge of which Tautulli field carries the real episode ID and what payload shape seenr accepts. That code is correct, has no framework coupling, and is plain functions over `fetch`. It moves to `server/utils/` substantially as-is. Rewriting it would risk reintroducing the wrong-show bug the project exists to fix.

## Stack

- Nuxt 4 (`app/` as `srcDir`)
- Nuxt UI v4 (`@nuxt/ui`, requires `tailwindcss` as a direct dependency)
- Pinia (`@pinia/nuxt`)
- Nitro on the `node-server` preset
- `better-sqlite3` (unchanged)
- TypeScript throughout
- Vitest for tests

## Directory layout

```
nuxt.config.ts
package.json                # single, at root
app/
  app.vue                   # <UApp><NuxtPage/></UApp>
  app.config.ts             # ui.colors.primary = 'violet', neutral = 'slate'
  layouts/default.vue       # responsive shell: rail ≥lg, drawer <lg
  pages/
    login.vue               # login + first-run register
    dashboard.vue
    settings.vue
  middleware/auth.global.ts
  components/
    AppNav.vue              # nav list, shared by rail and drawer
    AccountMenu.vue
    EventRow.vue            # expandable scrobble row
    CopyField.vue
    SetupStep.vue
  stores/
    auth.ts
    settings.ts
    status.ts
shared/
  types/index.ts            # wire contract, auto-imported by both sides
  version.ts                # single source of truth for VERSION
server/
  api/                      # one file per endpoint
  middleware/auth.ts
  utils/
    db.ts
    pipeline.ts
    tautulli.ts
    scrobble.ts
    seenr.ts
    auth.ts
```

`shared/` is auto-imported in both the app and server contexts. This eliminates the hand-mirrored `client/src/types.ts` that currently duplicates the server's JSON shapes with nothing to catch drift — a mismatch becomes a compile error.

`shared/types/` describes the **wire** shape, using booleans. The `0`/`1` SQLite row types stay private to `server/utils/db.ts` behind `toWire()` helpers. This is the same conversion boundary as today's `settingsToJson`/`mappingToJson` in `routes.ts`, but type-enforced rather than a convention that must be remembered when adding a column.

`shared/version.ts` lets the UI import `VERSION` directly at build time instead of fetching `/api/version` on mount. The endpoint is retained for external health checking.

## Server

`routes.ts` splits into one file per endpoint, with HTTP verbs coming from Nitro's method suffixes:

| Current | Nuxt |
|---|---|
| `GET /api/health` | `server/api/health.get.ts` |
| `GET /api/version` | `server/api/version.get.ts` |
| `POST /api/webhook/tautulli` | `server/api/webhook/tautulli.post.ts` |
| `GET /api/settings` | `server/api/settings/index.get.ts` |
| `PUT /api/settings` | `server/api/settings/index.put.ts` |
| `POST /api/settings/test-tautulli` | `server/api/settings/test-tautulli.post.ts` |
| `GET /api/status` | `server/api/status.get.ts` |
| `GET /api/tautulli/users` | `server/api/tautulli/users.get.ts` |
| `POST /api/tautulli/sync-webhook` | `server/api/tautulli/sync-webhook.post.ts` |
| `GET /api/mappings` | `server/api/mappings/index.get.ts` |
| `POST /api/mappings` | `server/api/mappings/index.post.ts` |
| `DELETE /api/mappings/:id` | `server/api/mappings/[id].delete.ts` |
| `GET /api/events` | `server/api/events.get.ts` |
| `GET /api/stats` | `server/api/stats.get.ts` |
| `GET /api/image` | `server/api/image.get.ts` |
| `POST /api/test` | `server/api/test.post.ts` |
| `GET /api/auth/status` | `server/api/auth/status.get.ts` |
| `POST /api/auth/register` | `server/api/auth/register.post.ts` |
| `POST /api/auth/login` | `server/api/auth/login.post.ts` |
| `POST /api/auth/logout` | `server/api/auth/logout.post.ts` |
| `POST /api/auth/change-password` | `server/api/auth/change-password.post.ts` |

`processEvent()` keeps its signature and remains the single code path used by both the webhook and `/api/test`, including the `dryRun` and `record` options.

`createError({ statusCode, statusMessage })` replaces `res.status().json()`. `readValidatedBody` replaces the hand-rolled `typeof b.x === 'string' ? b.x.trim() : undefined` guards currently in `routes.ts`.

### Two implementation details to handle deliberately

**DB singleton across HMR.** `db.ts` currently opens the database at module scope, which is safe because the module evaluates once under `tsx watch`. Nitro re-evaluates modules on hot reload, which would reopen the file on every save and eventually trip WAL locks. The handle is cached on `globalThis` and reused if present.

**The 202-then-background webhook.** Nitro returns the handler's value as the response body. The handler returns the 202 payload and lets `processEvent()` continue on a detached promise, wrapped in `event.waitUntil()` so Nitro does not treat the request as finished prematurely. Failures continue to be recorded to the `events` table, which remains the only place forwarding errors surface — correct for a receiver that must never make Tautulli wait.

## Auth

The security model is unchanged: scrypt with a per-user salt, `timingSafeEqual` comparison, opaque random session tokens stored in SQLite, `httpOnly` `SameSite=Lax` cookie, 30-day expiry, and registration permanently closing once `countUsers() > 0`.

What changes is the plumbing. h3's `getCookie`/`setCookie`/`deleteCookie` replace the ~25 lines of manual cookie parsing in `auth.ts`.

The gate becomes `server/middleware/auth.ts`. One difference from Express matters: `api.use(...)` only ever sees `/api` traffic because of where the router is mounted, whereas **Nitro server middleware runs on every request** including pages and assets. The middleware therefore early-returns for any path not under `/api/`, then applies an explicit public allowlist:

- `/api/health`
- `/api/version`
- `/api/webhook/tautulli`
- `/api/auth/status`
- `/api/auth/login`
- `/api/auth/register`
- `/api/auth/logout`

Everything else requires a session. `change-password` moves behind this middleware; today it sits outside the gate and re-checks `currentUser` itself, meaning two auth mechanisms coexist. Behind the middleware there is one.

On the client, `app/middleware/auth.global.ts` redirects unauthenticated navigation to `/login`, where `needsSetup` decides whether the register or login form renders.

## Client

### Routing

Today the Dashboard/Settings tabs are local component state with no URLs. File-based routing gives real `/dashboard` and `/settings` routes: deep-linkable, back button works, refresh preserves location. `/` redirects to `/dashboard`.

### Component mapping

| Current `ui.tsx` | Nuxt UI |
|---|---|
| `Card` | `UCard` |
| `StatCard` | `UPageCard` |
| `Badge` | `UBadge` |
| `Button` | `UButton` |
| `Field` | `UFormField` |
| `Input` | `UInput` |
| `Toggle` | `USwitch` |
| `Modal` | `UModal` |
| `CopyField` | custom — `UInput` + `UButton` + VueUse `useClipboard` |

Additional swaps:

- The username field becomes a `USelectMenu` that still accepts free text, preserving today's manual-entry fallback for when Tautulli is unreachable.
- The "Set it up manually instead" section becomes `UCollapsible`.
- Inline error `<div>`s become `UAlert`, with `useToast()` for transient feedback — replacing the current pattern of holding error strings in local state.
- The scrobble list stays a **custom `EventRow.vue`**, not `UTable`. It is not tabular data: each row has poster art, a colored status rail, and a click-to-expand JSON panel. `UCollapsible` handles the expand.

### Theming

`app/app.config.ts` sets `ui.colors.primary = 'violet'` and `ui.colors.neutral = 'slate'`, and `colorMode.preference = 'dark'` preserves the dark-only presentation that `index.css` currently forces via `color-scheme: dark`. The result will not be pixel-identical to the current design — accepted — but retains the product's character.

### Pinia stores

- **`stores/auth.ts`** — `authenticated`, `username`, `needsSetup`; actions `fetchStatus`, `login`, `register`, `logout`, `changePassword`.
- **`stores/settings.ts`** — settings and mappings; actions `fetch`, `save`, `saveMapping`, `deleteMapping`, `testTautulli`, `syncWebhook`.
- **`stores/status.ts`** — the Tautulli health poll behind a single 30s interval.

Dashboard events and stats use `useAsyncData` rather than a store: they are page-local, refetched on view, and gain nothing from shared state.

`stores/status.ts` also fixes an existing inefficiency. The sidebar currently polls `POST /api/settings/test-tautulli` every 30s while the Settings page independently calls `GET /api/status`, which tests the connection again. One store means one timer and one round-trip to Tautulli.

## Responsive design

Mobile is a requirement, not a follow-up. The current pages already carry `sm:` breakpoints in several places — the stat grid is `grid-cols-2 sm:grid-cols-4`, the Step 1 field pair and the mapping add-row both stack, and most button rows use `flex-wrap` — so this is not a from-scratch responsive effort. Two areas need real work.

**The shell (the actual bug).** `App.tsx:152` renders `<aside class="sticky top-0 flex h-screen w-56 shrink-0 …">` with no responsive class whatsoever. The 224px sidebar is permanently visible, leaving 151px of content on a 375px viewport. The replacement:

- **≥ `lg`** — persistent left rail, as today.
- **< `lg`** — rail hidden; a `USlideover` (left) holds the nav, opened by a hamburger `UButton` in the header. Navigating closes it.
- `AppNav.vue` renders the nav list once and is used by both the rail and the drawer, so the two cannot drift.
- Header keeps the page title and `AccountMenu`; the account button already hides its username below `sm` and that behaviour is kept.
- Main padding drops from `px-6 py-8` to `px-4 py-6` below `sm`.

**The event row.** Currently `flex items-center gap-3.5`: a 44px poster, a flexible middle column, and a fixed right column stacking the status pill above the relative timestamp. At 375px the `truncate` classes prevent overflow but leave the title barely legible. The reflow:

- **≥ `sm`** — current three-column layout.
- **< `sm`** — the right column moves below the metadata line. The status pill sits inline with the media-type badge; the timestamp joins the username/ID row.
- The poster shrinks but stays, since it is the fastest way to recognise an item.
- The expanded JSON panel keeps `max-h-64 overflow-auto` and is constrained so it never widens the page.

**Across the board:**

- Interactive controls get a minimum 44×44px touch target on mobile. Today's `Configure` buttons and trigger checkboxes are roughly 32–36px.
- The mapping row stacks its `Configure` button below the username/token summary below `sm`.
- No element may cause horizontal page scroll. Wide content — the JSON panel, `CopyField`'s webhook URL — scrolls inside its own container, as `CopyField` already does with `overflow-x-auto`.
- Verified at 375px, 768px, and 1280px.

## Docker, CI, and the dev loop

The Dockerfile drops from three stages to two:

1. **Build** — `node:22-bookworm-slim` plus `python3`, `make`, `g++` for `better-sqlite3`; `npm ci`; `npm run build` → `.output/`.
2. **Runtime** — `node:22-bookworm-slim`; copy `.output/`; `CMD ["node", ".output/server/index.mjs"]`.

Both stages share a base image so the compiled native binding copies across cleanly. `better-sqlite3` is marked external in the Nitro config so Rollup does not swallow the `.node` binding.

Environment reduces to `PORT=8687` and `DATA_DIR=/app/data`. **`PUBLIC_DIR` disappears** — Nitro serves the client, replacing Express's `express.static` plus hand-rolled SPA catch-all. The `npm prune --omit=dev` step also goes, since `.output` is already bundled and tree-shaken.

`.github/workflows/docker-publish.yml` needs no changes: same buildx and ghcr steps, same `context: .`.

The dev loop is where the merge is felt most:

| | Current | Nuxt |
|---|---|---|
| Installs | 2 | 1 |
| Processes | 2 (Vite + `tsx watch`) | 1 (`npm run dev`) |
| Ports | 2 (5173 + 8687) | 1 (8687) |
| `/api` in dev | Vite proxy → `:8687` | same origin, no proxy |

The last row removes a class of dev/prod divergence: today dev and production reach the API by different mechanisms, and Nitro makes them identical. `devServer.port` is set to 8687 so there is one port to remember. `docker-compose.dev.yml` collapses from two services and two named volumes to one of each.

## Error handling

`createError()` on the server, `$fetch` throwing `FetchError` with `.data` on the client. This deletes the entire `req<T>()` helper in `api.ts`, including its `try { msg = JSON.parse(t).error } catch {}` block for digging an error message out of a response body — Nitro and `$fetch` handle that contract natively.

The webhook's philosophy is unchanged: respond fast, process detached, record every failure to the `events` table. The events table is the error log; the Dashboard is its viewer.

User-facing errors surface as `UAlert` for persistent inline state and `useToast()` for transient feedback.

## Testing

There are no tests today. Because clean-slate removes the option of diffing against a compatible previous build, a small Vitest suite is how the port's correctness is actually established. Three files, all fast and free of external dependencies:

**`scrobble.spec.ts`** — the highest-value target, since this is where the wrong-show bug lives:
- an episode payload carries the *episode's own* guids, not the show's
- `grandparentTitle`, `parentIndex`, and `index` are populated for episodes
- movie payload shape
- all `mapEvent` cases: play, resume, pause, stop, watched, scrobble, and unknown → `media.scrobble`

**`pipeline.spec.ts`** — branch coverage with Tautulli and seenr stubbed:
- no mapping for the username → skipped
- disabled mapping → skipped
- movie while `sync_movies` is off → skipped
- `forward_enabled` off → recorded failure
- `dryRun` builds a payload without forwarding

**`db.spec.ts`**:
- migrations are idempotent when re-run against an existing file
- the 1000-event cap trims oldest rows
- `upsertMapping` conflict behaviour updates rather than duplicating
- `COLLATE NOCASE` username lookup

No browser or end-to-end tests: slow, and low value for a login-gated admin panel.

## Documentation to update

- **`CLAUDE.md`** — its Architecture, Commands, and "Conventions that will bite you" sections all describe the Express/React structure and become wrong wholesale. Several documented gotchas dissolve: the `settingsToJson` boolean-conversion reminder is superseded by typed `toWire()` helpers, and the `types.ts` drift warning is eliminated by `shared/types/`.
- **`README.md`** — Stack line, Development section (one command, one port), API reference table, and the Install instructions.
- **`docs/dashboard.png`** — reshoot after the Nuxt UI rebuild.

## Out of scope

- Backward-compatibility shims for existing v1.0.1 deployments.
- Visual redesign beyond what adopting Nuxt UI necessarily changes.
- End-to-end or browser-based tests.
- Replacing the hand-rolled `PRAGMA table_info` migrations with a migration tool. The existing approach is carried over as-is; revisiting it is separate work.
