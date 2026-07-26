# Nuxt + Vue Conversion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the split React/Vite client and Express server with a single Nuxt 4 application using Nuxt UI, Pinia, and Nitro, with a responsive UI that works on phones.

**Architecture:** One Nuxt 4 project. Vue pages in `app/`, Nitro API handlers in `server/api/`, and the wire-format type contract in `shared/` where both sides auto-import it. The domain logic that makes this app worth anything — Tautulli ID lookup, Plex payload construction, seenr forwarding — is relocated to `server/utils/` substantially as-is rather than rewritten, because it is already correct and rewriting it risks reintroducing the wrong-show bug the project exists to fix. Runs in SPA mode (`ssr: false`): this is a login-gated LAN admin panel, so SSR would buy nothing and cost hydration complexity around auth state.

**Tech Stack:** Nuxt 4, Nuxt UI v4, Pinia, Nitro (`node-server` preset), better-sqlite3, TypeScript, Vitest.

**Spec:** `docs/superpowers/specs/2026-07-26-nuxt-conversion-design.md`

**Branch:** `feat/nuxt-conversion` (already created; `commit.gpgsign` is already set to `false` locally)

## Global Constraints

Every task's requirements implicitly include this section.

- **Nuxt 4** with `app/` as `srcDir` (the Nuxt 4 default).
- **Rendering:** `ssr: false`.
- **Nuxt UI v4** via the `@nuxt/ui` module, with `tailwindcss` as a direct dependency.
- **Pinia** via `@pinia/nuxt`.
- **Nitro preset:** `node-server`. `better-sqlite3` must be declared external so Rollup does not swallow the native `.node` binding.
- **Ports/env:** `PORT=8687`, `DATA_DIR=/app/data`. `devServer.port` is also `8687`. There is no `PUBLIC_DIR` — Nitro serves the client.
- **Theme:** `ui.colors.primary = 'violet'`, `ui.colors.neutral = 'slate'`, `colorMode.preference = 'dark'`.
- **Docker:** `node:22-bookworm-slim` for both build and runtime stages.
- **Type boundary:** `shared/types/` describes the **wire** shape using `boolean`. The `0`/`1` SQLite row types stay private to `server/utils/db.ts` behind `*ToWire()` helpers. Never leak a `0`/`1` past that boundary.
- **`server/utils/*` modules MUST use explicit relative imports** (e.g. `import { getSettings } from './db'`), never Nitro auto-imports. Nitro would resolve auto-imports fine, but plain Vitest does not, and three test files depend on importing these modules directly. Violating this makes Tasks 3, 5, and 6 fail with confusing resolution errors.
- **Public API allowlist** (exactly these 7 paths bypass auth): `/api/health`, `/api/version`, `/api/webhook/tautulli`, `/api/auth/status`, `/api/auth/login`, `/api/auth/register`, `/api/auth/logout`.
- **Session model (unchanged):** scrypt with per-user salt, `timingSafeEqual` comparison, opaque random token in SQLite, `httpOnly` `SameSite=Lax` cookie, 30-day `Max-Age`. Registration closes permanently once `countUsers() > 0`.
- **Events table capped at 1000 rows**, trimmed on every insert.
- **Responsive:** persistent nav rail at `lg` and above; `USlideover` drawer below `lg`. Event row reflows at `sm`. Minimum 44×44px touch targets on mobile. No element may cause horizontal page scroll. Verified at 375px, 768px, and 1280px.
- **Commit after every task.** Do not squash tasks together.
- **Port the logic, not the warts.** Where a task says to port a legacy module, that means preserving its *behaviour* — the same branches, the same guard ordering, the same outputs — while writing the code the way it should have been written for this stack. Specifically: no `as any` or other type-checking escape hatches in application code, `node:` prefixes on Node builtins, `const`/`readonly` where values do not change, and modern idiomatic Vue/Nuxt/TypeScript throughout. Legacy stylistic quirks are not requirements. The test suites are what prove behaviour held; style is free to improve. In test files, deliberate casts used to simulate malformed input (e.g. metadata missing its `guids` array) are legitimate and should stay.

## File Structure

| Path | Responsibility |
|---|---|
| `nuxt.config.ts` | Modules, SPA mode, dev port, Nitro externals |
| `vitest.config.ts` | Node-environment test runner over `tests/**/*.spec.ts` |
| `app/app.vue` | `UApp` wrapper + layout/page outlets |
| `app/app.config.ts` | Nuxt UI theme tokens |
| `app/assets/css/main.css` | Tailwind + Nuxt UI CSS entry |
| `app/layouts/default.vue` | Responsive shell: rail ≥lg, drawer <lg, header |
| `app/components/AppNav.vue` | Nav item list, shared by rail and drawer so they cannot drift |
| `app/components/AccountMenu.vue` | Account dropdown + change-password modal |
| `app/components/EventRow.vue` | One expandable scrobble row, reflows at `sm` |
| `app/components/CopyField.vue` | Read-only value + copy button |
| `app/components/SetupStep.vue` | Numbered step wrapper on the Settings page |
| `app/pages/login.vue` | Login and first-run register |
| `app/pages/dashboard.vue` | Stat tiles + scrobble list |
| `app/pages/settings.vue` | Three-step setup flow + advanced |
| `app/middleware/auth.global.ts` | Client route guard |
| `app/stores/auth.ts` | Session state and auth actions |
| `app/stores/settings.ts` | Settings + mappings |
| `app/stores/status.ts` | Single 30s Tautulli health poll |
| `shared/types/index.ts` | Wire contract, auto-imported by both sides |
| `shared/version.ts` | `VERSION` — single source of truth |
| `server/utils/db.ts` | Schema, migrations, queries, `*ToWire()` helpers |
| `server/utils/auth.ts` | Hashing, verification, session cookie helpers |
| `server/utils/tautulli.ts` | Tautulli API client |
| `server/utils/scrobble.ts` | Action→event mapping, Plex payload construction |
| `server/utils/seenr.ts` | Forward payload to seenr |
| `server/utils/pipeline.ts` | `processEvent()` — the one enrich-and-forward path |
| `server/middleware/auth.ts` | API auth gate with public allowlist |
| `server/api/**` | One file per endpoint, verb from filename suffix |
| `tests/scrobble.spec.ts` | Payload construction — where the wrong-show bug lives |
| `tests/pipeline.spec.ts` | Skip/fail branch coverage |
| `tests/db.spec.ts` | Migration idempotency, event cap, upsert, NOCASE |

---

### Task 1: Scaffold Nuxt and prove better-sqlite3 survives Nitro

This is deliberately first. The spec identifies the native module as the one real technical risk: Nitro bundles the server with Rollup, and a `.node` binding that gets swallowed fails at runtime, not build time. Prove it in both dev and a production build before porting anything.

**Files:**
- Move: `client/` → `legacy/client/`, `server/` → `legacy/server/`
- Create: `package.json`, `nuxt.config.ts`, `vitest.config.ts`, `tsconfig.json`, `app/app.vue`, `app/app.config.ts`, `app/assets/css/main.css`, `shared/version.ts`, `server/api/health.get.ts`, `server/utils/db.ts` (skeleton only)
- Modify: `.gitignore`, `.dockerignore`

**Interfaces:**
- Consumes: nothing.
- Produces: `useDb(): Database.Database` and `closeDb(): void` from `server/utils/db.ts`; `VERSION: string` from `shared/version.ts`.

- [ ] **Step 1: Park the old trees so `server/` is free for Nitro**

`server/` already exists with `server/package.json` and `server/src/`, which collides with Nitro's `server/api|utils|middleware` convention. Move both halves aside; later tasks read from `legacy/` when porting, and Task 16 deletes it.

```bash
mkdir -p legacy
git mv client legacy/client
git mv server legacy/server
git rm -q docker-compose.dev.yml docker-compose.build.yml Dockerfile
```

The Dockerfile and compose files are removed now rather than edited, because Task 15 rewrites them from scratch and a half-valid Dockerfile in the tree is worse than none.

- [ ] **Step 2: Initialise the single root package and install dependencies**

Let npm resolve versions rather than hand-pinning them.

```bash
npm init -y
npm pkg set name=seenr-bridge private=true type=module
# npm init -y copies boilerplate from the repo (a markdown description lifted
# from README.md, an invented license, empty author, repository/bugs/homepage).
# None of it belongs in this manifest.
npm pkg delete main version description keywords author license repository bugs homepage directories
npm install nuxt@^4 @nuxt/ui@^4 @pinia/nuxt pinia tailwindcss better-sqlite3
npm install -D typescript vue-tsc vitest @types/better-sqlite3 @iconify-json/lucide
```

`@iconify-json/lucide` is not optional. Nuxt UI v4's own components (dropdown chevrons, checkboxes, the close button on modals) reference `lucide:*` icons. Without the collection installed locally, Nuxt Icon logs a warning for ~40 icons at build time and falls back to fetching them from the public Iconify API in the user's browser at runtime — unacceptable for a self-hosted LAN tool that may have no outbound internet access.

If `npm install` fails with an arborist crash or a peer-dependency conflict, pin the majors that `@nuxt/ui` requires rather than reaching for `--legacy-peer-deps`; a lockfile built with legacy peer resolution can produce a duplicated `@nuxt/kit` tree that breaks `nuxt dev`. Verify afterwards that exactly one `@nuxt/kit` version is installed.

- [ ] **Step 3: Add the npm scripts**

```bash
npm pkg set scripts.dev="nuxt dev"
npm pkg set scripts.build="nuxt build"
npm pkg set scripts.preview="nuxt preview"
npm pkg set scripts.start="node .output/server/index.mjs"
npm pkg set scripts.typecheck="nuxt typecheck"
npm pkg set scripts.test="vitest run"
npm pkg set scripts.test:watch="vitest"
npm pkg set scripts.postinstall="nuxt prepare"
```

- [ ] **Step 4: Write `nuxt.config.ts`**

```ts
export default defineNuxtConfig({
  modules: ['@nuxt/ui', '@pinia/nuxt'],

  // Login-gated LAN admin panel: SSR buys nothing and complicates auth state.
  ssr: false,

  devServer: { port: 8687 },

  css: ['~/assets/css/main.css'],

  colorMode: { preference: 'dark' },

  nitro: {
    preset: 'node-server',
    // better-sqlite3 ships a native .node binding. Bundling it breaks the
    // require path at runtime, so keep it external and resolved from disk.
    externals: { external: ['better-sqlite3'] },
  },

  typescript: { strict: true },

  // legacy/ holds the pre-conversion React/Express source during the port.
  // Task 16 deletes it. Until then, keep it out of the build and typecheck.
  ignore: ['legacy/**'],
})
```

- [ ] **Step 5: Write `tsconfig.json`**

```json
{
  "extends": "./.nuxt/tsconfig.json",
  "exclude": ["legacy", "node_modules", ".output"]
}
```

- [ ] **Step 6: Write the CSS entry, app config, and root component**

`app/assets/css/main.css`:

```css
@import "tailwindcss";
@import "@nuxt/ui";
```

`app/app.config.ts`:

```ts
export default defineAppConfig({
  ui: {
    colors: {
      primary: 'violet',
      neutral: 'slate',
    },
  },
})
```

`app/app.vue` — `UApp` is required by Nuxt UI for toasts, tooltips, and programmatic overlays:

```vue
<template>
  <UApp>
    <NuxtLayout>
      <NuxtPage />
    </NuxtLayout>
  </UApp>
</template>
```

- [ ] **Step 7: Write `shared/version.ts`**

Carried over verbatim from `legacy/server/src/version.ts`. Lives in `shared/` so the UI can import it at build time instead of fetching `/api/version` on mount.

```ts
// Single source of truth for the app version. Bump on release.
export const VERSION = '2.0.0'
```

- [ ] **Step 8: Write the `server/utils/db.ts` skeleton**

Only the connection handling for now — schema and queries land in Task 2. The `globalThis` cache is the point: Nitro re-evaluates modules on hot reload, so opening the database at module scope would reopen the file on every save and eventually trip WAL locks.

```ts
import Database from 'better-sqlite3'
import path from 'node:path'
import fs from 'node:fs'

const CACHE_KEY = '__seenrBridgeDb__'

interface DbCache {
  [CACHE_KEY]?: Database.Database
}

function dataDir(): string {
  return process.env.DATA_DIR || path.join(process.cwd(), 'data')
}

export function useDb(): Database.Database {
  const cache = globalThis as unknown as DbCache
  if (cache[CACHE_KEY]) return cache[CACHE_KEY]!

  const dir = dataDir()
  fs.mkdirSync(dir, { recursive: true })

  const db = new Database(path.join(dir, 'seenr-bridge.db'))
  db.pragma('journal_mode = WAL')

  cache[CACHE_KEY] = db
  return db
}

// Test helper: close the handle and clear the cache so the next useDb()
// re-reads DATA_DIR. Also used to release WAL locks between test files.
export function closeDb(): void {
  const cache = globalThis as unknown as DbCache
  cache[CACHE_KEY]?.close()
  delete cache[CACHE_KEY]
}
```

- [ ] **Step 9: Write the smoke-test endpoint**

`server/api/health.get.ts` — deliberately touches SQLite so a broken native binding fails loudly here rather than three tasks later.

```ts
import { VERSION } from '../../shared/version'
import { useDb } from '../utils/db'

export default defineEventHandler(() => {
  const db = useDb()
  const { n } = db.prepare('SELECT 1 AS n').get() as { n: number }
  return { ok: n === 1, version: VERSION }
})
```

- [ ] **Step 10: Write `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.spec.ts'],
    // better-sqlite3 handles are process-global; parallel files fight over
    // the same DATA_DIR. Running test files one at a time keeps DB tests
    // deterministic.
    //
    // NOTE: `poolOptions: { forks: { singleFork: true } }` was the Vitest 2/3
    // spelling and was REMOVED in Vitest 4 — it is silently ignored there,
    // so the isolation guarantee would not apply. `fileParallelism: false`
    // is the current top-level option and is what this project needs.
    fileParallelism: false,
  },
})
```

Verify the config is actually honoured rather than silently ignored:

```bash
npx vitest run 2>&1 | grep -i deprecat || echo "no deprecation warnings"
```

Expected: `no deprecation warnings`. (`No test files found` is expected at this point and is not a failure of this step.)

- [ ] **Step 11: Update ignore files**

Append to `.gitignore`:

```
.nuxt
.output
.data
node_modules
data
```

Replace `.dockerignore` entirely:

```
node_modules
.nuxt
.output
data
legacy
.git
docs
```

- [ ] **Step 12: Verify dev mode serves and the DB opens**

```bash
npm run dev
```

Then in a second shell:

```bash
curl -s localhost:8687/api/health
```

Expected: `{"ok":true,"version":"2.0.0"}`. Stop the dev server.

- [ ] **Step 13: Verify the production build — the actual risk gate**

Dev mode does not bundle, so it proves nothing about Rollup swallowing the native binding. This step does.

```bash
npm run build
DATA_DIR=./data PORT=8687 node .output/server/index.mjs &
sleep 3 && curl -s localhost:8687/api/health && kill %1
```

Expected: `{"ok":true,"version":"2.0.0"}`.

If this fails with a `.node` resolution or `MODULE_NOT_FOUND` error, the `nitro.externals` config is wrong — fix it here before continuing. Everything downstream depends on it.

- [ ] **Step 14: Commit**

```bash
git add -A
git commit -m "feat: scaffold Nuxt 4 app, park legacy source, verify better-sqlite3 under Nitro"
```

---

### Task 2: Port the wire contract and the database layer

**Files:**
- Create: `shared/types/index.ts`, `tests/db.spec.ts`
- Modify: `server/utils/db.ts`
- Reference: `legacy/server/src/db.ts`, `legacy/client/src/types.ts`

**Interfaces:**
- Consumes: `useDb()`, `closeDb()` from Task 1.
- Produces: from `shared/types/index.ts` — `Settings`, `Mapping`, `ScrobbleEvent`, `Stats`, `Status`, `AuthStatus`, `TestResult`, `SyncResult`, `TautulliMetadata`, `IncomingEvent`, `ProcessResult`. From `server/utils/db.ts` — `SettingsRow`, `MappingRow`, `EventRowDb`, `User`, `getSettings()`, `saveSettings()`, `settingsToWire()`, `listMappings()`, `getMappingByUsername()`, `upsertMapping()`, `deleteMapping()`, `mappingToWire()`, `insertEvent()`, `listEvents()`, `eventToWire()`, `getStats()`, `countUsers()`, `createUser()`, `getUserByUsername()`, `getUserById()`, `createSession()`, `getSessionByToken()`, `deleteSession()`, `updateUserPassword()`, `deleteUserSessions()`.

**Naming note:** the session lookup is `getSessionByToken`, **not** `getSession`. h3 auto-imports its own `getSession(event, config)` into every Nitro module, so exporting `getSession` from `server/utils/db.ts` shadows it globally and emits `WARN Duplicated imports "getSession", the one from "h3" has been ignored`. Any later handler that wanted h3's real session helper would silently get the database one instead. `getSessionByToken` also describes the function accurately — it takes a token, not an event.

Note the naming: the wire type is `ScrobbleEvent` and the DB row is `EventRowDb`. This avoids colliding with the `EventRow.vue` component built in Task 13.

- [ ] **Step 1: Write `shared/types/index.ts`**

Booleans, not `0`/`1` — this is the wire contract both sides import.

```ts
export interface Settings {
  tautulli_url: string
  tautulli_apikey: string
  seenr_base_url: string
  forward_enabled: boolean
  bridge_url: string
  sync_movies: boolean
  sync_episodes: boolean
}

export interface Mapping {
  id: number
  username: string
  seenr_token: string
  enabled: boolean
  sync_movies: boolean
  sync_episodes: boolean
}

export interface ScrobbleEvent {
  id: number
  ts: number
  action: string | null
  event: string | null
  username: string | null
  media_type: string | null
  title: string | null
  rating_key: string | null
  ids: string[]
  image: string | null
  series_key: string | null
  seenr_status: number | null
  ok: boolean
  error: string | null
  payload: string | null
}

export interface Stats {
  total: number
  ok: number
  failed: number
  last: number | null
  episodes: number
  movies: number
  users: number
}

export interface Status {
  tautulli: { ok: boolean; message: string }
  webhook: boolean
  users: number
}

export interface AuthStatus {
  authenticated: boolean
  username: string | null
  needsSetup: boolean
}

export interface TautulliMetadata {
  media_type: string
  rating_key: string
  title: string
  grandparent_title: string
  parent_media_index: string
  media_index: string
  year: string | number
  duration: string | number
  guid: string
  grandparent_guid: string
  grandparent_rating_key: string
  guids: string[]
  thumb: string
  grandparent_thumb: string
}

export interface IncomingEvent {
  action: string
  rating_key: string
  username: string
}

export interface ProcessResult {
  ok: boolean
  skipped?: boolean
  reason?: string
  event?: string
  ids?: string[]
  title?: string
  media_type?: string
  image?: string | null
  seenr_status?: number
  payload?: Record<string, unknown>
}

export type TestResult = ProcessResult

export interface SyncResult {
  ok: boolean
  webhookUrl?: string
  notifier_id?: number
  created?: boolean
  error?: string
}
```

- [ ] **Step 2: Write the failing DB test**

`tests/db.spec.ts`. Each test gets its own `DATA_DIR` so they cannot interfere.

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

let tmp: string

async function freshDb() {
  const mod = await import('../server/utils/db')
  mod.closeDb()
  return mod
}

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-test-'))
  process.env.DATA_DIR = tmp
})

afterEach(async () => {
  const mod = await import('../server/utils/db')
  mod.closeDb()
  fs.rmSync(tmp, { recursive: true, force: true })
})

describe('migrations', () => {
  it('are idempotent when re-run against an existing file', async () => {
    const first = await freshDb()
    first.getSettings()
    first.closeDb()

    // Re-importing re-runs the migration guards against a populated file.
    const second = await freshDb()
    expect(() => second.getSettings()).not.toThrow()
    expect(second.getSettings().seenr_base_url).toBe(
      'https://seenr.app/api/v1/scrobble/plex',
    )
  })
})

describe('mappings', () => {
  it('upsert updates rather than duplicating on username conflict', async () => {
    const db = await freshDb()
    db.upsertMapping('alice', 'tok-1', 1, 1, 1)
    db.upsertMapping('alice', 'tok-2', 0, 0, 1)

    const all = db.listMappings()
    expect(all).toHaveLength(1)
    expect(all[0]!.seenr_token).toBe('tok-2')
    expect(all[0]!.enabled).toBe(0)
  })

  it('looks up usernames case-insensitively', async () => {
    const db = await freshDb()
    db.upsertMapping('Alice', 'tok', 1, 1, 1)
    expect(db.getMappingByUsername('alice')?.seenr_token).toBe('tok')
    expect(db.getMappingByUsername('ALICE')?.seenr_token).toBe('tok')
  })
})

describe('events', () => {
  it('caps the table at 1000 rows, trimming oldest first', async () => {
    const db = await freshDb()
    const base = {
      action: 'watched', event: 'media.scrobble', username: 'alice',
      media_type: 'episode', title: 't', rating_key: '1', ids: '[]',
      image: null, series_key: null, seenr_status: 200, ok: 1,
      error: null, payload: null,
    }
    for (let i = 0; i < 1005; i++) {
      db.insertEvent({ ...base, ts: 1_700_000_000_000 + i })
    }

    const rows = db.listEvents(2000)
    expect(rows).toHaveLength(1000)
    // Oldest survivor is the 6th insert, so the first five were trimmed.
    expect(Math.min(...rows.map((r) => r.ts))).toBe(1_700_000_000_005)
  })
})

describe('wire conversion', () => {
  // All three *ToWire helpers need coverage: this boundary is the only thing
  // stopping a raw 0/1 reaching the client, so an untested helper is an
  // untested guarantee.

  it('mappingToWire converts 0/1 columns to booleans', async () => {
    const db = await freshDb()
    const m = db.upsertMapping('bob', 'tok', 1, 0, 1)
    const wire = db.mappingToWire(m)

    expect(wire.enabled).toBe(true)
    expect(wire.sync_movies).toBe(false)
    expect(wire.sync_episodes).toBe(true)
  })

  it('settingsToWire converts 0/1 columns to booleans', async () => {
    const db = await freshDb()
    db.saveSettings({ forward_enabled: 0, sync_movies: 1, sync_episodes: 0 })
    const wire = db.settingsToWire(db.getSettings())

    expect(wire.forward_enabled).toBe(false)
    expect(wire.sync_movies).toBe(true)
    expect(wire.sync_episodes).toBe(false)
  })

  it('eventToWire converts ok to boolean and parses the ids JSON', async () => {
    const db = await freshDb()
    const id = db.insertEvent({
      ts: 1_700_000_000_000, action: 'watched', event: 'media.scrobble',
      username: 'alice', media_type: 'episode', title: 't', rating_key: '1',
      ids: JSON.stringify(['tmdb://62161', 'imdb://tt2301455']),
      image: null, series_key: null, seenr_status: 200, ok: 1,
      error: null, payload: null,
    })
    const row = db.listEvents(10).find((r) => r.id === id)!
    const wire = db.eventToWire(row)

    expect(wire.ok).toBe(true)
    expect(wire.ids).toEqual(['tmdb://62161', 'imdb://tt2301455'])
  })

  it('eventToWire falls back to an empty ids array on malformed JSON', async () => {
    const db = await freshDb()
    const id = db.insertEvent({
      ts: 1_700_000_000_000, action: 'watched', event: 'media.scrobble',
      username: 'alice', media_type: 'movie', title: 't', rating_key: '1',
      ids: '{not valid json',
      image: null, series_key: null, seenr_status: 500, ok: 0,
      error: 'boom', payload: null,
    })
    const row = db.listEvents(10).find((r) => r.id === id)!
    const wire = db.eventToWire(row)

    // A corrupt ids column must not crash the events endpoint.
    expect(wire.ids).toEqual([])
    expect(wire.ok).toBe(false)
  })
})
```

- [ ] **Step 3: Run the test to verify it fails**

```bash
npm test -- tests/db.spec.ts
```

Expected: FAIL — `getSettings is not a function` (only `useDb`/`closeDb` exist so far).

- [ ] **Step 4: Port the schema, migrations, and queries**

Append to `server/utils/db.ts`. The schema, migration guards, and query bodies come from `legacy/server/src/db.ts` unchanged — read it with `git show HEAD:legacy/server/src/db.ts` or open the file directly. Four adaptations:

1. Every function calls `useDb()` instead of a module-scope `db` const.
2. Schema creation and migrations move into a `migrate(db)` function called once from `useDb()`, so a fresh handle after `closeDb()` re-applies them.
3. `EventRow` is renamed `EventRowDb`.
4. Add the three `*ToWire()` helpers, which replace `settingsToJson`/`mappingToJson` from `legacy/server/src/routes.ts`.

Add to `useDb()`, immediately before `cache[CACHE_KEY] = db`:

```ts
  migrate(db)
```

Then the schema and migrations, copied from `legacy/server/src/db.ts` lines 12–83:

```ts
function migrate(db: Database.Database): void {
  db.exec(`
CREATE TABLE IF NOT EXISTS settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  tautulli_url TEXT NOT NULL DEFAULT '',
  tautulli_apikey TEXT NOT NULL DEFAULT '',
  seenr_base_url TEXT NOT NULL DEFAULT 'https://seenr.app/api/v1/scrobble/plex',
  forward_enabled INTEGER NOT NULL DEFAULT 1
);
INSERT OR IGNORE INTO settings (id) VALUES (1);

CREATE TABLE IF NOT EXISTS mappings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  seenr_token TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  action TEXT,
  event TEXT,
  username TEXT,
  media_type TEXT,
  title TEXT,
  rating_key TEXT,
  ids TEXT,
  seenr_status INTEGER,
  ok INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  payload TEXT
);
CREATE INDEX IF NOT EXISTS idx_events_ts ON events (ts DESC);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  created INTEGER NOT NULL
);
`)

  // Append-only column guards. Retained because the app still needs to
  // migrate itself across future schema changes.
  const cols = (table: string) =>
    (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[])
      .map((c) => c.name)

  const settingsCols = cols('settings')
  if (!settingsCols.includes('bridge_url'))
    db.exec("ALTER TABLE settings ADD COLUMN bridge_url TEXT NOT NULL DEFAULT ''")
  if (!settingsCols.includes('sync_movies'))
    db.exec('ALTER TABLE settings ADD COLUMN sync_movies INTEGER NOT NULL DEFAULT 1')
  if (!settingsCols.includes('sync_episodes'))
    db.exec('ALTER TABLE settings ADD COLUMN sync_episodes INTEGER NOT NULL DEFAULT 1')

  const eventCols = cols('events')
  if (!eventCols.includes('image'))
    db.exec('ALTER TABLE events ADD COLUMN image TEXT')
  if (!eventCols.includes('series_key'))
    db.exec('ALTER TABLE events ADD COLUMN series_key TEXT')

  const mappingCols = cols('mappings')
  if (!mappingCols.includes('sync_movies'))
    db.exec('ALTER TABLE mappings ADD COLUMN sync_movies INTEGER NOT NULL DEFAULT 1')
  if (!mappingCols.includes('sync_episodes'))
    db.exec('ALTER TABLE mappings ADD COLUMN sync_episodes INTEGER NOT NULL DEFAULT 1')
}
```

Row types and the wire helpers:

```ts
export interface SettingsRow {
  tautulli_url: string
  tautulli_apikey: string
  seenr_base_url: string
  forward_enabled: number
  bridge_url: string
  sync_movies: number
  sync_episodes: number
}

export interface MappingRow {
  id: number
  username: string
  seenr_token: string
  enabled: number
  sync_movies: number
  sync_episodes: number
}

export interface EventRowDb {
  id: number
  ts: number
  action: string | null
  event: string | null
  username: string | null
  media_type: string | null
  title: string | null
  rating_key: string | null
  ids: string | null
  image: string | null
  series_key: string | null
  seenr_status: number | null
  ok: number
  error: string | null
  payload: string | null
}

export interface User {
  id: number
  username: string
  password_hash: string
  created: number
}

export function settingsToWire(r: SettingsRow): Settings {
  return {
    ...r,
    forward_enabled: !!r.forward_enabled,
    sync_movies: !!r.sync_movies,
    sync_episodes: !!r.sync_episodes,
  }
}

export function mappingToWire(r: MappingRow): Mapping {
  return {
    ...r,
    enabled: !!r.enabled,
    sync_movies: !!r.sync_movies,
    sync_episodes: !!r.sync_episodes,
  }
}

export function eventToWire(r: EventRowDb): ScrobbleEvent {
  let ids: string[] = []
  try {
    ids = r.ids ? (JSON.parse(r.ids) as string[]) : []
  } catch {
    ids = []
  }
  return { ...r, ok: !!r.ok, ids }
}
```

Add the import at the top of the file:

```ts
import type { Settings, Mapping, ScrobbleEvent, Stats } from '../../shared/types'
```

Then port the remaining query functions from `legacy/server/src/db.ts` lines 122–249 verbatim, changing only the module-scope `db` references to `useDb()` and `EventRow` to `EventRowDb`: `getSettings`, `saveSettings`, `listMappings`, `getMappingByUsername`, `upsertMapping`, `deleteMapping`, `insertEvent`, `listEvents`, `getStats`, `countUsers`, `createUser`, `getUserByUsername`, `getUserById`, `createSession`, `getSession`, `deleteSession`, `updateUserPassword`, `deleteUserSessions`. Keep `const MAX_EVENTS = 1000` and the trim `DELETE` inside `insertEvent`.

- [ ] **Step 5: Run the test to verify it passes**

```bash
npm test -- tests/db.spec.ts
```

Expected: PASS, 5 tests.

- [ ] **Step 6: Commit**

```bash
git add shared/types/index.ts server/utils/db.ts tests/db.spec.ts
git commit -m "feat: port wire types and database layer with tests"
```

---

### Task 3: Port payload construction with tests

The highest-value tests in the plan. This module is where the wrong-show bug lives: an episode's payload must carry the **episode's own** external IDs, not the show's.

**Files:**
- Create: `server/utils/scrobble.ts`, `tests/scrobble.spec.ts`
- Reference: `legacy/server/src/scrobble.ts`

**Interfaces:**
- Consumes: `TautulliMetadata` from `shared/types`.
- Produces: `mapEvent(action: string): string`, `buildPayload(m: TautulliMetadata, action: string, username: string): BuiltPayload` where `BuiltPayload = { event: string; ids: string[]; title: string; payload: Record<string, unknown> }`.

- [ ] **Step 1: Write the failing test**

`tests/scrobble.spec.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { mapEvent, buildPayload } from '../server/utils/scrobble'
import type { TautulliMetadata } from '../shared/types'

const episode: TautulliMetadata = {
  media_type: 'episode',
  rating_key: '12345',
  title: 'Ozymandias',
  grandparent_title: 'Breaking Bad',
  parent_media_index: '5',
  media_index: '14',
  year: 2013,
  duration: 2880000,
  guid: 'plex://episode/5d9c0876e98e47001eb0d74e',
  grandparent_guid: 'plex://show/5d9c081e8ba7be001e343e2a',
  grandparent_rating_key: '999',
  // The episode's OWN ids — the whole point of the bridge.
  guids: ['imdb://tt2301455', 'tmdb://62161', 'tvdb://4589350'],
  thumb: '/library/metadata/12345/thumb/1700000000',
  grandparent_thumb: '/library/metadata/999/thumb/1700000000',
}

const movie: TautulliMetadata = {
  ...episode,
  media_type: 'movie',
  rating_key: '777',
  title: 'Sicario',
  grandparent_title: '',
  parent_media_index: '',
  media_index: '',
  year: 2015,
  guid: 'plex://movie/5d776b1f9ab5437c19540b1f',
  grandparent_guid: '',
  grandparent_rating_key: '',
  guids: ['imdb://tt3397884', 'tmdb://273481'],
}

describe('mapEvent', () => {
  it('maps every Tautulli action to its Plex event name', () => {
    expect(mapEvent('play')).toBe('media.play')
    expect(mapEvent('resume')).toBe('media.resume')
    expect(mapEvent('pause')).toBe('media.pause')
    expect(mapEvent('stop')).toBe('media.stop')
    expect(mapEvent('watched')).toBe('media.scrobble')
    expect(mapEvent('scrobble')).toBe('media.scrobble')
  })

  it('strips the on_ prefix Tautulli sometimes sends', () => {
    expect(mapEvent('on_watched')).toBe('media.scrobble')
    expect(mapEvent('on_play')).toBe('media.play')
  })

  it('falls back to media.scrobble for unknown actions', () => {
    expect(mapEvent('nonsense')).toBe('media.scrobble')
    expect(mapEvent('')).toBe('media.scrobble')
  })
})

describe('buildPayload for episodes', () => {
  it("carries the episode's own ids, not the show's", () => {
    const built = buildPayload(episode, 'watched', 'alice')
    const guids = (built.payload.Metadata as any).Guid

    expect(guids).toEqual([
      { id: 'imdb://tt2301455' },
      { id: 'tmdb://62161' },
      { id: 'tvdb://4589350' },
    ])
    expect(built.ids).toEqual(episode.guids)
    // The show's guid must never appear in the Guid array.
    expect(JSON.stringify(guids)).not.toContain('5d9c081e8ba7be001e343e2a')
  })

  it('includes show title and season/episode indices', () => {
    const meta = buildPayload(episode, 'watched', 'alice').payload.Metadata as any
    expect(meta.grandparentTitle).toBe('Breaking Bad')
    expect(meta.grandparentGuid).toBe('plex://show/5d9c081e8ba7be001e343e2a')
    expect(meta.parentIndex).toBe('5')
    expect(meta.index).toBe('14')
    expect(meta.type).toBe('episode')
  })

  it('sets the event and account from the action and username', () => {
    const built = buildPayload(episode, 'watched', 'alice')
    expect(built.payload.event).toBe('media.scrobble')
    expect(built.payload.Account).toEqual({ title: 'alice' })
    expect(built.event).toBe('media.scrobble')
    expect(built.title).toBe('Ozymandias')
  })
})

describe('buildPayload for movies', () => {
  it('carries the movie ids and omits episode-only fields', () => {
    const built = buildPayload(movie, 'watched', 'bob')
    const meta = built.payload.Metadata as any

    expect(meta.type).toBe('movie')
    expect(meta.Guid).toEqual([
      { id: 'imdb://tt3397884' },
      { id: 'tmdb://273481' },
    ])
    expect(meta.grandparentTitle).toBeUndefined()
    expect(meta.parentIndex).toBeUndefined()
    expect(meta.index).toBeUndefined()
  })
})

describe('buildPayload edge cases', () => {
  it('tolerates missing guids without throwing', () => {
    const built = buildPayload({ ...episode, guids: undefined as any }, 'watched', 'alice')
    expect(built.ids).toEqual([])
    expect((built.payload.Metadata as any).Guid).toEqual([])
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npm test -- tests/scrobble.spec.ts
```

Expected: FAIL — cannot resolve `../server/utils/scrobble`.

- [ ] **Step 3: Port the module**

`server/utils/scrobble.ts` — copy `legacy/server/src/scrobble.ts` in full. Two changes only: import `TautulliMetadata` from `../../shared/types` instead of `./tautulli`, and export the `BuiltPayload` interface.

```ts
import type { TautulliMetadata } from '../../shared/types'

// Map a Tautulli notify action to the Plex webhook event name seenr expects.
export function mapEvent(action: string): string {
  const a = (action || '').toLowerCase().replace(/^on_/, '')
  switch (a) {
    case 'play': return 'media.play'
    case 'resume': return 'media.resume'
    case 'pause': return 'media.pause'
    case 'stop': return 'media.stop'
    case 'watched':
    case 'scrobble': return 'media.scrobble'
    default: return 'media.scrobble'
  }
}

export interface BuiltPayload {
  event: string
  ids: string[]
  title: string
  payload: Record<string, unknown>
}

// Build a Plex `media.scrobble`-style payload using the item's OWN external
// IDs. For episodes, m.guids are the episode's real tmdb/tvdb/imdb ids —
// exactly what the Tautulli webhook template cannot provide.
export function buildPayload(
  m: TautulliMetadata,
  action: string,
  username: string,
): BuiltPayload {
  const event = mapEvent(action)
  const isEpisode = m.media_type === 'episode'
  const ids = Array.isArray(m.guids) ? m.guids : []

  const metadata: Record<string, unknown> = {
    type: m.media_type,
    title: m.title,
    year: String(m.year ?? ''),
    duration: String(m.duration ?? ''),
    guid: m.guid,
    Guid: ids.map((id) => ({ id })),
  }

  if (isEpisode) {
    metadata.grandparentTitle = m.grandparent_title
    metadata.grandparentGuid = m.grandparent_guid
    metadata.parentIndex = String(m.parent_media_index ?? '')
    metadata.index = String(m.media_index ?? '')
  }

  const payload = {
    event,
    user: true,
    owner: true,
    Account: { title: username },
    Metadata: metadata,
  }

  return { event, ids, title: m.title, payload }
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npm test -- tests/scrobble.spec.ts
```

Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add server/utils/scrobble.ts tests/scrobble.spec.ts
git commit -m "feat: port payload construction with ID-correctness tests"
```

---

### Task 4: Port the Tautulli and seenr clients

Both are thin I/O wrappers over `fetch` with no branching logic worth unit-testing; they are exercised through `pipeline.spec.ts` in Task 5 with stubs.

**Files:**
- Create: `server/utils/tautulli.ts`, `server/utils/seenr.ts`
- Reference: `legacy/server/src/tautulli.ts`, `legacy/server/src/seenr.ts`

**Interfaces:**
- Produces from `tautulli.ts`: `getMetadata(url, apiKey, ratingKey): Promise<TautulliMetadata>`, `syncSeenrWebhook(url, apiKey, webhookUrl, opts?: { triggers?: string[] }): Promise<{ notifier_id: number; created: boolean }>`, `fetchImage(url, apiKey, imgPath, width?, height?): Promise<{ contentType: string; buffer: Buffer } | null>`, `bridgeWebhookExists(url, apiKey): Promise<boolean>`, `getUsers(url, apiKey): Promise<string[]>`, `testConnection(url, apiKey): Promise<{ ok: boolean; message: string }>`.
- Produces from `seenr.ts`: `forwardToSeenr(seenrBaseUrl, token, payload): Promise<{ status: number; body: string }>`.

- [ ] **Step 1: Port `server/utils/tautulli.ts`**

Copy `legacy/server/src/tautulli.ts` in full. Changes:

1. Delete the local `TautulliMetadata` interface (lines 4–19) and instead `import type { TautulliMetadata } from '../../shared/types'`.
2. Keep the same behaviour and the same exported surface: `base()`, `getMetadata()`, `WEBHOOK_AGENT_ID = 25`, `BRIDGE_FRIENDLY_NAME = 'Seenr Bridge'`, `tautulliApi()`, `syncSeenrWebhook()`, `fetchImage()`, `bridgeWebhookExists()`, `getUsers()`, `testConnection()`.
3. **Do not carry over the legacy `as any` casts on `res.json()`.** The global "port the logic, not the warts" constraint applies here as it does everywhere. Tautulli's API responses are untyped JSON, so model that honestly instead of switching off the checker: declare a narrow response shape and assert to it, e.g.

```ts
interface TautulliResponse<T> {
  response?: { result?: string; message?: string; data?: T }
}

const json = (await res.json()) as TautulliResponse<TautulliMetadata>
```

`unknown` plus a narrowing check is also fine. What is not fine is `as any`, which silently disables checking on every downstream property access.

The `syncSeenrWebhook` trigger loop matters and must not be simplified — it writes `on_<action> = 0` for unselected triggers so a re-sync is authoritative, and populates body/headers for all five actions so any trigger works if enabled later.

- [ ] **Step 2: Port `server/utils/seenr.ts`**

Copy `legacy/server/src/seenr.ts` verbatim — no changes needed. It has no imports.

- [ ] **Step 3: Verify both modules typecheck**

```bash
npx tsc --noEmit -p tsconfig.json
```

Expected: no errors. If `.nuxt/tsconfig.json` is missing, run `npm run postinstall` first.

- [ ] **Step 4: Commit**

```bash
git add server/utils/tautulli.ts server/utils/seenr.ts
git commit -m "feat: port Tautulli and seenr clients"
```

---

### Task 5: Port the enrichment pipeline with branch tests

**Files:**
- Create: `server/utils/pipeline.ts`, `tests/pipeline.spec.ts`
- Reference: `legacy/server/src/pipeline.ts`

**Interfaces:**
- Consumes: `getSettings`, `getMappingByUsername`, `insertEvent` from `./db`; `getMetadata` from `./tautulli`; `buildPayload` from `./scrobble`; `forwardToSeenr` from `./seenr`.
- Produces: `processEvent(input: IncomingEvent, opts?: { dryRun?: boolean; record?: boolean }): Promise<ProcessResult>`.

- [ ] **Step 1: Write the failing test**

`tests/pipeline.spec.ts`. The Tautulli and seenr modules are mocked so no network is touched.

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { TautulliMetadata } from '../shared/types'

const meta: TautulliMetadata = {
  media_type: 'episode',
  rating_key: '12345',
  title: 'Ozymandias',
  grandparent_title: 'Breaking Bad',
  parent_media_index: '5',
  media_index: '14',
  year: 2013,
  duration: 2880000,
  guid: 'plex://episode/abc',
  grandparent_guid: 'plex://show/def',
  grandparent_rating_key: '999',
  guids: ['tmdb://62161'],
  thumb: '/library/metadata/12345/thumb/1',
  grandparent_thumb: '/library/metadata/999/thumb/1',
}

const getMetadata = vi.fn(async () => meta)
const forwardToSeenr = vi.fn(async () => ({ status: 200, body: 'ok' }))

vi.mock('../server/utils/tautulli', () => ({
  getMetadata: (...a: unknown[]) => getMetadata(...(a as [])),
}))
vi.mock('../server/utils/seenr', () => ({
  forwardToSeenr: (...a: unknown[]) => forwardToSeenr(...(a as [])),
}))

let tmp: string

async function load() {
  const db = await import('../server/utils/db')
  db.closeDb()
  const pipeline = await import('../server/utils/pipeline')
  return { db, pipeline }
}

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-pipe-'))
  process.env.DATA_DIR = tmp
  getMetadata.mockClear()
  forwardToSeenr.mockClear()
})

afterEach(async () => {
  const db = await import('../server/utils/db')
  db.closeDb()
  fs.rmSync(tmp, { recursive: true, force: true })
})

const input = { action: 'watched', rating_key: '12345', username: 'alice' }

async function configured() {
  const { db, pipeline } = await load()
  db.saveSettings({ tautulli_url: 'http://taut:8181', tautulli_apikey: 'key' })
  return { db, pipeline }
}

describe('processEvent guards', () => {
  it('fails when Tautulli is not configured', async () => {
    const { pipeline } = await load()
    const r = await pipeline.processEvent(input)
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('Tautulli connection not configured')
    expect(forwardToSeenr).not.toHaveBeenCalled()
  })

  it('skips when the username has no mapping', async () => {
    const { pipeline } = await configured()
    const r = await pipeline.processEvent(input)
    expect(r.skipped).toBe(true)
    expect(r.reason).toContain('No seenr mapping')
    expect(forwardToSeenr).not.toHaveBeenCalled()
  })

  it('skips when the mapping is disabled', async () => {
    const { db, pipeline } = await configured()
    db.upsertMapping('alice', 'tok', 0, 1, 1)
    const r = await pipeline.processEvent(input)
    expect(r.skipped).toBe(true)
    expect(r.reason).toContain('is disabled')
    expect(forwardToSeenr).not.toHaveBeenCalled()
  })

  it('skips an episode when that user has episode sync off', async () => {
    const { db, pipeline } = await configured()
    db.upsertMapping('alice', 'tok', 1, 1, 0)
    const r = await pipeline.processEvent(input)
    expect(r.skipped).toBe(true)
    expect(r.reason).toContain('Episode sync is off')
    expect(forwardToSeenr).not.toHaveBeenCalled()
  })

  it('skips a movie when that user has movie sync off', async () => {
    const { db, pipeline } = await configured()
    db.upsertMapping('alice', 'tok', 1, 0, 1)
    getMetadata.mockResolvedValueOnce({ ...meta, media_type: 'movie' })
    const r = await pipeline.processEvent(input)
    expect(r.skipped).toBe(true)
    expect(r.reason).toContain('Movie sync is off')
    expect(forwardToSeenr).not.toHaveBeenCalled()
  })

  it('records a failure when forwarding is globally disabled', async () => {
    const { db, pipeline } = await configured()
    db.saveSettings({ forward_enabled: 0 })
    db.upsertMapping('alice', 'tok', 1, 1, 1)
    const r = await pipeline.processEvent(input)

    expect(r.ok).toBe(false)
    expect(r.reason).toBe('Forwarding is disabled in settings')
    expect(forwardToSeenr).not.toHaveBeenCalled()
    expect(db.listEvents(10)).toHaveLength(1)
  })
})

describe('processEvent success path', () => {
  it('forwards and records a successful scrobble', async () => {
    const { db, pipeline } = await configured()
    db.upsertMapping('alice', 'tok', 1, 1, 1)
    const r = await pipeline.processEvent(input)

    expect(r.ok).toBe(true)
    expect(r.seenr_status).toBe(200)
    expect(forwardToSeenr).toHaveBeenCalledOnce()

    const rows = db.listEvents(10)
    expect(rows).toHaveLength(1)
    expect(rows[0]!.ok).toBe(1)
    expect(rows[0]!.series_key).toBe('999')
    expect(rows[0]!.image).toBe('/library/metadata/999/thumb/1')
  })

  it('records a failure for a non-2xx seenr response', async () => {
    const { db, pipeline } = await configured()
    db.upsertMapping('alice', 'tok', 1, 1, 1)
    forwardToSeenr.mockResolvedValueOnce({ status: 401, body: 'bad token' })
    const r = await pipeline.processEvent(input)

    expect(r.ok).toBe(false)
    expect(r.seenr_status).toBe(401)
    expect(db.listEvents(10)[0]!.error).toContain('401')
  })
})

describe('processEvent dryRun', () => {
  it('builds a payload without forwarding or recording', async () => {
    const { db, pipeline } = await configured()
    db.upsertMapping('alice', 'tok', 1, 1, 1)
    const r = await pipeline.processEvent(input, { dryRun: true, record: false })

    expect(r.ok).toBe(true)
    expect(r.payload).toBeDefined()
    expect(r.ids).toEqual(['tmdb://62161'])
    expect(forwardToSeenr).not.toHaveBeenCalled()
    expect(db.listEvents(10)).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npm test -- tests/pipeline.spec.ts
```

Expected: FAIL — cannot resolve `../server/utils/pipeline`.

- [ ] **Step 3: Port the module**

`server/utils/pipeline.ts` — copy `legacy/server/src/pipeline.ts` in full. Changes:

1. Import `IncomingEvent` and `ProcessResult` from `../../shared/types` instead of declaring them locally.
2. Imports become explicit relative paths: `./db`, `./tautulli`, `./scrobble`, `./seenr`.
3. The control flow is unchanged, including the `fail()` closure and the guard ordering.
4. **Drop the legacy `null as any` casts.** The original wrote `extra.event ?? null as any`; write `extra.event ?? null`. `EventRowDb.event` is typed `string | null` and `extra.event` is `string | undefined`, so `?? null` already yields the correct type — the cast was unnecessary even in the legacy file. Same for `media_type` and `title`. No `as any` anywhere in this module.

The guard ordering is load-bearing and must not be rearranged: settings check → mapping lookup → enabled check → metadata fetch → build → `dryRun` early return → `forward_enabled` → per-media-type sync flags → forward. Tests assert on this order via which mocks were called.

- [ ] **Step 4: Run the test to verify it passes**

```bash
npm test -- tests/pipeline.spec.ts
```

Expected: PASS, 9 tests.

- [ ] **Step 5: Run the whole suite**

```bash
npm test
```

Expected: PASS, 22 tests across 3 files.

- [ ] **Step 6: Commit**

```bash
git add server/utils/pipeline.ts tests/pipeline.spec.ts
git commit -m "feat: port enrichment pipeline with branch coverage tests"
```

---

### Task 6: Auth utilities and the API gate

**Files:**
- Create: `server/utils/auth.ts`, `server/middleware/auth.ts`
- Reference: `legacy/server/src/auth.ts`

**Interfaces:**
- Consumes: `getSessionByToken`, `getUserById`, `createSession` from `./db`.
- Produces: `SESSION_COOKIE: string`, `hashPassword(pw: string): string`, `verifyPassword(pw: string, stored: string): boolean`, `currentUser(event: H3Event): User | undefined`, `setSessionCookie(event: H3Event, userId: number): void`, `clearSessionCookie(event: H3Event): void`, `PUBLIC_API_PATHS: Set<string>`.

- [ ] **Step 1: Write `server/utils/auth.ts`**

The crypto is carried over from `legacy/server/src/auth.ts` unchanged. What goes away is ~25 lines of manual cookie parsing, replaced by h3 helpers.

```ts
import crypto from 'node:crypto'
import type { H3Event } from 'h3'
import { getCookie, setCookie, deleteCookie } from 'h3'
import { getSessionByToken, getUserById, createSession, type User } from './db'

export const SESSION_COOKIE = 'sb_session'
const MAX_AGE = 60 * 60 * 24 * 30 // 30 days

export function hashPassword(pw: string): string {
  const salt = crypto.randomBytes(16)
  const hash = crypto.scryptSync(pw, salt, 64)
  return salt.toString('hex') + ':' + hash.toString('hex')
}

export function verifyPassword(pw: string, stored: string): boolean {
  const [saltHex, hashHex] = (stored || '').split(':')
  if (!saltHex || !hashHex) return false
  const expected = Buffer.from(hashHex, 'hex')
  const actual = crypto.scryptSync(pw, Buffer.from(saltHex, 'hex'), 64)
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual)
}

export function currentUser(event: H3Event): User | undefined {
  const token = getCookie(event, SESSION_COOKIE)
  if (!token) return undefined
  const sess = getSessionByToken(token)
  return sess ? getUserById(sess.user_id) : undefined
}

export function setSessionCookie(event: H3Event, userId: number): void {
  setCookie(event, SESSION_COOKIE, createSession(userId), {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: MAX_AGE,
  })
}

export function clearSessionCookie(event: H3Event): void {
  deleteCookie(event, SESSION_COOKIE, { path: '/' })
}

// Exactly these bypass the auth gate. Tautulli cannot authenticate, and the
// login screen needs status/login/register before a session exists.
export const PUBLIC_API_PATHS = new Set([
  '/api/health',
  '/api/version',
  '/api/webhook/tautulli',
  '/api/auth/status',
  '/api/auth/login',
  '/api/auth/register',
  '/api/auth/logout',
])
```

- [ ] **Step 2: Write `server/middleware/auth.ts`**

The critical difference from Express: `api.use(...)` only ever saw `/api` traffic because of where the router was mounted, but **Nitro server middleware runs on every request** — pages, assets, everything. Without the early return, this would 401 the entire UI.

```ts
import { currentUser, PUBLIC_API_PATHS } from '../utils/auth'

export default defineEventHandler((event) => {
  const path = getRequestURL(event).pathname

  // Nitro middleware sees every request, not just /api. Let pages and
  // assets through untouched.
  if (!path.startsWith('/api/')) return

  if (PUBLIC_API_PATHS.has(path)) return

  if (!currentUser(event)) {
    throw createError({ statusCode: 401, statusMessage: 'unauthorized' })
  }
})
```

- [ ] **Step 3: Verify the gate by hand**

```bash
npm run dev
```

In a second shell:

```bash
curl -s -o /dev/null -w '%{http_code} health\n'   localhost:8687/api/health
curl -s -o /dev/null -w '%{http_code} settings\n' localhost:8687/api/settings
curl -s -o /dev/null -w '%{http_code} page\n'     localhost:8687/
```

Expected: `200 health`, `401 settings`, `200 page`. The third line is the regression check for the early return — if it returns 401, the middleware is gating the UI.

`/api/settings` returning 401 rather than 404 confirms the middleware runs before route resolution. Stop the dev server.

- [ ] **Step 4: Commit**

```bash
git add server/utils/auth.ts server/middleware/auth.ts
git commit -m "feat: add auth utilities and API gate with public allowlist"
```

---

### Task 7: Auth endpoints

**Files:**
- Create: `server/api/auth/status.get.ts`, `server/api/auth/register.post.ts`, `server/api/auth/login.post.ts`, `server/api/auth/logout.post.ts`, `server/api/auth/change-password.post.ts`
- Reference: `legacy/server/src/auth.ts:54-100`

**Interfaces:**
- Consumes: `hashPassword`, `verifyPassword`, `currentUser`, `setSessionCookie`, `clearSessionCookie`, `SESSION_COOKIE` from `../../utils/auth`; `countUsers`, `createUser`, `getUserByUsername`, `deleteSession`, `updateUserPassword`, `deleteUserSessions` from `../../utils/db`.
- Produces: the five `/api/auth/*` endpoints returning `AuthStatus` or `{ ok: true }`.

`change-password` sits **behind** the auth middleware, unlike the legacy version which lived outside the gate and re-checked `currentUser` itself. One auth mechanism, not two.

- [ ] **Step 1: Write `server/api/auth/status.get.ts`**

```ts
import { currentUser } from '../../utils/auth'
import { countUsers } from '../../utils/db'
import type { AuthStatus } from '../../../shared/types'

export default defineEventHandler((event): AuthStatus => {
  const user = currentUser(event)
  return {
    authenticated: !!user,
    username: user?.username ?? null,
    needsSetup: countUsers() === 0,
  }
})
```

- [ ] **Step 2: Write `server/api/auth/register.post.ts`**

```ts
import { hashPassword, setSessionCookie } from '../../utils/auth'
import { countUsers, createUser } from '../../utils/db'
import type { AuthStatus } from '../../../shared/types'

export default defineEventHandler(async (event): Promise<AuthStatus> => {
  const body = await readBody<{ username?: string; password?: string }>(event)
  const username = String(body?.username || '').trim()
  const password = String(body?.password || '')

  if (countUsers() > 0) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Registration is closed — an account already exists.',
    })
  }
  if (!username || !password) {
    throw createError({ statusCode: 400, statusMessage: 'Enter a username and password.' })
  }
  if (password.length < 8) {
    throw createError({ statusCode: 400, statusMessage: 'Password must be at least 8 characters.' })
  }

  const user = createUser(username, hashPassword(password))
  setSessionCookie(event, user.id)
  return { authenticated: true, username: user.username, needsSetup: false }
})
```

- [ ] **Step 3: Write `server/api/auth/login.post.ts`**

```ts
import { verifyPassword, setSessionCookie } from '../../utils/auth'
import { getUserByUsername } from '../../utils/db'
import type { AuthStatus } from '../../../shared/types'

export default defineEventHandler(async (event): Promise<AuthStatus> => {
  const body = await readBody<{ username?: string; password?: string }>(event)
  const username = String(body?.username || '').trim()
  const password = String(body?.password || '')

  const user = getUserByUsername(username)
  if (!user || !verifyPassword(password, user.password_hash)) {
    throw createError({ statusCode: 401, statusMessage: 'Wrong username or password.' })
  }

  setSessionCookie(event, user.id)
  return { authenticated: true, username: user.username, needsSetup: false }
})
```

- [ ] **Step 4: Write `server/api/auth/logout.post.ts`**

```ts
import { getCookie } from 'h3'
import { SESSION_COOKIE, clearSessionCookie } from '../../utils/auth'
import { deleteSession } from '../../utils/db'

export default defineEventHandler((event) => {
  const token = getCookie(event, SESSION_COOKIE)
  if (token) deleteSession(token)
  clearSessionCookie(event)
  return { ok: true }
})
```

- [ ] **Step 5: Write `server/api/auth/change-password.post.ts`**

```ts
import { currentUser, hashPassword, verifyPassword, setSessionCookie } from '../../utils/auth'
import { updateUserPassword, deleteUserSessions } from '../../utils/db'

export default defineEventHandler(async (event) => {
  // The auth middleware guarantees a session, so this is a type narrowing
  // rather than a second auth check.
  const user = currentUser(event)!

  const body = await readBody<{ current_password?: string; new_password?: string }>(event)
  const current = String(body?.current_password || '')
  const next = String(body?.new_password || '')

  if (!verifyPassword(current, user.password_hash)) {
    throw createError({ statusCode: 400, statusMessage: 'Current password is wrong.' })
  }
  if (next.length < 8) {
    throw createError({ statusCode: 400, statusMessage: 'New password must be at least 8 characters.' })
  }

  updateUserPassword(user.id, hashPassword(next))
  // Sign every device out, then re-issue a session for this one.
  deleteUserSessions(user.id)
  setSessionCookie(event, user.id)
  return { ok: true }
})
```

- [ ] **Step 6: Verify the full auth cycle end-to-end**

```bash
rm -rf ./data && npm run dev
```

In a second shell:

```bash
curl -s localhost:8687/api/auth/status
curl -s -c /tmp/sb.jar -X POST localhost:8687/api/auth/register \
  -H 'Content-Type: application/json' -d '{"username":"admin","password":"password123"}'
curl -s -b /tmp/sb.jar localhost:8687/api/auth/status
curl -s -o /dev/null -w '%{http_code} settings-with-session\n' \
  -b /tmp/sb.jar localhost:8687/api/settings
curl -s -X POST localhost:8687/api/auth/register \
  -H 'Content-Type: application/json' -d '{"username":"x","password":"password123"}'
```

Expected, in order: `needsSetup:true`; a successful register with `authenticated:true`; `authenticated:true,username:"admin"`; `401 settings-with-session` (the endpoint does not exist yet — Task 8 — but the gate passes, so this proves the session works and the 401 is now from a missing route, not auth); a 403 with "Registration is closed".

Stop the dev server and `rm -rf ./data /tmp/sb.jar`.

- [ ] **Step 7: Commit**

```bash
git add server/api/auth
git commit -m "feat: add auth endpoints, moving change-password behind the gate"
```

---

### Task 8: Settings, status, and Tautulli endpoints

**Files:**
- Create: `server/api/version.get.ts`, `server/api/settings/index.get.ts`, `server/api/settings/index.put.ts`, `server/api/settings/test-tautulli.post.ts`, `server/api/status.get.ts`, `server/api/tautulli/users.get.ts`, `server/api/tautulli/sync-webhook.post.ts`
- Reference: `legacy/server/src/routes.ts:18-99`

**Interfaces:**
- Consumes: `getSettings`, `saveSettings`, `settingsToWire`, `listMappings` from db; `testConnection`, `bridgeWebhookExists`, `getUsers`, `syncSeenrWebhook` from tautulli.
- Produces: `/api/version`, `/api/settings` (GET/PUT), `/api/settings/test-tautulli`, `/api/status`, `/api/tautulli/users`, `/api/tautulli/sync-webhook`.

- [ ] **Step 1: Write `server/api/version.get.ts`**

```ts
import { VERSION } from '../../shared/version'

export default defineEventHandler(() => ({ version: VERSION }))
```

- [ ] **Step 2: Write `server/api/settings/index.get.ts`**

```ts
import { getSettings, settingsToWire } from '../../utils/db'
import type { Settings } from '../../../shared/types'

export default defineEventHandler((): Settings => settingsToWire(getSettings()))
```

- [ ] **Step 3: Write `server/api/settings/index.put.ts`**

`readValidatedBody` replaces the legacy `typeof b.x === 'string' ? b.x.trim() : undefined` chain. Absent keys stay absent so `saveSettings` preserves the current value.

```ts
import { getSettings, saveSettings, settingsToWire, type SettingsRow } from '../../utils/db'
import type { Settings } from '../../../shared/types'

function validate(raw: unknown): Partial<SettingsRow> {
  const b = (raw ?? {}) as Record<string, unknown>
  const str = (v: unknown) => (typeof v === 'string' ? v.trim() : undefined)
  const bool = (v: unknown) => (v === undefined ? undefined : v ? 1 : 0)

  return {
    tautulli_url: str(b.tautulli_url),
    tautulli_apikey: str(b.tautulli_apikey),
    seenr_base_url: str(b.seenr_base_url),
    bridge_url: str(b.bridge_url),
    forward_enabled: bool(b.forward_enabled),
    sync_movies: bool(b.sync_movies),
    sync_episodes: bool(b.sync_episodes),
  }
}

export default defineEventHandler(async (event): Promise<Settings> => {
  const patch = await readValidatedBody(event, validate)
  return settingsToWire(saveSettings(patch))
})
```

Note: `saveSettings` uses `s.x ?? cur.x`, so the `undefined` values produced above correctly mean "leave unchanged".

- [ ] **Step 4: Write `server/api/settings/test-tautulli.post.ts`**

Returns `{ ok, message }` as a normal 200 body rather than throwing — the UI renders this as a status badge, not an error.

```ts
import { getSettings } from '../../utils/db'
import { testConnection } from '../../utils/tautulli'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ tautulli_url?: string; tautulli_apikey?: string }>(event)
    .catch(() => ({}) as Record<string, string>)
  const s = getSettings()
  const url = (body?.tautulli_url || s.tautulli_url || '').trim()
  const key = (body?.tautulli_apikey || s.tautulli_apikey || '').trim()

  if (!url || !key) return { ok: false, message: 'URL and API key required' }
  return await testConnection(url, key)
})
```

- [ ] **Step 5: Write `server/api/status.get.ts`**

```ts
import { getSettings, listMappings } from '../utils/db'
import { testConnection, bridgeWebhookExists } from '../utils/tautulli'
import type { Status } from '../../shared/types'

export default defineEventHandler(async (): Promise<Status> => {
  const s = getSettings()
  const configured = !!(s.tautulli_url && s.tautulli_apikey)
  const tautulli = configured
    ? await testConnection(s.tautulli_url, s.tautulli_apikey)
    : { ok: false, message: 'not configured' }

  let webhook = false
  if (tautulli.ok) {
    try {
      webhook = await bridgeWebhookExists(s.tautulli_url, s.tautulli_apikey)
    } catch {
      webhook = false
    }
  }

  return { tautulli, webhook, users: listMappings().length }
})
```

- [ ] **Step 6: Write `server/api/tautulli/users.get.ts`**

```ts
import { getSettings } from '../../utils/db'
import { getUsers } from '../../utils/tautulli'

export default defineEventHandler(async () => {
  const s = getSettings()
  if (!s.tautulli_url || !s.tautulli_apikey) return { ok: false, users: [] as string[] }
  try {
    return { ok: true, users: await getUsers(s.tautulli_url, s.tautulli_apikey) }
  } catch (e: unknown) {
    return { ok: false, users: [] as string[], error: e instanceof Error ? e.message : String(e) }
  }
})
```

- [ ] **Step 7: Write `server/api/tautulli/sync-webhook.post.ts`**

```ts
import { getSettings } from '../../utils/db'
import { syncSeenrWebhook } from '../../utils/tautulli'
import type { SyncResult } from '../../../shared/types'

export default defineEventHandler(async (event): Promise<SyncResult> => {
  const s = getSettings()
  if (!s.tautulli_url || !s.tautulli_apikey) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Configure and save the Tautulli connection first.',
    })
  }

  // bridge_url wins if set (reverse proxy); otherwise infer from this request.
  let baseUrl = (s.bridge_url || '').trim().replace(/\/+$/, '')
  if (!baseUrl) {
    const proto = getRequestHeader(event, 'x-forwarded-proto') || 'http'
    baseUrl = `${proto}://${getRequestHeader(event, 'host')}`
  }
  const webhookUrl = `${baseUrl}/api/webhook/tautulli`

  const body = await readBody<{ triggers?: unknown }>(event).catch(() => ({}) as Record<string, unknown>)
  const triggers = Array.isArray(body?.triggers)
    ? body.triggers.filter((t): t is string => typeof t === 'string')
    : undefined

  try {
    const r = await syncSeenrWebhook(s.tautulli_url, s.tautulli_apikey, webhookUrl, { triggers })
    return { ok: true, webhookUrl, ...r }
  } catch (e: unknown) {
    throw createError({
      statusCode: 500,
      statusMessage: e instanceof Error ? e.message : String(e),
      data: { webhookUrl },
    })
  }
})
```

- [ ] **Step 8: Verify settings round-trip**

```bash
rm -rf ./data && npm run dev
```

Second shell:

```bash
curl -s -c /tmp/sb.jar -X POST localhost:8687/api/auth/register \
  -H 'Content-Type: application/json' -d '{"username":"admin","password":"password123"}' >/dev/null
curl -s -b /tmp/sb.jar localhost:8687/api/settings
curl -s -b /tmp/sb.jar -X PUT localhost:8687/api/settings \
  -H 'Content-Type: application/json' \
  -d '{"tautulli_url":"http://taut:8181","tautulli_apikey":"k","sync_movies":false}'
curl -s -b /tmp/sb.jar localhost:8687/api/status
```

Expected: defaults with `forward_enabled:true` and `sync_movies:true`; then the saved object with `sync_movies:false` and `seenr_base_url` still at its default (proving absent keys are preserved); then a `status` object with `tautulli.ok:false` since `http://taut:8181` is unreachable.

Confirm every boolean in those responses is `true`/`false` and never `0`/`1`. Stop the server, `rm -rf ./data /tmp/sb.jar`.

- [ ] **Step 9: Commit**

```bash
git add server/api/version.get.ts server/api/settings server/api/status.get.ts server/api/tautulli
git commit -m "feat: add settings, status, and Tautulli endpoints"
```

---

### Task 9: Mappings, events, stats, and image endpoints

**Files:**
- Create: `server/api/mappings/index.get.ts`, `server/api/mappings/index.post.ts`, `server/api/mappings/[id].delete.ts`, `server/api/events.get.ts`, `server/api/stats.get.ts`, `server/api/image.get.ts`, `server/api/[...].ts`
- Reference: `legacy/server/src/routes.ts:101-152`

**Interfaces:**
- Consumes: `listMappings`, `upsertMapping`, `deleteMapping`, `mappingToWire`, `listEvents`, `eventToWire`, `getStats`, `getSettings` from db; `fetchImage` from tautulli.
- Produces: `/api/mappings` (GET/POST), `/api/mappings/:id` (DELETE), `/api/events`, `/api/stats`, `/api/image`.

- [ ] **Step 1: Write `server/api/mappings/index.get.ts`**

```ts
import { listMappings, mappingToWire } from '../../utils/db'
import type { Mapping } from '../../../shared/types'

export default defineEventHandler((): Mapping[] => listMappings().map(mappingToWire))
```

- [ ] **Step 2: Write `server/api/mappings/index.post.ts`**

The `=== false ? 0 : 1` shape is deliberate and carried over: an omitted flag defaults to enabled.

```ts
import { upsertMapping, mappingToWire } from '../../utils/db'
import type { Mapping } from '../../../shared/types'

export default defineEventHandler(async (event): Promise<Mapping> => {
  const b = await readBody<Record<string, unknown>>(event)
  const username = String(b?.username || '').trim()
  const token = String(b?.seenr_token || '').trim()

  if (!username || !token) {
    throw createError({ statusCode: 400, statusMessage: 'username and seenr_token required' })
  }

  return mappingToWire(
    upsertMapping(
      username,
      token,
      b.enabled === false ? 0 : 1,
      b.sync_movies === false ? 0 : 1,
      b.sync_episodes === false ? 0 : 1,
    ),
  )
})
```

- [ ] **Step 3: Write `server/api/mappings/[id].delete.ts`**

```ts
import { deleteMapping } from '../../utils/db'

export default defineEventHandler((event) => {
  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isInteger(id) || id <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'invalid mapping id' })
  }
  deleteMapping(id)
  return { ok: true }
})
```

- [ ] **Step 4: Write `server/api/events.get.ts`**

```ts
import { listEvents, eventToWire } from '../utils/db'
import type { ScrobbleEvent } from '../../shared/types'

export default defineEventHandler((event): ScrobbleEvent[] => {
  const limit = Math.min(Number(getQuery(event).limit) || 25, 1000)
  return listEvents(limit).map(eventToWire)
})
```

- [ ] **Step 5: Write `server/api/stats.get.ts`**

```ts
import { getStats } from '../utils/db'
import type { Stats } from '../../shared/types'

export default defineEventHandler((): Stats => getStats())
```

- [ ] **Step 6: Write `server/api/image.get.ts`**

The `/library/metadata/` prefix check is a security control, not a nicety — it stops this endpoint being used as an arbitrary proxy through the Tautulli API key. Keep it.

```ts
import { getSettings } from '../utils/db'
import { fetchImage } from '../utils/tautulli'

export default defineEventHandler(async (event) => {
  const imgPath = String(getQuery(event).path || '')

  // Only ever proxy Plex metadata art. Without this the endpoint becomes an
  // open proxy authenticated with the user's Tautulli API key.
  if (!imgPath.startsWith('/library/metadata/')) {
    throw createError({ statusCode: 400, statusMessage: 'invalid image path' })
  }

  const s = getSettings()
  if (!s.tautulli_url || !s.tautulli_apikey) {
    throw createError({ statusCode: 404, statusMessage: 'Tautulli not configured' })
  }

  try {
    const img = await fetchImage(s.tautulli_url, s.tautulli_apikey, imgPath)
    if (!img) throw createError({ statusCode: 404, statusMessage: 'not found' })

    setHeader(event, 'Content-Type', img.contentType)
    setHeader(event, 'Cache-Control', 'public, max-age=86400')
    return img.buffer
  } catch (e: unknown) {
    if (e && typeof e === 'object' && 'statusCode' in e) throw e
    throw createError({ statusCode: 502, statusMessage: 'image fetch failed' })
  }
})
```

- [ ] **Step 6b: Write `server/api/[...].ts` — the API 404 catch-all**

This closes a real regression against the legacy app. Express served the SPA with an explicit exclusion — `app.get('*', (req, res, next) => { if (req.path.startsWith('/api')) return next(); ... })` (`legacy/server/src/index.ts:21-24`) — so an unmatched `/api` path correctly 404'd. Nuxt in SPA mode has no such exclusion: verified empirically that an authenticated request to `/api/nope` returns **`200` with `content-type: text/html`**, i.e. the SPA shell.

That is bad in two ways. A client calling a typo'd or removed endpoint gets HTML and a `200`, so `$fetch` fails with an opaque JSON-parse error instead of a clear 404. And a future endpoint registered at the wrong path appears to succeed rather than failing loudly.

Nitro matches specific routes before a catch-all, so this only fires for genuinely unmatched paths:

```ts
// Unmatched /api/* must 404 as JSON, not fall through to the SPA shell.
// Nuxt in SPA mode would otherwise serve index.html with a 200, which turns
// a typo'd endpoint into an opaque JSON-parse error at the call site.
export default defineEventHandler((event) => {
  throw createError({
    statusCode: 404,
    statusMessage: `No API route matches ${event.path}`,
  })
})
```

Verify that the catch-all does **not** shadow real routes — this is the risk with catch-alls and must be checked explicitly, not assumed:

```bash
curl -s -o /dev/null -w '%{http_code} real-route-still-works\n' -b /tmp/sb.jar localhost:8687/api/stats
curl -s -o /dev/null -w '%{http_code} unmatched-now-404\n'      -b /tmp/sb.jar localhost:8687/api/nope
curl -s -D - -o /dev/null -b /tmp/sb.jar localhost:8687/api/nope | grep -i '^content-type'
```

Expected: `200 real-route-still-works`, `404 unmatched-now-404`, and a `content-type` of `application/json`, not `text/html`.

- [ ] **Step 7: Verify mappings and events**

```bash
rm -rf ./data && npm run dev
```

Second shell:

```bash
curl -s -c /tmp/sb.jar -X POST localhost:8687/api/auth/register \
  -H 'Content-Type: application/json' -d '{"username":"admin","password":"password123"}' >/dev/null
curl -s -b /tmp/sb.jar -X POST localhost:8687/api/mappings \
  -H 'Content-Type: application/json' -d '{"username":"alice","seenr_token":"tok","sync_movies":false}'
curl -s -b /tmp/sb.jar localhost:8687/api/mappings
curl -s -b /tmp/sb.jar localhost:8687/api/stats
curl -s -o /dev/null -w '%{http_code} bad-image-path\n' \
  -b /tmp/sb.jar 'localhost:8687/api/image?path=/etc/passwd'
```

Expected: the created mapping with `enabled:true` and `sync_movies:false`; a one-element array; stats all zero with `users:1`; `400 bad-image-path`.

Stop the server, `rm -rf ./data /tmp/sb.jar`.

- [ ] **Step 8: Commit**

```bash
git add server/api/mappings server/api/events.get.ts server/api/stats.get.ts server/api/image.get.ts
git commit -m "feat: add mappings, events, stats, and image proxy endpoints"
```

---

### Task 10: Webhook and test endpoints

**Files:**
- Create: `server/api/webhook/tautulli.post.ts`, `server/api/test.post.ts`
- Reference: `legacy/server/src/routes.ts:154-177`

**Interfaces:**
- Consumes: `processEvent` from `../utils/pipeline`.
- Produces: `/api/webhook/tautulli` (public, returns 202), `/api/test`.

- [ ] **Step 1: Write `server/api/webhook/tautulli.post.ts`**

Two behaviours must survive the port. First, Tautulli sends either JSON or form-urlencoded — `readBody` handles both content types, so field extraction stays tolerant of either. Second, the handler responds immediately and processes in the background so Tautulli never waits; `event.waitUntil` keeps Nitro from tearing the context down mid-flight.

```ts
import { processEvent } from '../../utils/pipeline'

export default defineEventHandler(async (event) => {
  const b = (await readBody<Record<string, unknown>>(event).catch(() => ({}) as Record<string, unknown>)) ?? {}

  const rating_key = b.rating_key ?? b.ratingKey
  const username = b.username ?? b.user
  const action = b.action ?? b.notify_action ?? 'watched'

  if (!rating_key || !username) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Missing rating_key or username in webhook payload',
      data: { received: b },
    })
  }

  // Respond fast; enrich and forward in the background so Tautulli never
  // waits on the seenr round-trip. Failures are recorded to the events
  // table — that table is this endpoint's error log.
  const work = processEvent({
    action: String(action),
    rating_key: String(rating_key),
    username: String(username),
  }).catch(() => {})

  event.waitUntil(work)

  setResponseStatus(event, 202)
  return { accepted: true }
})
```

- [ ] **Step 2: Write `server/api/test.post.ts`**

```ts
import { processEvent } from '../utils/pipeline'
import type { TestResult } from '../../shared/types'

export default defineEventHandler(async (event): Promise<TestResult> => {
  const b = await readBody<Record<string, unknown>>(event)
  const rating_key = b?.rating_key
  const username = b?.username

  if (!rating_key || !username) {
    throw createError({ statusCode: 400, statusMessage: 'rating_key and username required' })
  }

  const dryRun = !!b.dryRun
  return await processEvent(
    {
      action: String(b.action || 'watched'),
      rating_key: String(rating_key),
      username: String(username),
    },
    { dryRun, record: !dryRun },
  )
})
```

- [ ] **Step 3: Verify the webhook accepts unauthenticated posts in both content types**

```bash
rm -rf ./data && npm run dev
```

Second shell:

```bash
curl -s -o /dev/null -w '%{http_code} json-no-auth\n' \
  -X POST localhost:8687/api/webhook/tautulli \
  -H 'Content-Type: application/json' \
  -d '{"rating_key":"1","username":"alice","action":"watched"}'

curl -s -o /dev/null -w '%{http_code} form-no-auth\n' \
  -X POST localhost:8687/api/webhook/tautulli \
  -d 'rating_key=1&username=alice&action=watched'

curl -s -o /dev/null -w '%{http_code} missing-fields\n' \
  -X POST localhost:8687/api/webhook/tautulli \
  -H 'Content-Type: application/json' -d '{}'
```

Expected: `202 json-no-auth`, `202 form-no-auth`, `400 missing-fields`. The two 202s confirm the public allowlist covers this path — Tautulli cannot authenticate, so a 401 here would silently break every scrobble.

Stop the server, `rm -rf ./data`.

- [ ] **Step 4: Run the full suite and typecheck**

```bash
npm test && npm run typecheck
```

Expected: 22 tests pass, no type errors. The server half is now complete.

- [ ] **Step 5: Commit**

```bash
git add server/api/webhook server/api/test.post.ts
git commit -m "feat: add webhook and test endpoints with background processing"
```

---

### Task 11: Responsive app shell

Fixes the plan's headline mobile bug. `legacy/client/src/App.tsx:152` renders `<aside class="sticky top-0 flex h-screen w-56 shrink-0 …">` with no responsive class at all — a permanently visible 224px sidebar, leaving 151px of content on a 375px phone.

**Files:**
- Create: `app/layouts/default.vue`, `app/components/AppNav.vue`, `app/components/AccountMenu.vue`
- Reference: `legacy/client/src/App.tsx`

**Interfaces:**
- Consumes: `VERSION` from `shared/version`; `useAuthStore` is created in Task 12 — this task uses a temporary literal username and wires the store in Task 12 Step 5.
- Produces: `default` layout; `<AppNav />` and `<AccountMenu />` components.

- [ ] **Step 1: Write `app/components/AppNav.vue`**

Rendered by both the desktop rail and the mobile drawer so the two cannot drift out of sync.

```vue
<script setup lang="ts">
const items = [
  { label: 'Dashboard', icon: 'i-lucide-layout-dashboard', to: '/dashboard' },
  { label: 'Settings', icon: 'i-lucide-settings', to: '/settings' },
]
</script>

<template>
  <nav class="flex flex-col gap-1">
    <UButton
      v-for="item in items"
      :key="item.to"
      :to="item.to"
      :icon="item.icon"
      :label="item.label"
      color="neutral"
      variant="ghost"
      size="lg"
      class="justify-start min-h-11"
      active-class="bg-primary/15 text-primary"
    />
  </nav>
</template>
```

`min-h-11` is 44px — the mobile touch-target minimum from the constraints.

- [ ] **Step 2: Write `app/components/AccountMenu.vue`**

Ports the dropdown and change-password modal from `legacy/client/src/App.tsx:33-118`.

```vue
<script setup lang="ts">
const props = defineProps<{ username: string | null }>()
const emit = defineEmits<{ logout: [] }>()

const open = ref(false)
const current = ref('')
const next = ref('')
const confirm = ref('')
const busy = ref(false)
const toast = useToast()

const initials = computed(() => (props.username || '?').slice(0, 2).toUpperCase())

function reset() {
  current.value = ''
  next.value = ''
  confirm.value = ''
}

async function submit() {
  if (next.value !== confirm.value) {
    toast.add({ title: 'New passwords do not match.', color: 'error' })
    return
  }
  busy.value = true
  try {
    await $fetch('/api/auth/change-password', {
      method: 'POST',
      body: { current_password: current.value, new_password: next.value },
    })
    toast.add({ title: 'Password updated.', color: 'success' })
    open.value = false
    reset()
  } catch (e: any) {
    toast.add({ title: e?.data?.statusMessage || 'Could not update password.', color: 'error' })
  } finally {
    busy.value = false
  }
}

const menuItems = computed(() => [
  [{ label: props.username || 'Account', type: 'label' as const }],
  [
    { label: 'Change password', icon: 'i-lucide-lock', onSelect: () => (open.value = true) },
    { label: 'Log out', icon: 'i-lucide-log-out', onSelect: () => emit('logout') },
  ],
])
</script>

<template>
  <UDropdownMenu :items="menuItems">
    <UButton color="neutral" variant="ghost" class="min-h-11 gap-2.5">
      <UAvatar :alt="initials" size="sm" />
      <!-- Username is noise on a phone; the avatar carries the affordance. -->
      <span class="hidden sm:block max-w-35 truncate text-sm">{{ username }}</span>
      <UIcon name="i-lucide-chevron-down" class="size-4" />
    </UButton>
  </UDropdownMenu>

  <UModal v-model:open="open" title="Change password">
    <template #body>
      <div class="space-y-4">
        <UFormField label="Current password">
          <UInput v-model="current" type="password" autocomplete="current-password" class="w-full" />
        </UFormField>
        <UFormField label="New password" hint="At least 8 characters">
          <UInput v-model="next" type="password" autocomplete="new-password" class="w-full" />
        </UFormField>
        <UFormField label="Confirm new password">
          <UInput v-model="confirm" type="password" autocomplete="new-password" class="w-full" />
        </UFormField>
      </div>
    </template>
    <template #footer>
      <div class="flex justify-end gap-3">
        <UButton color="neutral" variant="ghost" label="Cancel" @click="open = false; reset()" />
        <UButton :loading="busy" label="Update password" @click="submit" />
      </div>
    </template>
  </UModal>
</template>
```

- [ ] **Step 3: Write `app/layouts/default.vue`**

The responsive shell. Rail at `lg` and above; below that the rail is hidden and the same nav lives in a `USlideover` opened by a header hamburger.

```vue
<script setup lang="ts">
import { VERSION } from '../../shared/version'

const drawer = ref(false)
const route = useRoute()

// Navigating from inside the drawer should close it.
watch(() => route.path, () => (drawer.value = false))

const title = computed(() => (route.path === '/settings' ? 'Settings' : 'Dashboard'))
</script>

<template>
  <div class="flex min-h-screen">
    <!-- Persistent rail, lg and up only. -->
    <aside class="hidden lg:flex sticky top-0 h-screen w-56 shrink-0 flex-col border-r border-default bg-elevated/30">
      <div class="flex items-center gap-3 px-5 py-4">
        <div class="grid size-9 place-items-center rounded-xl bg-primary text-lg font-bold text-inverted">S</div>
        <div class="text-sm font-semibold">Seenr Bridge</div>
      </div>
      <div class="mt-2 px-3">
        <AppNav />
      </div>
      <div class="mt-auto p-3 text-center text-[11px] text-muted">v{{ VERSION }}</div>
    </aside>

    <!-- Off-canvas nav, below lg. -->
    <USlideover v-model:open="drawer" side="left" title="Seenr Bridge">
      <template #body>
        <AppNav />
        <div class="mt-4 text-[11px] text-muted">v{{ VERSION }}</div>
      </template>
    </USlideover>

    <div class="flex min-w-0 flex-1 flex-col">
      <header class="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-default bg-default/80 px-4 py-3 backdrop-blur sm:px-6">
        <div class="flex min-w-0 items-center gap-2">
          <UButton
            class="lg:hidden min-h-11 min-w-11"
            icon="i-lucide-menu"
            color="neutral"
            variant="ghost"
            aria-label="Open navigation"
            @click="drawer = true"
          />
          <h1 class="truncate text-base font-semibold">{{ title }}</h1>
        </div>
        <AccountMenu :username="null" @logout="() => {}" />
      </header>

      <main class="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 sm:py-8">
        <slot />
      </main>
    </div>
  </div>
</template>
```

`AccountMenu`'s props are stubbed here; Task 12 Step 5 wires them to the auth store.

- [ ] **Step 4: Add placeholder pages so the layout renders**

`app/pages/dashboard.vue`:

```vue
<template>
  <div>Dashboard placeholder</div>
</template>
```

`app/pages/settings.vue`:

```vue
<template>
  <div>Settings placeholder</div>
</template>
```

`app/pages/index.vue` — `/` redirects to the dashboard:

```vue
<script setup lang="ts">
await navigateTo('/dashboard', { replace: true })
</script>

<template>
  <div />
</template>
```

- [ ] **Step 5: Verify the shell at all three widths**

```bash
npm run dev
```

Open `http://localhost:8687` and confirm:

- Redirects to `/dashboard`.
- **1280px** — rail visible, no hamburger.
- **768px** — rail hidden, hamburger visible; tapping it opens the drawer; clicking Settings navigates and closes the drawer.
- **375px** — same as 768px, and content is full-width rather than squeezed into 151px.
- At every width, no horizontal page scroll (`document.documentElement.scrollWidth === document.documentElement.clientWidth` in the console).

Stop the dev server.

- [ ] **Step 6: Commit**

```bash
git add app/layouts app/components/AppNav.vue app/components/AccountMenu.vue app/pages
git commit -m "feat: add responsive app shell with off-canvas nav below lg"
```

---

### Task 12: Auth store, route guard, and login page

First full vertical slice — after this you can log in through the UI.

**Files:**
- Create: `app/stores/auth.ts`, `app/middleware/auth.global.ts`, `app/pages/login.vue`
- Modify: `app/layouts/default.vue`
- Reference: `legacy/client/src/pages/Auth.tsx`, `legacy/client/src/App.tsx:20-31`

**Interfaces:**
- Consumes: `/api/auth/*` endpoints from Task 7.
- Produces: `useAuthStore()` with state `{ authenticated: boolean; username: string | null; needsSetup: boolean; ready: boolean }` and actions `fetchStatus()`, `login(u, p)`, `register(u, p)`, `logout()`.

- [ ] **Step 1: Write `app/stores/auth.ts`**

```ts
import { defineStore } from 'pinia'
import type { AuthStatus } from '../../shared/types'

export const useAuthStore = defineStore('auth', () => {
  const authenticated = ref(false)
  const username = ref<string | null>(null)
  const needsSetup = ref(false)
  // Distinguishes "not logged in" from "haven't checked yet", so the route
  // guard doesn't bounce to /login before the first status call lands.
  const ready = ref(false)

  function apply(s: AuthStatus) {
    authenticated.value = s.authenticated
    username.value = s.username
    needsSetup.value = s.needsSetup
  }

  async function fetchStatus() {
    try {
      apply(await $fetch<AuthStatus>('/api/auth/status'))
    } catch {
      apply({ authenticated: false, username: null, needsSetup: false })
    } finally {
      ready.value = true
    }
  }

  async function login(u: string, p: string) {
    apply(await $fetch<AuthStatus>('/api/auth/login', {
      method: 'POST',
      body: { username: u, password: p },
    }))
  }

  async function register(u: string, p: string) {
    apply(await $fetch<AuthStatus>('/api/auth/register', {
      method: 'POST',
      body: { username: u, password: p },
    }))
  }

  async function logout() {
    try {
      await $fetch('/api/auth/logout', { method: 'POST' })
    } finally {
      apply({ authenticated: false, username: null, needsSetup: false })
      await navigateTo('/login')
    }
  }

  return { authenticated, username, needsSetup, ready, fetchStatus, login, register, logout }
})
```

- [ ] **Step 2: Write `app/middleware/auth.global.ts`**

```ts
export default defineNuxtRouteMiddleware(async (to) => {
  const auth = useAuthStore()

  if (!auth.ready) await auth.fetchStatus()

  if (!auth.authenticated && to.path !== '/login') {
    return navigateTo('/login')
  }
  if (auth.authenticated && to.path === '/login') {
    return navigateTo('/dashboard')
  }
})
```

- [ ] **Step 3: Write `app/pages/login.vue`**

One page for both modes; `needsSetup` decides which. Ported from `legacy/client/src/pages/Auth.tsx`.

```vue
<script setup lang="ts">
import { VERSION } from '../../shared/version'

definePageMeta({ layout: false })

const auth = useAuthStore()
const username = ref('')
const password = ref('')
const confirm = ref('')
const busy = ref(false)
const error = ref<string | null>(null)

const isSetup = computed(() => auth.needsSetup)

async function submit() {
  error.value = null

  if (isSetup.value) {
    if (password.value.length < 8) {
      error.value = 'Password must be at least 8 characters.'
      return
    }
    if (password.value !== confirm.value) {
      error.value = 'Passwords do not match.'
      return
    }
  }

  busy.value = true
  try {
    if (isSetup.value) await auth.register(username.value, password.value)
    else await auth.login(username.value, password.value)
    await navigateTo('/dashboard')
  } catch (e: any) {
    error.value = e?.data?.statusMessage || 'Something went wrong.'
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="grid min-h-screen place-items-center p-4">
    <UCard class="w-full max-w-sm">
      <template #header>
        <div class="flex items-center gap-3">
          <div class="grid size-9 place-items-center rounded-xl bg-primary text-lg font-bold text-inverted">S</div>
          <div>
            <div class="text-sm font-semibold">Seenr Bridge</div>
            <div class="text-xs text-muted">
              {{ isSetup ? 'Create your account' : 'Sign in' }}
            </div>
          </div>
        </div>
      </template>

      <form class="space-y-4" @submit.prevent="submit">
        <UFormField label="Username">
          <UInput v-model="username" autocomplete="username" class="w-full" />
        </UFormField>

        <UFormField
          label="Password"
          :hint="isSetup ? 'At least 8 characters' : undefined"
        >
          <UInput
            v-model="password"
            type="password"
            :autocomplete="isSetup ? 'new-password' : 'current-password'"
            class="w-full"
          />
        </UFormField>

        <UFormField v-if="isSetup" label="Confirm password">
          <UInput v-model="confirm" type="password" autocomplete="new-password" class="w-full" />
        </UFormField>

        <UAlert v-if="error" color="error" variant="subtle" :description="error" />

        <UButton
          type="submit"
          :loading="busy"
          :label="isSetup ? 'Create account' : 'Sign in'"
          block
          class="min-h-11"
        />
      </form>

      <template #footer>
        <div class="text-center text-[11px] text-muted">v{{ VERSION }}</div>
      </template>
    </UCard>
  </div>
</template>
```

- [ ] **Step 4: Wire the store into the layout**

In `app/layouts/default.vue`, replace the `<AccountMenu :username="null" @logout="() => {}" />` line with:

```vue
        <AccountMenu :username="auth.username" @logout="auth.logout" />
```

and add to the `<script setup>` block, after the `VERSION` import:

```ts
const auth = useAuthStore()
```

- [ ] **Step 5: Verify the login flow**

```bash
rm -rf ./data && npm run dev
```

In a browser at `http://localhost:8687`:

1. Redirects to `/login` showing **Create your account** with a confirm field.
2. Submitting a password under 8 characters shows the inline error without a network call.
3. Mismatched passwords show "Passwords do not match."
4. A valid registration lands on `/dashboard` with the username in the account menu.
5. Reloading stays on `/dashboard` — the session cookie persists.
6. Log out → back to `/login`, now in **Sign in** mode with no confirm field.
7. Wrong credentials show "Wrong username or password."
8. Visiting `/settings` while logged out redirects to `/login`.
9. At 375px the card fits with no horizontal scroll.

Stop the dev server. Keep `./data` — the next tasks need a logged-in account.

- [ ] **Step 6: Commit**

```bash
git add app/stores/auth.ts app/middleware/auth.global.ts app/pages/login.vue app/layouts/default.vue
git commit -m "feat: add auth store, route guard, and login page"
```

---

### Task 13: Dashboard with mobile-reflowing event rows

**Files:**
- Create: `app/components/EventRow.vue`
- Modify: `app/pages/dashboard.vue`
- Reference: `legacy/client/src/pages/Dashboard.tsx`

**Interfaces:**
- Consumes: `/api/stats`, `/api/events`, `/api/image`; `ScrobbleEvent` and `Stats` from `shared/types`.
- Produces: `<EventRow :event="ScrobbleEvent" />`.

Not a `UTable`: each row has poster art, a status rail, and a click-to-expand JSON panel. Tables are also the worst offender for horizontal overflow on phones.

- [ ] **Step 1: Write `app/components/EventRow.vue`**

The reflow: at `sm` and up, status and timestamp sit in a right-hand column as today. Below `sm` they drop inline with the metadata, because the legacy layout leaves a ~180px title column on a 375px screen.

```vue
<script setup lang="ts">
import type { ScrobbleEvent } from '../../shared/types'

const props = defineProps<{ event: ScrobbleEvent }>()
const open = ref(false)

const derived = computed(() => {
  let main = props.event.title || 'Unknown'
  let sub = ''
  try {
    const m = props.event.payload ? JSON.parse(props.event.payload).Metadata : null
    if (m) {
      if (props.event.media_type === 'episode') {
        main = m.grandparentTitle || props.event.title || 'Unknown'
        sub = `S${m.parentIndex || '?'}·E${m.index || '?'}${m.title ? '  ·  ' + m.title : ''}`
      } else {
        main = m.title || props.event.title || 'Unknown'
        sub = String(m.year || '')
      }
    }
  } catch {
    // Malformed payload — fall back to the stored title.
  }
  return { main, sub }
})

const matchedBy = computed(() => {
  const ids = props.event.ids
  if (!ids?.length) return 'no ext id'
  return (ids.find((i) => i.startsWith('tmdb://')) || ids[0]!).replace('://', ' ')
})

const status = computed(() => {
  if (props.event.ok) return { label: 'checked in', color: 'success' as const, rail: 'bg-success' }
  if (props.event.seenr_status) {
    return { label: `seenr ${props.event.seenr_status}`, color: 'error' as const, rail: 'bg-error' }
  }
  return { label: 'failed', color: 'warning' as const, rail: 'bg-warning' }
})

const timeAgo = computed(() => {
  const s = Math.floor((Date.now() - props.event.ts) / 1000)
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return new Date(props.event.ts).toLocaleDateString()
})

const pretty = computed(() => {
  if (!props.event.payload) return '(no payload)'
  try {
    return JSON.stringify(JSON.parse(props.event.payload), null, 2)
  } catch {
    return props.event.payload
  }
})
</script>

<template>
  <div>
    <button
      type="button"
      class="relative flex w-full items-start gap-3 py-3 pl-4 pr-2 text-left transition hover:bg-elevated/50"
      :aria-expanded="open"
      @click="open = !open"
    >
      <span class="absolute inset-y-2.5 left-0 w-[3px] rounded-full" :class="status.rail" />

      <img
        v-if="event.image"
        :src="`/api/image?path=${encodeURIComponent(event.image)}`"
        alt=""
        loading="lazy"
        class="h-14 w-10 shrink-0 rounded-md object-cover ring-1 ring-default sm:h-16 sm:w-11"
      >
      <div
        v-else
        class="grid h-14 w-10 shrink-0 place-items-center rounded-md bg-elevated text-xs text-muted ring-1 ring-default sm:h-16 sm:w-11"
      >
        ?
      </div>

      <div class="min-w-0 flex-1">
        <div class="flex flex-wrap items-center gap-2">
          <h3 class="min-w-0 truncate text-[15px] font-semibold">{{ derived.main }}</h3>
          <UBadge
            :color="event.media_type === 'movie' ? 'info' : 'primary'"
            variant="subtle"
            size="sm"
            :label="event.media_type ?? 'unknown'"
          />
          <!-- Below sm the status pill joins this row instead of sitting
               in a right-hand column that would starve the title. -->
          <UBadge
            class="sm:hidden"
            :color="status.color"
            variant="subtle"
            size="sm"
            :label="status.label"
          />
        </div>

        <div v-if="derived.sub" class="mt-0.5 truncate text-sm text-muted">{{ derived.sub }}</div>

        <div class="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-dimmed">
          <span>{{ event.username }}</span>
          <code class="rounded bg-elevated px-1.5 py-0.5 font-mono text-[11px] ring-1 ring-default">{{ matchedBy }}</code>
          <span class="sm:hidden">{{ timeAgo }}</span>
        </div>
      </div>

      <div class="hidden shrink-0 flex-col items-end gap-1.5 pr-1 sm:flex">
        <UBadge :color="status.color" variant="subtle" size="sm" :label="status.label" />
        <span class="text-xs text-dimmed">{{ timeAgo }}</span>
      </div>
    </button>

    <div v-if="open" class="bg-elevated/40 px-4 pb-4">
      <UAlert v-if="event.error" color="error" variant="subtle" class="mb-2 mt-3" :description="event.error" />
      <div class="mb-1 pt-3 text-xs text-dimmed">
        rating_key {{ event.rating_key }} · event {{ event.event }} · ids: {{ event.ids.join(', ') || 'none' }}
      </div>
      <pre class="max-h-64 overflow-auto rounded-lg bg-default p-3 text-xs">{{ pretty }}</pre>
    </div>
  </div>
</template>
```

- [ ] **Step 2: Write `app/pages/dashboard.vue`**

Events and stats use `useAsyncData` rather than a store: page-local, refetched on view.

```vue
<script setup lang="ts">
import type { ScrobbleEvent, Stats } from '../../shared/types'

const limit = ref(25)

const { data: stats, refresh: refreshStats } = await useAsyncData<Stats>(
  'stats',
  () => $fetch('/api/stats'),
)

const { data: events, refresh: refreshEvents, error } = await useAsyncData<ScrobbleEvent[]>(
  'events',
  () => $fetch('/api/events', { query: { limit: limit.value } }),
  { watch: [limit] },
)

function refresh() {
  refreshStats()
  refreshEvents()
}

// Live view: the legacy dashboard polled every 5s.
let timer: ReturnType<typeof setInterval> | undefined
onMounted(() => { timer = setInterval(refresh, 5000) })
onBeforeUnmount(() => clearInterval(timer))

const tiles = computed(() => [
  { label: 'Total', icon: 'i-lucide-layers', value: stats.value?.total ?? '—', class: '' },
  { label: 'Episodes', icon: 'i-lucide-tv', value: stats.value?.episodes ?? '—', class: 'text-primary' },
  { label: 'Movies', icon: 'i-lucide-film', value: stats.value?.movies ?? '—', class: 'text-info' },
  { label: 'Users', icon: 'i-lucide-users', value: stats.value?.users ?? '—', class: 'text-success' },
])

const remaining = computed(() =>
  Math.max(0, (stats.value?.total ?? 0) - (events.value?.length ?? 0)),
)
</script>

<template>
  <div class="space-y-6">
    <!-- 2-up on phones, 4-up from sm. -->
    <div class="grid grid-cols-2 gap-4 sm:grid-cols-4">
      <UCard v-for="t in tiles" :key="t.label" :ui="{ body: 'px-4 py-3 sm:px-5 sm:py-4' }">
        <div class="flex items-center gap-2 text-xs uppercase tracking-wider text-muted">
          <UIcon :name="t.icon" class="size-4" />
          <span class="truncate">{{ t.label }}</span>
        </div>
        <div class="mt-2 text-2xl font-semibold sm:text-3xl" :class="t.class">{{ t.value }}</div>
      </UCard>
    </div>

    <UCard :ui="{ body: 'p-0 sm:p-0' }">
      <template #header>
        <div class="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 class="text-sm font-semibold">Recent scrobbles</h2>
            <p class="mt-0.5 text-xs text-muted">Live — refreshes every 5s</p>
          </div>
          <UButton
            color="neutral"
            variant="ghost"
            label="Refresh"
            icon="i-lucide-refresh-cw"
            class="min-h-11"
            @click="refresh"
          />
        </div>
      </template>

      <UAlert
        v-if="error"
        color="error"
        variant="subtle"
        class="m-4"
        :description="error.message"
      />

      <div v-if="!events?.length" class="px-4 py-12 text-center text-sm text-muted">
        No scrobbles yet. Point a Tautulli webhook at
        <code class="text-default">/api/webhook/tautulli</code> and play something.
      </div>

      <div v-else class="divide-y divide-default">
        <EventRow v-for="e in events" :key="e.id" :event="e" />
      </div>

      <template v-if="remaining > 0" #footer>
        <div class="text-center">
          <UButton
            color="neutral"
            variant="ghost"
            class="min-h-11"
            :label="`Load more · ${remaining} older`"
            @click="limit += 25"
          />
        </div>
      </template>
    </UCard>
  </div>
</template>
```

- [ ] **Step 3: Seed an event so the list is not empty**

The dashboard is hard to judge empty. Insert one failing event directly — no Tautulli needed.

```bash
npm run dev
```

Second shell (this 202s and then fails in the background because Tautulli is unconfigured, which is exactly the row we want to inspect):

```bash
curl -s -X POST localhost:8687/api/webhook/tautulli \
  -H 'Content-Type: application/json' \
  -d '{"rating_key":"12345","username":"alice","action":"watched"}'
```

- [ ] **Step 4: Verify the dashboard at all three widths**

In the browser on `/dashboard`:

- **1280px** — 4 stat tiles across; event row shows poster, title, badge, and a right-hand column with status above the timestamp.
- **768px** — unchanged from 1280 for the row layout; tiles still 4-up.
- **375px** — tiles are 2×2; the right-hand column is gone, with the status badge inline beside the media-type badge and the timestamp on the username row. Title is legible, not crushed.
- Clicking a row expands the JSON panel; the panel scrolls internally and does not widen the page.
- `document.documentElement.scrollWidth === document.documentElement.clientWidth` is `true` at all three widths.

Stop the dev server.

- [ ] **Step 5: Commit**

```bash
git add app/components/EventRow.vue app/pages/dashboard.vue
git commit -m "feat: add dashboard with mobile-reflowing event rows"
```

---

### Task 14: Settings page, settings store, and status poll

The largest page — `legacy/client/src/pages/Settings.tsx` is 380 lines.

**Files:**
- Create: `app/stores/settings.ts`, `app/stores/status.ts`, `app/components/CopyField.vue`, `app/components/SetupStep.vue`
- Modify: `app/pages/settings.vue`, `app/layouts/default.vue`
- Reference: `legacy/client/src/pages/Settings.tsx`

**Interfaces:**
- Produces: `useSettingsStore()` with state `{ settings: Settings | null; mappings: Mapping[]; tautulliUsers: string[] }` and actions `fetch()`, `save(patch)`, `saveMapping(m)`, `removeMapping(id)`, `testTautulli(patch?)`, `syncWebhook(triggers)`, `fetchTautulliUsers()`. `useStatusStore()` with state `{ tautulli: { ok, message } | null; webhook: boolean; users: number }` and actions `refresh()`, `start()`, `stop()`.

- [ ] **Step 1: Write `app/stores/status.ts`**

One timer replaces the legacy duplication, where the sidebar polled `POST /api/settings/test-tautulli` every 30s while the Settings page separately called `GET /api/status`, which tests the connection again.

```ts
import { defineStore } from 'pinia'
import type { Status } from '../../shared/types'

export const useStatusStore = defineStore('status', () => {
  const tautulli = ref<Status['tautulli'] | null>(null)
  const webhook = ref(false)
  const users = ref(0)

  let timer: ReturnType<typeof setInterval> | undefined
  let subscribers = 0

  async function refresh() {
    try {
      const s = await $fetch<Status>('/api/status')
      tautulli.value = s.tautulli
      webhook.value = s.webhook
      users.value = s.users
    } catch {
      tautulli.value = { ok: false, message: 'unreachable' }
      webhook.value = false
    }
  }

  // Reference-counted so the layout and the Settings page can both depend on
  // the poll without ever running two intervals.
  function start() {
    subscribers++
    if (timer) return
    refresh()
    timer = setInterval(refresh, 30_000)
  }

  function stop() {
    subscribers = Math.max(0, subscribers - 1)
    if (subscribers === 0 && timer) {
      clearInterval(timer)
      timer = undefined
    }
  }

  return { tautulli, webhook, users, refresh, start, stop }
})
```

- [ ] **Step 2: Write `app/stores/settings.ts`**

```ts
import { defineStore } from 'pinia'
import type { Settings, Mapping, SyncResult } from '../../shared/types'

export const useSettingsStore = defineStore('settings', () => {
  const settings = ref<Settings | null>(null)
  const mappings = ref<Mapping[]>([])
  const tautulliUsers = ref<string[]>([])

  async function fetch() {
    const [s, m] = await Promise.all([
      $fetch<Settings>('/api/settings'),
      $fetch<Mapping[]>('/api/mappings'),
    ])
    settings.value = s
    mappings.value = m
  }

  async function save(patch: Partial<Settings>) {
    settings.value = await $fetch<Settings>('/api/settings', { method: 'PUT', body: patch })
  }

  async function saveMapping(m: {
    username: string
    seenr_token: string
    enabled?: boolean
    sync_movies?: boolean
    sync_episodes?: boolean
  }) {
    await $fetch<Mapping>('/api/mappings', { method: 'POST', body: m })
    mappings.value = await $fetch<Mapping[]>('/api/mappings')
  }

  async function removeMapping(id: number) {
    await $fetch(`/api/mappings/${id}`, { method: 'DELETE' })
    mappings.value = mappings.value.filter((m) => m.id !== id)
  }

  function testTautulli(patch?: Partial<Settings>) {
    return $fetch<{ ok: boolean; message: string }>('/api/settings/test-tautulli', {
      method: 'POST',
      body: patch ?? {},
    })
  }

  function syncWebhook(triggers: string[]) {
    return $fetch<SyncResult>('/api/tautulli/sync-webhook', {
      method: 'POST',
      body: { triggers },
    })
  }

  async function fetchTautulliUsers() {
    const r = await $fetch<{ ok: boolean; users: string[] }>('/api/tautulli/users')
    tautulliUsers.value = r.users
  }

  return {
    settings, mappings, tautulliUsers,
    fetch, save, saveMapping, removeMapping, testTautulli, syncWebhook, fetchTautulliUsers,
  }
})
```

- [ ] **Step 3: Write `app/components/SetupStep.vue`**

```vue
<script setup lang="ts">
defineProps<{ n: number; title: string; hint?: string }>()
</script>

<template>
  <UCard>
    <template #header>
      <div class="flex items-start gap-3">
        <span class="grid size-7 shrink-0 place-items-center rounded-full bg-primary/15 text-xs font-semibold text-primary">
          {{ n }}
        </span>
        <div class="min-w-0">
          <h2 class="text-sm font-semibold">{{ title }}</h2>
          <p v-if="hint" class="mt-0.5 text-xs text-muted">{{ hint }}</p>
        </div>
      </div>
    </template>
    <slot />
  </UCard>
</template>
```

- [ ] **Step 4: Write `app/components/CopyField.vue`**

The value must scroll inside its own box rather than widening the page — the legacy version used `overflow-x-auto` for exactly this.

```vue
<script setup lang="ts">
const props = defineProps<{ label: string; value: string; hint?: string }>()
const copied = ref(false)
const toast = useToast()

async function copy() {
  try {
    await navigator.clipboard.writeText(props.value)
    copied.value = true
    setTimeout(() => (copied.value = false), 1500)
  } catch {
    toast.add({ title: 'Could not copy to clipboard', color: 'error' })
  }
}
</script>

<template>
  <div>
    <div class="mb-1.5 text-sm font-medium">{{ label }}</div>
    <div class="flex items-stretch gap-2">
      <code class="min-w-0 flex-1 overflow-x-auto whitespace-pre rounded-lg bg-elevated px-3 py-2 font-mono text-xs ring-1 ring-default">{{ value }}</code>
      <UButton
        :color="copied ? 'success' : 'neutral'"
        :variant="copied ? 'solid' : 'ghost'"
        :label="copied ? 'Copied' : 'Copy'"
        class="min-h-11 shrink-0"
        @click="copy"
      />
    </div>
    <div v-if="hint" class="mt-1 text-xs text-muted">{{ hint }}</div>
  </div>
</template>
```

- [ ] **Step 5: Write `app/pages/settings.vue`**

```vue
<script setup lang="ts">
import type { Mapping } from '../../shared/types'

const store = useSettingsStore()
const status = useStatusStore()
const toast = useToast()

await store.fetch()

onMounted(() => {
  status.start()
  store.fetchTautulliUsers().catch(() => {})
})
onBeforeUnmount(() => status.stop())

const TRIGGERS = [
  { key: 'watched', label: 'Watched', recommended: true },
  { key: 'play', label: 'Play' },
  { key: 'stop', label: 'Stop' },
  { key: 'pause', label: 'Pause' },
  { key: 'resume', label: 'Resume' },
]
const selectedTriggers = ref<string[]>(['watched'])

const saving = ref(false)
const syncing = ref(false)
const newUser = ref('')
const newToken = ref('')
const edit = ref<Mapping | null>(null)
const advanced = ref(false)
const manual = ref(false)

const webhookUrl = computed(() => {
  const base = (store.settings?.bridge_url || window.location.origin).replace(/\/+$/, '')
  return `${base}/api/webhook/tautulli`
})

const availableUsers = computed(() => {
  const taken = new Set(store.mappings.map((m) => m.username.toLowerCase()))
  return store.tautulliUsers.filter((u) => !taken.has(u.toLowerCase()))
})

function syncSummary(m: Mapping) {
  if (m.sync_episodes && m.sync_movies) return 'TV + Movies'
  if (m.sync_episodes) return 'TV only'
  if (m.sync_movies) return 'Movies only'
  return 'nothing selected'
}

async function saveConnection() {
  saving.value = true
  try {
    await store.save({
      tautulli_url: store.settings!.tautulli_url,
      tautulli_apikey: store.settings!.tautulli_apikey,
    })
    toast.add({ title: 'Saved.', color: 'success' })
    status.refresh()
    store.fetchTautulliUsers().catch(() => {})
  } catch (e: any) {
    toast.add({ title: e?.data?.statusMessage || 'Could not save.', color: 'error' })
  } finally {
    saving.value = false
  }
}

async function testConnection() {
  const r = await store.testTautulli({
    tautulli_url: store.settings!.tautulli_url,
    tautulli_apikey: store.settings!.tautulli_apikey,
  })
  toast.add({ title: r.message, color: r.ok ? 'success' : 'error' })
}

async function addMapping() {
  if (!newUser.value.trim() || !newToken.value.trim()) {
    toast.add({ title: 'Username and token are both required.', color: 'error' })
    return
  }
  try {
    await store.saveMapping({ username: newUser.value.trim(), seenr_token: newToken.value.trim() })
    newUser.value = ''
    newToken.value = ''
    toast.add({ title: 'User mapped.', color: 'success' })
  } catch (e: any) {
    toast.add({ title: e?.data?.statusMessage || 'Could not add user.', color: 'error' })
  }
}

async function saveEdit() {
  if (!edit.value) return
  await store.saveMapping({
    username: edit.value.username,
    seenr_token: edit.value.seenr_token,
    enabled: edit.value.enabled,
    sync_movies: edit.value.sync_movies,
    sync_episodes: edit.value.sync_episodes,
  })
  edit.value = null
  toast.add({ title: 'Updated.', color: 'success' })
}

async function removeEdit() {
  if (!edit.value) return
  await store.removeMapping(edit.value.id)
  edit.value = null
  toast.add({ title: 'Removed.', color: 'success' })
}

async function runSync() {
  syncing.value = true
  try {
    const r = await store.syncWebhook(selectedTriggers.value)
    toast.add({
      title: r.created ? 'Webhook created in Tautulli.' : 'Webhook updated in Tautulli.',
      color: 'success',
    })
    status.refresh()
  } catch (e: any) {
    toast.add({ title: e?.data?.statusMessage || 'Sync failed.', color: 'error' })
  } finally {
    syncing.value = false
  }
}

async function saveAdvanced() {
  await store.save({
    forward_enabled: store.settings!.forward_enabled,
    seenr_base_url: store.settings!.seenr_base_url,
    bridge_url: store.settings!.bridge_url,
  })
  toast.add({ title: 'Saved.', color: 'success' })
}
</script>

<template>
  <div v-if="store.settings" class="space-y-4">
    <!-- Status line: wraps rather than overflowing on narrow screens. -->
    <div class="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
      <span class="flex items-center gap-1.5">
        <span
          class="size-1.5 rounded-full"
          :class="status.tautulli === null ? 'bg-muted' : status.tautulli.ok ? 'bg-success' : 'bg-error'"
        />
        <span class="text-muted">
          {{ status.tautulli === null ? 'checking…' : status.tautulli.ok ? 'Tautulli connected' : 'Tautulli offline' }}
        </span>
      </span>
      <span class="text-dimmed">{{ status.users }} {{ status.users === 1 ? 'user' : 'users' }}</span>
      <span class="flex items-center gap-1.5">
        <span class="size-1.5 rounded-full" :class="status.webhook ? 'bg-success' : 'bg-error'" />
        <span class="text-muted">{{ status.webhook ? 'webhook active' : 'no webhook' }}</span>
      </span>
    </div>

    <SetupStep :n="1" title="Connect Tautulli" hint="where the bridge reads episode IDs">
      <div class="grid gap-4 sm:grid-cols-2">
        <UFormField label="Tautulli URL" hint="e.g. http://tautulli:8181">
          <UInput v-model="store.settings.tautulli_url" placeholder="http://tautulli:8181" class="w-full" />
        </UFormField>
        <UFormField label="API key" hint="Tautulli → Settings → Web Interface → API key">
          <UInput v-model="store.settings.tautulli_apikey" type="password" placeholder="xxxxxxxx" class="w-full" />
        </UFormField>
      </div>
      <div class="mt-4 flex flex-wrap gap-3">
        <UButton color="neutral" variant="ghost" label="Test connection" class="min-h-11" @click="testConnection" />
        <UButton :loading="saving" label="Save" class="min-h-11" @click="saveConnection" />
      </div>
    </SetupStep>

    <SetupStep :n="2" title="Map users to seenr" hint="each Plex user → their seenr token">
      <div class="space-y-2">
        <p v-if="!store.mappings.length" class="text-sm text-muted">No users yet. Add one below.</p>

        <!-- Stacks below sm so the Configure button never squeezes the token. -->
        <div
          v-for="m in store.mappings"
          :key="m.id"
          class="flex flex-col gap-2 rounded-lg bg-elevated/40 px-3 py-2.5 ring-1 ring-default sm:flex-row sm:items-center sm:gap-3"
        >
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-2 text-sm font-medium">
              <span class="truncate">{{ m.username }}</span>
              <UBadge v-if="!m.enabled" color="neutral" variant="subtle" size="sm" label="paused" />
            </div>
            <div class="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-dimmed">
              <span class="font-mono">{{ m.seenr_token.slice(0, 8) }}…{{ m.seenr_token.slice(-6) }}</span>
              <span>·</span>
              <span>{{ syncSummary(m) }}</span>
            </div>
          </div>
          <UButton
            color="neutral"
            variant="ghost"
            label="Configure"
            class="min-h-11 self-start sm:self-auto"
            @click="edit = { ...m }"
          />
        </div>
      </div>

      <div class="mt-4 grid gap-3 sm:grid-cols-[1fr_2fr_auto] sm:items-end">
        <UFormField label="Plex username">
          <!-- Free text still allowed, so manual entry works when Tautulli
               is unreachable. -->
          <USelectMenu
            v-model="newUser"
            :items="availableUsers"
            create-item
            placeholder="Select or type…"
            class="w-full"
          />
        </UFormField>
        <UFormField label="seenr token" hint="the part after /scrobble/plex/ in your seenr URL">
          <UInput v-model="newToken" placeholder="9%7CyourSeenrToken" class="w-full" />
        </UFormField>
        <UButton label="Add" class="min-h-11" @click="addMapping" />
      </div>
    </SetupStep>

    <SetupStep :n="3" title="Send Tautulli's events here" hint="one webhook, covers every user">
      <div class="mb-4">
        <div class="mb-2.5 text-sm font-medium">Triggers to enable</div>
        <div class="flex flex-wrap gap-x-5 gap-y-3">
          <UCheckbox
            v-for="t in TRIGGERS"
            :key="t.key"
            v-model="selectedTriggers"
            :value="t.key"
            :label="t.label"
            class="min-h-11 items-center"
          >
            <template v-if="t.recommended" #description>
              <UBadge color="success" variant="subtle" size="sm" label="recommended" />
            </template>
          </UCheckbox>
        </div>
      </div>

      <UButton :loading="syncing" label="Sync to Tautulli" class="min-h-11" @click="runSync" />

      <UCollapsible v-model:open="manual" class="mt-4">
        <UButton
          color="neutral"
          variant="ghost"
          class="min-h-11"
          trailing-icon="i-lucide-chevron-down"
          label="Set it up manually instead"
        />
        <template #content>
          <div class="space-y-3 pt-3">
            <CopyField label="Webhook URL" :value="webhookUrl" />
            <CopyField label="Method" value="POST" />
            <CopyField label="Headers" :value="'{&quot;Content-Type&quot;: &quot;application/json&quot;}'" />
            <CopyField
              label="JSON body"
              :value="'{&quot;action&quot;: &quot;{action}&quot;, &quot;rating_key&quot;: &quot;{rating_key}&quot;, &quot;username&quot;: &quot;{username}&quot;}'"
              hint="Paste into a Tautulli Webhook agent for each trigger you enable."
            />
          </div>
        </template>
      </UCollapsible>
    </SetupStep>

    <UCollapsible v-model:open="advanced">
      <UButton
        color="neutral"
        variant="ghost"
        class="min-h-11"
        trailing-icon="i-lucide-chevron-down"
        label="Advanced"
      />
      <template #content>
        <UCard class="mt-2">
          <div class="space-y-4">
            <div class="flex items-center justify-between gap-3">
              <div class="min-w-0">
                <div class="text-sm font-medium">Forward to seenr</div>
                <p class="text-xs text-muted">Master switch for all forwarding.</p>
              </div>
              <USwitch v-model="store.settings.forward_enabled" />
            </div>
            <UFormField label="seenr base URL" hint="each user's token is appended to this">
              <UInput v-model="store.settings.seenr_base_url" class="w-full" />
            </UFormField>
            <UFormField
              label="Bridge public URL"
              hint="blank = auto-detect; set only behind a reverse proxy"
            >
              <UInput v-model="store.settings.bridge_url" placeholder="https://bridge.example.com" class="w-full" />
            </UFormField>
            <UButton label="Save" class="min-h-11" @click="saveAdvanced" />
          </div>
        </UCard>
      </template>
    </UCollapsible>

    <UModal
      :open="!!edit"
      :title="edit ? `Configure ${edit.username}` : ''"
      @update:open="(v) => { if (!v) edit = null }"
    >
      <template #body>
        <div v-if="edit" class="space-y-4">
          <UFormField label="seenr token">
            <UInput v-model="edit.seenr_token" class="w-full" />
          </UFormField>
          <div class="flex items-center justify-between gap-3">
            <span class="text-sm">Enabled</span>
            <USwitch v-model="edit.enabled" />
          </div>
          <div class="flex items-center justify-between gap-3">
            <span class="text-sm">TV episodes</span>
            <USwitch v-model="edit.sync_episodes" />
          </div>
          <div class="flex items-center justify-between gap-3">
            <span class="text-sm">Movies</span>
            <USwitch v-model="edit.sync_movies" />
          </div>
        </div>
      </template>
      <template #footer>
        <div class="flex w-full flex-wrap justify-between gap-3">
          <UButton color="error" variant="ghost" label="Remove" class="min-h-11" @click="removeEdit" />
          <div class="flex gap-3">
            <UButton color="neutral" variant="ghost" label="Cancel" class="min-h-11" @click="edit = null" />
            <UButton label="Save" class="min-h-11" @click="saveEdit" />
          </div>
        </div>
      </template>
    </UModal>
  </div>
</template>
```

- [ ] **Step 6: Point the layout's status dot at the store**

The rail currently shows only a version string. Add the shared Tautulli indicator, reusing the single poll. In `app/layouts/default.vue`, add to `<script setup>`:

```ts
const status = useStatusStore()
onMounted(() => status.start())
onBeforeUnmount(() => status.stop())
```

and replace the rail's version line:

```vue
      <div class="mt-auto space-y-2 p-3">
        <div class="flex items-center gap-2 rounded-lg bg-elevated/40 px-3 py-2.5">
          <span
            class="size-1.5 shrink-0 rounded-full"
            :class="status.tautulli === null ? 'bg-muted' : status.tautulli.ok ? 'bg-success' : 'bg-error'"
          />
          <span class="truncate text-xs text-muted">
            {{ status.tautulli === null ? 'Checking Tautulli…' : status.tautulli.ok ? 'Tautulli connected' : 'Tautulli unreachable' }}
          </span>
        </div>
        <div class="text-center text-[11px] text-muted">v{{ VERSION }}</div>
      </div>
```

- [ ] **Step 7: Verify the settings page**

```bash
npm run dev
```

On `/settings`:

- Saving a Tautulli URL and key shows a success toast; the status dots update.
- **Test connection** toasts the failure message for an unreachable host.
- Adding a mapping with a typed username works even with Tautulli offline (proving `create-item` free text).
- **Configure** opens the modal; toggling Movies off and saving shows "Movies only" in the row summary.
- **Sync to Tautulli** with Tautulli offline shows an error toast rather than a blank failure.
- **Advanced** expands; toggling **Forward to seenr** off and saving persists across a reload.
- **375px:** every step card fits; the mapping row stacks with Configure below the token; the add-mapping grid stacks; the webhook URL in the manual section scrolls inside its own box; no horizontal page scroll.
- Open the Network tab for 60s on `/settings`: exactly two `/api/status` calls (t=0 and t=30s), confirming one shared interval rather than two.

Stop the dev server.

- [ ] **Step 8: Commit**

```bash
git add app/stores/settings.ts app/stores/status.ts app/components/CopyField.vue app/components/SetupStep.vue app/pages/settings.vue app/layouts/default.vue
git commit -m "feat: add settings page with shared status poll"
```

---

### Task 15: Docker, Compose, and CI

**Files:**
- Create: `Dockerfile`, `docker-compose.yml`, `docker-compose.build.yml`, `docker-compose.dev.yml`
- Verify: `.github/workflows/docker-publish.yml` (expected to need no changes)

- [ ] **Step 1: Write the Dockerfile**

Two stages instead of three, because there is one build now. Both stages share a base image so the compiled native binding copies across cleanly.

```dockerfile
# ---------- build ----------
FROM node:22-bookworm-slim AS build
WORKDIR /app

# better-sqlite3 compiles from source when no prebuilt binary matches.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# ---------- runtime ----------
FROM node:22-bookworm-slim
WORKDIR /app

ENV NODE_ENV=production \
    PORT=8687 \
    DATA_DIR=/app/data

# .output is self-contained: bundled server, static client, and the
# externalised better-sqlite3 with its native binding.
COPY --from=build /app/.output ./.output

RUN mkdir -p /app/data
EXPOSE 8687
CMD ["node", ".output/server/index.mjs"]
```

- [ ] **Step 2: Write `docker-compose.yml`**

```yaml
services:
  seenr-bridge:
    image: ghcr.io/isntw/seenr-bridge:latest
    container_name: seenr-bridge
    restart: unless-stopped
    ports:
      - "8687:8687"
    volumes:
      - ./data:/app/data
```

- [ ] **Step 3: Write `docker-compose.build.yml`**

```yaml
services:
  seenr-bridge:
    build: .
    container_name: seenr-bridge
    restart: unless-stopped
    ports:
      - "8687:8687"
    volumes:
      - ./data:/app/data
```

- [ ] **Step 4: Write `docker-compose.dev.yml`**

One service instead of two — no separate client container, no Vite proxy.

```yaml
# Dev stack: single container, hot reload, source mounted.
#   UI + API: http://<host>:8687
services:
  seenr-bridge:
    image: node:22-bookworm-slim
    container_name: seenr-bridge-dev
    working_dir: /app
    environment:
      - DATA_DIR=/app/data
      - PORT=8687
    ports:
      - "8687:8687"
    volumes:
      - .:/app
      - node_modules:/app/node_modules
    command: bash -lc "apt-get update -qq && apt-get install -y -qq python3 make g++ >/dev/null 2>&1; npm install && npm run dev -- --host 0.0.0.0"

volumes:
  node_modules:
```

- [ ] **Step 5: Build the image and verify it runs**

The real test of the native module under a production build, in a clean container.

```bash
docker build -t seenr-bridge:test .
docker run --rm -d --name sb-test -p 8687:8687 -v "$PWD/data-docker:/app/data" seenr-bridge:test
sleep 4
curl -s localhost:8687/api/health
curl -s -o /dev/null -w '%{http_code} spa-root\n' localhost:8687/
curl -s -o /dev/null -w '%{http_code} gated\n' localhost:8687/api/settings
docker logs sb-test
docker rm -f sb-test && rm -rf data-docker
```

Expected: `{"ok":true,"version":"2.0.0"}`, `200 spa-root`, `401 gated`, and logs free of `better-sqlite3` or `MODULE_NOT_FOUND` errors.

- [ ] **Step 6: Confirm the CI workflow still applies**

Read `.github/workflows/docker-publish.yml`. It builds with `context: .` and pushes to ghcr — no paths reference `client/` or `server/`, so no change is expected. If it does reference either, update those lines only.

- [ ] **Step 7: Commit**

```bash
git add Dockerfile docker-compose.yml docker-compose.build.yml docker-compose.dev.yml
git commit -m "feat: single-stage-per-half Docker build and one-service dev compose"
```

---

### Task 16: Remove legacy source and rewrite documentation

**Files:**
- Delete: `legacy/`
- Modify: `nuxt.config.ts`, `tsconfig.json`, `.dockerignore`, `README.md`, `CLAUDE.md`
- Replace: `docs/dashboard.png`

- [ ] **Step 1: Confirm nothing still references `legacy/`**

```bash
grep -rn "legacy/" --include='*.ts' --include='*.vue' --include='*.json' --include='*.yml' . \
  | grep -v node_modules | grep -v '^./docs/'
```

Expected: only the `ignore` line in `nuxt.config.ts`, the `exclude` line in `tsconfig.json`, and the `.dockerignore` entry. Any hit in `app/`, `server/`, or `shared/` is a real import that must be fixed before deleting.

- [ ] **Step 2: Delete the legacy tree and its ignore entries**

```bash
git rm -r -q legacy
```

In `nuxt.config.ts`, remove:

```ts
  ignore: ['legacy/**'],
```

In `tsconfig.json`, change `"exclude"` to:

```json
  "exclude": ["node_modules", ".output"]
```

In `.dockerignore`, remove the `legacy` line.

- [ ] **Step 3: Verify the app still builds and tests pass without `legacy/`**

```bash
npm test && npm run typecheck && npm run build
```

Expected: 22 tests pass, no type errors, build succeeds.

- [ ] **Step 4: Rewrite `README.md`**

Keep the "Why it exists" section, the ASCII data-flow diagram, the Features list, Requirements, First run, Setup, Advanced settings, How matching works, Security, and Data & backup sections — all still accurate. Update these:

- **Version badge** — `version-2.0.0`.
- **Stack** — replace the last line with: `Nuxt 4 + Vue 3 + Nuxt UI + Pinia (client) · Nitro + better-sqlite3 + TypeScript (server) · Docker.`
- **Development** — replace the whole section with:

````markdown
## Development

One install, one process, one port — the API and UI are served from the same origin in dev and production alike:

```bash
npm install
npm run dev        # http://localhost:8687
```

Or in Docker:

```bash
docker compose -f docker-compose.dev.yml up -d
```

Tests and typecheck:

```bash
npm test
npm run typecheck
```
````

- **API reference table** — unchanged paths, but add a note that `/api/auth/change-password` now requires a session.
- **Versioning** — change `server/src/version.ts` to `shared/version.ts`.

- [ ] **Step 5: Rewrite `CLAUDE.md`**

Its Architecture, Commands, and "Conventions that will bite you" sections describe the Express/React structure and are now wrong wholesale. Rewrite to cover:

- **Commands** — `npm run dev`, `build`, `test`, `typecheck`, `start`; note the single port 8687 and that `npm test` runs Vitest over `tests/**`.
- **Architecture** — Nuxt 4 with `app/` as srcDir, Nitro handlers in `server/api/`, domain logic in `server/utils/`, wire contract in `shared/types/`, SPA mode and why.
- **Conventions that still bite:**
  - `server/utils/*` must use explicit relative imports, never Nitro auto-imports, or the Vitest suite cannot resolve them.
  - `useDb()` caches on `globalThis` because Nitro re-evaluates modules on HMR.
  - The server middleware early-returns for non-`/api/` paths; without it the entire UI 401s.
  - `shared/types` is the wire shape (booleans); `0`/`1` stays behind `*ToWire()` in `server/utils/db.ts`.
  - Adding a public endpoint means adding it to `PUBLIC_API_PATHS` in `server/utils/auth.ts`.
  - The webhook returns 202 and processes detached, so failures surface only in the `events` table.
  - `shared/version.ts` is the version source of truth.
  - `/api/image` must keep its `/library/metadata/` prefix check — it is what stops the endpoint becoming an open proxy authenticated with the user's Tautulli API key.
- **Delete** the now-obsolete gotchas: the `settingsToJson`/`mappingToJson` boolean reminder (superseded by typed `*ToWire()`), the `client/src/types.ts` drift warning (eliminated by `shared/`), and the stale-`package.json`-version note (there is one `package.json` now).

Note that the vestigial `settings.sync_movies`/`sync_episodes` columns are still vestigial — the pipeline gates only on the per-mapping flags. That warning stays.

- [ ] **Step 6: Reshoot the dashboard screenshot**

```bash
npm run dev
```

Capture `/dashboard` at 1280px wide with at least one scrobble row visible, and save over `docs/dashboard.png`. Stop the dev server.

- [ ] **Step 7: Final full verification**

```bash
npm test && npm run typecheck && npm run build && docker build -t seenr-bridge:final .
```

Expected: all green.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "chore: remove legacy source and rewrite docs for the Nuxt stack"
```

---

## Self-Review

**Spec coverage.** Walked every spec section against the task list:

| Spec section | Task |
|---|---|
| Stack | 1 |
| Directory layout | 1, and the rest as each file lands |
| `shared/types` wire boundary | 2 |
| `shared/version.ts` | 1, consumed 11–12 |
| Endpoint mapping table (21 endpoints) | 7, 8, 9, 10 |
| DB singleton across HMR | 1 (skeleton), 2 (migrate hook) |
| 202-then-background webhook | 10 |
| Auth model + middleware + allowlist | 6, 7 |
| Client routing with real URLs | 11 |
| Nuxt UI component mapping | 11, 13, 14 |
| Theming (violet/slate, forced dark) | 1 |
| Three Pinia stores | 12 (auth), 14 (settings, status) |
| Shared status poll dedup | 14 |
| Responsive shell | 11 |
| Event row reflow | 13 |
| Touch targets / no horizontal scroll | 11, 13, 14 |
| Docker two-stage, `PUBLIC_DIR` gone | 15 |
| Dev loop collapse | 15 |
| CI unchanged | 15 |
| `createError` + `$fetch`, `req()` deleted | 8–10 server, 12–14 client |
| Three Vitest files | 2, 3, 5 |
| Docs to update | 16 |
| Out of scope items | none — correctly absent |

No gaps found.

**Placeholder scan.** No "TBD", "add error handling", or "similar to Task N". The verbatim ports in Tasks 2, 4, and 5 name an exact source file and enumerate every adaptation, rather than saying "port it".

**Type consistency.** Checked the names that cross task boundaries:

- `ScrobbleEvent` (wire) vs `EventRowDb` (row) vs `EventRow.vue` (component) — three distinct names, no collision. Defined Task 2, consumed Tasks 9 and 13.
- `settingsToWire` / `mappingToWire` / `eventToWire` — defined Task 2, used Tasks 8, 9.
- `useDb()` / `closeDb()` — defined Task 1, used Tasks 2, 3, 5.
- `PUBLIC_API_PATHS` — defined Task 6 `server/utils/auth.ts`, consumed Task 6 middleware.
- `processEvent(input, opts)` — defined Task 5, consumed Task 10.
- Store action names: `auth.fetchStatus/login/register/logout` (Task 12, used 11's layout via Task 12 Step 4); `settings.fetch/save/saveMapping/removeMapping/testTautulli/syncWebhook/fetchTautulliUsers` (Task 14); `status.refresh/start/stop` (Task 14, used in both `settings.vue` and `default.vue`).
- One ordering dependency made explicit rather than left implicit: Task 11's layout renders `<AccountMenu :username="null">` because `useAuthStore` does not exist until Task 12, which rewires it in Step 4.

One issue found and fixed inline while reviewing: Task 11 originally imported `useAuthStore` before Task 12 created it, which would have failed typecheck. It now stubs the props and Task 12 Step 4 wires them.

---

**Plan complete and saved to `docs/superpowers/plans/2026-07-26-nuxt-conversion.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
