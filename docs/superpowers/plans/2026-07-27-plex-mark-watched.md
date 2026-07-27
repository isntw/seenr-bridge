# Plex Mark-Watched Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a title flagged as shared is watched, also mark it watched in Plex for the co-watching profiles.

**Architecture:** A new `server/utils/plex.ts` talks to the Plex Media Server (`/:/scrobble`) and to plex.tv (`shared_servers`, OAuth PIN). Watched state in Plex belongs to an *account*, so the `X-Plex-Token` on the request is not authentication — it selects whose copy changes. One owner token is stored; each co-watcher's token is discovered from plex.tv and held in memory only. The write happens inside the existing `deliverToMapping()` in `pipeline.ts`, gated by a per-share `plex_sync` flag, with the trigger user excluded.

**Tech Stack:** Nuxt 4 (SPA, `ssr: false`), Nitro server routes, better-sqlite3, Vitest, Nuxt UI v4.

**Spec:** `docs/superpowers/specs/2026-07-27-plex-mark-watched-design.md`

## Global Constraints

- **There is no linter.** `npm run typecheck` is the only static check; `npm test` (Vitest) is the only test runner. Both must pass before every commit.
- **`server/utils/*` must use explicit relative imports, never Nitro auto-imports.** `server/api/*` and `server/middleware/*` deliberately DO use auto-imports. The spec files import `server/utils` modules directly, so mixing the styles inside `server/utils/` breaks test resolution.
- **Check every new `server/utils` export name against h3/Nitro auto-imports.** `npm run typecheck` surfaces collisions as `WARN Duplicated imports`. This is why `getSessionByToken` and `setSessionCookie` are named as they are.
- **`shared/types` is the wire shape** — real `boolean`s. The SQLite `0`/`1` representation stays behind `settingsToWire` / `mappingToWire` / `sharedTitleToWire` / `eventToWire` in `db.ts`.
- **Migrations are append-only `PRAGMA table_info` guards** at the bottom of `db.ts`. A new column needs: the `CREATE TABLE` extended, a matching `ALTER TABLE` guard, the row interface, and — for settings — `getSettings`'s explicit column list plus `saveSettings`'s UPDATE.
- **Grep `.nuxt/components.d.ts` for any Nuxt UI component used here for the first time.** A misspelled component name passes both `typecheck` and `build`, then renders nothing.
- **Never commit to `main`.** Work on branch `feat/plex-mark-watched` (already created) and open a PR. `.github/workflows/pr-checks.yml` runs `npm test` and `npm run typecheck`, and fails the PR when app code changes without a `shared/version.ts` bump *and* a matching `## X.Y.Z` section in `CHANGELOG.md`. Task 9 does both — do not bump earlier.
- **No network calls in any spec.** Stub `global.fetch` with `vi.stubGlobal`, as `tests/tautulli.spec.ts` does.
- Exact endpoint strings, verbatim: `/:/scrobble?key=<ratingKey>&identifier=com.plexapp.plugins.library` on the PMS; `https://plex.tv/api/servers/<machineId>/shared_servers` for per-user tokens; `https://plex.tv/api/v2/pins` for the OAuth PIN pair.

---

## File Structure

| File | Responsibility |
|---|---|
| `server/utils/plex.ts` | **new** — all Plex/plex.tv HTTP. Server discovery, `/:/scrobble`, `shared_servers` parsing, token cache, OAuth PIN pair. No db imports. |
| `server/utils/db.ts` | five new columns, two new query functions, `plex_token` threaded through `upsertMapping` |
| `server/utils/pipeline.ts` | `deliverToMapping()` gains an options object and performs the Plex write; `processEvent()` / `backfillSharedTitle()` resolve the target once |
| `shared/types/index.ts` | wire contract additions |
| `server/api/plex/pin.post.ts` | **new** — start the OAuth login |
| `server/api/plex/pin/[id].get.ts` | **new** — poll it; saves the token server-side |
| `server/api/plex/users.get.ts` | **new** — matched/unmatched report for Settings |
| `server/api/settings/index.put.ts` | accept `plex_token` |
| `server/api/mappings/index.post.ts` | accept `plex_token` |
| `server/api/shared/index.put.ts` | accept `plex_sync` |
| `app/pages/settings.vue` | new Plex `SetupStep`; `plex_token` override in the Configure modal |
| `app/components/SharedTitleModal.vue` | the per-title `plex_sync` checkbox |
| `app/pages/shared.vue` | thread `plex_sync` through save and edit |
| `app/utils/shared-row.ts` | `plex_sync` on both interfaces |
| `app/utils/event-group.ts` | `plex_status` on `EventRecipient` |
| `app/components/EventRow.vue` | Plex outcome on the recipient badge |
| `tests/plex.spec.ts` | **new** |
| `tests/db.spec.ts`, `tests/pipeline.spec.ts`, `tests/event-group.spec.ts` | extended |

---

### Task 0: Verification spike (throwaway, not committed)

Two facts hold up this entire feature and documentation cannot settle either. Confirm both against the live server before writing any production code. **If either fails, stop and report — do not work around it.**

**Files:**
- Create: `/tmp/plex-spike.mjs` (throwaway — must NOT be committed)

- [ ] **Step 1: Write the spike script**

Fill in the four constants from the running instance. `TAUTULLI_KEY` is in Settings → Tautulli → API key; `PLEX_OWNER_TOKEN` comes from any Plex Web item's "Get Info → View XML" URL.

```javascript
// /tmp/plex-spike.mjs — throwaway. Confirms the two unproven mechanics.
const TAUTULLI_URL = 'http://tautulli:8181'
const TAUTULLI_KEY = '...'
const PLEX_OWNER_TOKEN = '...'
const TEST_EPISODE_RATING_KEY = '...'   // one episode a co-watcher has NOT watched

const info = await (await fetch(
  `${TAUTULLI_URL}/api/v2?apikey=${TAUTULLI_KEY}&cmd=get_server_info`
)).json()
const { pms_identifier, pms_url, pms_ip, pms_port, pms_ssl } = info.response.data
console.log('machineId:', pms_identifier)
console.log('pms_url  :', pms_url, '| ip/port/ssl:', pms_ip, pms_port, pms_ssl)

const xml = await (await fetch(
  `https://plex.tv/api/servers/${pms_identifier}/shared_servers?X-Plex-Token=${PLEX_OWNER_TOKEN}`
)).text()
console.log('\n--- shared_servers ---\n', xml.slice(0, 4000))

for (const tag of xml.match(/<SharedServer\b[^>]*>/g) ?? []) {
  console.log('user:', /\busername="([^"]*)"/.exec(tag)?.[1],
              '| token?', /\baccessToken="([^"]*)"/.exec(tag)?.[1] ? 'YES' : 'NO')
}

const token = /\baccessToken="([^"]+)"/.exec(xml)?.[1]
if (!token) {
  console.log('\nFAIL: no accessToken in shared_servers — co-watchers are likely home/managed profiles.')
} else {
  const res = await fetch(
    `${pms_url}/:/scrobble?key=${TEST_EPISODE_RATING_KEY}&identifier=com.plexapp.plugins.library`,
    { headers: { 'X-Plex-Token': token, accept: 'application/json' } },
  )
  console.log('\nscrobble HTTP', res.status, res.status < 300 ? '(check that user\'s Plex now)' : '(FAIL)')
}
```

- [ ] **Step 2: Run it**

Run: `node /tmp/plex-spike.mjs`

Record three answers:
1. Does every co-watching username appear in `shared_servers` **with** an `accessToken`? If some are missing, they are home/managed profiles and rely on the manual override (Task 7) — note which.
2. Did the scrobble return 2xx, and did that user's Plex actually flip to watched? **Verify in their Plex client, not just the status code.**
3. Is `pms_url` present in `get_server_info`, or must it be rebuilt from `pms_ip`/`pms_port`/`pms_ssl`?

- [ ] **Step 3: Confirm no feedback loop**

Open the bridge Dashboard and Tautulli's history. Confirm the step-2 scrobble produced **no** new Tautulli history row and **no** new bridge event. `/:/scrobble` creates no playback session, so none is expected — but this is the assumption that would cause an infinite fan-out if wrong.

- [ ] **Step 4: Delete the spike**

Run: `rm /tmp/plex-spike.mjs`
Expected: nothing to commit — `git status` clean.

---

### Task 1: Schema and wire contract

**Files:**
- Modify: `server/utils/db.ts` (CREATE TABLE block ~lines 42-110, migration guards ~lines 112-151, row interfaces ~lines 153-190, `*ToWire` ~lines 199-242, `getSettings`/`saveSettings` ~lines 244-279, `upsertMapping` ~lines 291-306, shared-title section ~lines 318-421)
- Modify: `shared/types/index.ts`
- Test: `tests/db.spec.ts`

**Interfaces:**
- Consumes: nothing (first task)
- Produces:
  - `SettingsRow.plex_token: string`, `MappingRow.plex_token: string`, `SharedTitleRow.plex_sync: number`, `EventRowDb.plex_status: number | null`
  - `getPlexClientId(): string`
  - `getSharedTitle(rating_key: string): SharedTitleRow | undefined`
  - `upsertMapping(username, seenr_token, enabled, sync_movies?, sync_episodes?, plex_token?)`
  - `setSharedTitle(t: { …; plex_sync?: number }, profiles: number[])`
  - Wire: `Settings.plex_token: string`, `Mapping.plex_token: string`, `SharedTitle.plex_sync: boolean`, `ScrobbleEvent.plex_status: number | null`

- [ ] **Step 1: Write the failing tests**

Append to `tests/db.spec.ts`:

```typescript
describe('plex columns', () => {
  it('defaults plex_token to empty and generates a stable client id on demand', async () => {
    const db = await freshDb()
    expect(db.getSettings().plex_token).toBe('')

    const id = db.getPlexClientId()
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
    // Creating a PIN and polling it must present the SAME identifier, so this
    // must not regenerate on each call.
    expect(db.getPlexClientId()).toBe(id)
  })

  it('round-trips plex_token through settings and the wire boundary', async () => {
    const db = await freshDb()
    db.saveSettings({ plex_token: 'owner-tok' })
    expect(db.getSettings().plex_token).toBe('owner-tok')
    expect(db.settingsToWire(db.getSettings()).plex_token).toBe('owner-tok')
  })

  it('does not leak plex_client_id onto the wire', async () => {
    const db = await freshDb()
    db.getPlexClientId()
    expect(Object.keys(db.settingsToWire(db.getSettings()))).not.toContain('plex_client_id')
  })

  it('defaults a share to plex_sync OFF so an upgrade writes to nobody', async () => {
    const db = await freshDb()
    const m = db.upsertMapping('alice', 'tok', 1, 1, 1)
    db.setSharedTitle({ rating_key: '999', media_type: 'show' }, [m.id])

    expect(db.getSharedTitle('999')!.plex_sync).toBe(0)
    expect(db.listSharedTitles()[0]!.plex_sync).toBe(false)
  })

  it('stores plex_sync and converts it to a boolean on the wire', async () => {
    const db = await freshDb()
    const m = db.upsertMapping('alice', 'tok', 1, 1, 1)
    db.setSharedTitle({ rating_key: '999', media_type: 'show', plex_sync: 1 }, [m.id])

    expect(db.getSharedTitle('999')!.plex_sync).toBe(1)
    expect(db.listSharedTitles()[0]!.plex_sync).toBe(true)
  })

  it('turns plex_sync back off on a later save (plain assignment, not COALESCE)', async () => {
    const db = await freshDb()
    const m = db.upsertMapping('alice', 'tok', 1, 1, 1)
    db.setSharedTitle({ rating_key: '999', media_type: 'show', plex_sync: 1 }, [m.id])
    db.setSharedTitle({ rating_key: '999', media_type: 'show', plex_sync: 0 }, [m.id])

    expect(db.getSharedTitle('999')!.plex_sync).toBe(0)
  })

  it('returns undefined for a share that does not exist', async () => {
    const db = await freshDb()
    expect(db.getSharedTitle('nope')).toBeUndefined()
  })

  it('stores a per-mapping plex token override', async () => {
    const db = await freshDb()
    const m = db.upsertMapping('alice', 'tok', 1, 1, 1, 'plex-override')
    expect(m.plex_token).toBe('plex-override')
    expect(db.mappingToWire(m).plex_token).toBe('plex-override')
  })

  it('defaults a mapping plex token to empty', async () => {
    const db = await freshDb()
    expect(db.upsertMapping('bob', 'tok', 1, 1, 1).plex_token).toBe('')
  })

  it('records plex_status on an event and passes it through eventToWire', async () => {
    const db = await freshDb()
    db.insertEvent({
      ts: 1, action: 'watched', event: 'media.scrobble', username: 'alice',
      media_type: 'episode', title: 'Ozymandias', rating_key: '12345', ids: '[]',
      image: null, series_key: '999', seenr_status: 200, plex_status: 200,
      ok: 1, error: null, payload: null,
    })

    const row = db.listEvents(1)[0]!
    expect(row.plex_status).toBe(200)
    expect(db.eventToWire(row).plex_status).toBe(200)
  })
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run tests/db.spec.ts -t "plex columns"`
Expected: FAIL — `db.getPlexClientId is not a function`, `db.getSharedTitle is not a function`, and type errors on `plex_token` / `plex_sync` / `plex_status`.

- [ ] **Step 3: Extend the CREATE TABLE block**

In `server/utils/db.ts`, inside `migrate()`'s `db.exec()` template, add the columns to the three existing definitions (the guards in step 4 handle databases created before this change):

```sql
CREATE TABLE IF NOT EXISTS mappings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  seenr_token TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  plex_token TEXT NOT NULL DEFAULT ''
);
```

Add `plex_status INTEGER` to the `events` table, and `plex_sync INTEGER NOT NULL DEFAULT 0` to `shared_titles`. Leave the `settings` CREATE TABLE alone — its two new columns are added by guard only, matching how `bridge_url` and `libraries` are already handled there.

- [ ] **Step 4: Add the migration guards**

Append to the guard section at the bottom of `migrate()`, beside the existing ones:

```typescript
  if (!settingsCols.includes('plex_token'))
    db.exec("ALTER TABLE settings ADD COLUMN plex_token TEXT NOT NULL DEFAULT ''")
  // The X-Plex-Client-Identifier for the OAuth PIN flow. Deliberately NOT part of
  // SettingsRow: creating a PIN and polling it must present the same value, which
  // makes this infrastructure state rather than something an operator sets. Kept
  // off the wire so it is never shipped to a browser.
  if (!settingsCols.includes('plex_client_id'))
    db.exec("ALTER TABLE settings ADD COLUMN plex_client_id TEXT NOT NULL DEFAULT ''")

  if (!mappingCols.includes('plex_token'))
    db.exec("ALTER TABLE mappings ADD COLUMN plex_token TEXT NOT NULL DEFAULT ''")

  if (!eventCols.includes('plex_status'))
    db.exec('ALTER TABLE events ADD COLUMN plex_status INTEGER')

  // Defaults to 0, deliberately inverting the "empty means all" convention that
  // settings.libraries uses. That convention is safe because it only ever widens
  // forwarding; this one writes into OTHER PEOPLE'S Plex libraries, so an upgrade
  // must not start doing that to titles shared months ago.
  if (!sharedCols.includes('plex_sync'))
    db.exec('ALTER TABLE shared_titles ADD COLUMN plex_sync INTEGER NOT NULL DEFAULT 0')
```

- [ ] **Step 5: Thread the columns through the row interfaces and wire boundary**

`SettingsRow` gains `plex_token: string` (**not** `plex_client_id`). `MappingRow` gains `plex_token: string`. `SharedTitleRow` gains `plex_sync: number`. `EventRowDb` gains `plex_status: number | null`.

`getSettings`'s explicit column list becomes:

```typescript
      'SELECT tautulli_url, tautulli_apikey, seenr_base_url, forward_enabled, bridge_url, sync_movies, sync_episodes, libraries, plex_token FROM settings WHERE id = 1',
```

`saveSettings` gains `plex_token: s.plex_token ?? cur.plex_token` in `next` and `plex_token=?` in the UPDATE, with `next.plex_token` in the matching `.run()` position.

`sharedTitleToWire` gains `plex_sync: !!r.plex_sync`. `settingsToWire`, `mappingToWire` and `eventToWire` need no new lines — `plex_token` and `plex_status` pass through their spreads unchanged.

- [ ] **Step 6: Add the two new query functions**

Add beside the other settings helpers:

```typescript
/** The stable X-Plex-Client-Identifier for the OAuth PIN flow, generated on first
 *  use. Separate from getSettings because the PIN create and PIN poll calls must
 *  present the SAME identifier or plex.tv never hands back a token. */
export function getPlexClientId(): string {
  const db = useDb()
  const row = db.prepare('SELECT plex_client_id FROM settings WHERE id = 1').get() as {
    plex_client_id: string
  }
  if (row.plex_client_id) return row.plex_client_id

  const id = crypto.randomUUID()
  db.prepare('UPDATE settings SET plex_client_id = ? WHERE id = 1').run(id)
  return id
}
```

Add beside `getSharedRecipients`:

```typescript
/** The share row itself. getSharedRecipients answers "who co-watches this"; this
 *  answers "how is the share configured" — which the pipeline needs for plex_sync. */
export function getSharedTitle(rating_key: string): SharedTitleRow | undefined {
  return useDb()
    .prepare('SELECT * FROM shared_titles WHERE rating_key = ?')
    .get(rating_key) as SharedTitleRow | undefined
}
```

- [ ] **Step 7: Thread plex_token and plex_sync through the writers**

`upsertMapping` gains a sixth parameter. Note the hazard and precedent:

```typescript
export function upsertMapping(
  username: string,
  seenr_token: string,
  enabled: number,
  sync_movies = 1,
  sync_episodes = 1,
  // A caller that omits this RESETS the stored override, exactly as omitting
  // sync_movies resets that flag. The UI always sends the whole mapping back, and
  // the Add form omitting it is correct — a new mapping has no override.
  plex_token = '',
): MappingRow {
  useDb()
    .prepare(
      `INSERT INTO mappings (username, seenr_token, enabled, sync_movies, sync_episodes, plex_token)
       VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(username) DO UPDATE SET seenr_token=excluded.seenr_token, enabled=excluded.enabled,
       sync_movies=excluded.sync_movies, sync_episodes=excluded.sync_episodes,
       plex_token=excluded.plex_token`,
    )
    .run(username, seenr_token, enabled, sync_movies, sync_episodes, plex_token)
  return getMappingByUsername(username)!
}
```

`setSharedTitle`'s `t` parameter gains `plex_sync?: number` (0/1, matching `upsertMapping`'s style rather than the wire's booleans). Add it to the INSERT column list, to the `VALUES` placeholders, to `.run()` as `t.plex_sync ?? 0`, and to the conflict clause as **plain assignment**:

```sql
       ON CONFLICT(rating_key) DO UPDATE SET media_type=excluded.media_type, title=excluded.title,
         year=excluded.year, image=excluded.image, plex_sync=excluded.plex_sync,
         section_id=COALESCE(excluded.section_id, shared_titles.section_id),
         library_name=COALESCE(excluded.library_name, shared_titles.library_name)
```

`plex_sync` is a plain assignment, not `COALESCE` like the library columns, because both the add flow and the edit modal always carry the checkbox state — so an absent value means "off", not "unknown".

- [ ] **Step 8: Update the wire contract**

In `shared/types/index.ts`: `Settings` gains `plex_token: string`; `Mapping` gains `plex_token: string`; `SharedTitle` gains `plex_sync: boolean`; `ScrobbleEvent` gains `plex_status: number | null`.

- [ ] **Step 9: Run the tests**

Run: `npx vitest run tests/db.spec.ts && npm run typecheck`
Expected: PASS. Typecheck will flag the three `insertEvent` call sites in `pipeline.ts` for the missing `plex_status` — add `plex_status: null` to each for now; Task 4 gives them real values.

- [ ] **Step 10: Commit**

```bash
git add server/utils/db.ts server/utils/pipeline.ts shared/types/index.ts tests/db.spec.ts
git commit -m "feat(db): add plex token, per-share plex_sync and event plex_status columns"
```

---

### Task 2: Plex server discovery and the scrobble call

**Files:**
- Create: `server/utils/plex.ts`
- Test: `tests/plex.spec.ts` (create)

**Interfaces:**
- Consumes: nothing from Task 1 (`plex.ts` imports no db types on purpose — it stays a pure HTTP client)
- Produces:
  - `interface PlexServer { url: string; machineId: string }`
  - `getPlexServer(tautulliUrl: string, apiKey: string): Promise<PlexServer>`
  - `markWatched(plexUrl: string, token: string, ratingKey: string): Promise<number>`

- [ ] **Step 1: Write the failing tests**

Create `tests/plex.spec.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { getPlexServer, markWatched } from '../server/utils/plex'

const fetchMock = vi.fn()

function tautulliOk(data: unknown) {
  return { ok: true, json: async () => ({ response: { result: 'success', data } }) } as unknown as Response
}

const SERVER_INFO = {
  pms_identifier: 'abc123machine',
  pms_url: 'http://10.0.0.5:32400',
  pms_ip: '10.0.0.5',
  pms_port: 32400,
  pms_ssl: 0,
}

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('getPlexServer', () => {
  it('reads the address and machine identifier from Tautulli', async () => {
    fetchMock.mockResolvedValue(tautulliOk(SERVER_INFO))

    await expect(getPlexServer('http://taut:8181', 'key')).resolves.toEqual({
      url: 'http://10.0.0.5:32400',
      machineId: 'abc123machine',
    })
  })

  it('asks Tautulli for get_server_info', async () => {
    fetchMock.mockResolvedValue(tautulliOk(SERVER_INFO))

    await getPlexServer('http://taut:8181/', 'k3y')

    expect(String(fetchMock.mock.calls[0]![0])).toContain('cmd=get_server_info')
    expect(String(fetchMock.mock.calls[0]![0])).toBe(
      'http://taut:8181/api/v2?apikey=k3y&cmd=get_server_info',
    )
  })

  it('strips a trailing slash from pms_url', async () => {
    fetchMock.mockResolvedValue(tautulliOk({ ...SERVER_INFO, pms_url: 'http://10.0.0.5:32400/' }))

    const s = await getPlexServer('http://taut:8181', 'key')
    expect(s.url).toBe('http://10.0.0.5:32400')
  })

  it('rebuilds the address from ip/port/ssl when pms_url is absent', async () => {
    fetchMock.mockResolvedValue(
      tautulliOk({ pms_identifier: 'm', pms_ip: '10.0.0.9', pms_port: 32400, pms_ssl: 1 }),
    )

    const s = await getPlexServer('http://taut:8181', 'key')
    expect(s.url).toBe('https://10.0.0.9:32400')
  })

  it('throws when Tautulli reports no machine identifier', async () => {
    fetchMock.mockResolvedValue(tautulliOk({ pms_url: 'http://10.0.0.5:32400' }))

    await expect(getPlexServer('http://taut:8181', 'key')).rejects.toThrow('machine identifier')
  })

  it('throws when the address is unusable', async () => {
    fetchMock.mockResolvedValue(tautulliOk({ pms_identifier: 'm', pms_ip: '', pms_port: '' }))

    await expect(getPlexServer('http://taut:8181', 'key')).rejects.toThrow('usable Plex address')
  })

  it('throws on an HTTP error from Tautulli', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 502 } as unknown as Response)

    await expect(getPlexServer('http://taut:8181', 'key')).rejects.toThrow('Tautulli HTTP 502')
  })
})

describe('markWatched', () => {
  it('calls /:/scrobble with the rating key, the library identifier and the token', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200 } as unknown as Response)

    const status = await markWatched('http://10.0.0.5:32400', 'ana-token', '12345')

    expect(status).toBe(200)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(
      'http://10.0.0.5:32400/:/scrobble?key=12345&identifier=com.plexapp.plugins.library',
    )
    // The token is not authentication here — it selects WHOSE copy is marked.
    expect((init.headers as Record<string, string>)['X-Plex-Token']).toBe('ana-token')
  })

  it('returns a non-2xx status instead of throwing, so it can be recorded', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 401 } as unknown as Response)

    await expect(markWatched('http://plex:32400', 'stale', '1')).resolves.toBe(401)
  })

  it('tolerates a trailing slash on the server address', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200 } as unknown as Response)

    await markWatched('http://plex:32400/', 'tok', '7')

    expect(String(fetchMock.mock.calls[0]![0])).toBe(
      'http://plex:32400/:/scrobble?key=7&identifier=com.plexapp.plugins.library',
    )
  })
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run tests/plex.spec.ts`
Expected: FAIL — cannot resolve `../server/utils/plex`.

- [ ] **Step 3: Create the module**

Create `server/utils/plex.ts`. **Explicit relative imports only** — no Nitro auto-imports:

```typescript
// Plex client. Two very different servers live behind this one module: the local
// Plex Media Server (watched state) and plex.tv (per-user tokens, OAuth).
//
// The load-bearing fact: watched state in Plex belongs to an ACCOUNT, not to an
// item, and the X-Plex-Token on a request is the only thing that selects which
// account. So the token passed to markWatched() is not authentication — it is the
// choice of whose copy is marked. There is no admin impersonation parameter.

// Tautulli wraps every reply in the same envelope; only `data` varies by command.
interface TautulliResponse<T> {
  response?: {
    result?: string
    message?: string
    data?: T
  }
}

interface PmsServerInfo {
  pms_identifier?: string
  pms_url?: string
  pms_ip?: string
  pms_port?: string | number
  pms_ssl?: string | number
}

export interface PlexServer {
  /** Base URL of the Plex Media Server, no trailing slash. */
  url: string
  /** The PMS machineIdentifier — plex.tv keys shared_servers on it. */
  machineId: string
}

function base(url: string): string {
  return url.replace(/\/+$/, '')
}

// Derived from Tautulli rather than configured: the bridge already holds a working
// Tautulli connection, and get_server_info reports both the PMS address and its
// machineIdentifier — so this feature asks the operator for no new URL.
export async function getPlexServer(tautulliUrl: string, apiKey: string): Promise<PlexServer> {
  const u = `${base(tautulliUrl)}/api/v2?apikey=${encodeURIComponent(apiKey)}&cmd=get_server_info`
  const res = await fetch(u)
  if (!res.ok) throw new Error(`Tautulli HTTP ${res.status}`)

  const json = (await res.json()) as TautulliResponse<PmsServerInfo>
  const d = json?.response?.data

  const machineId = d?.pms_identifier ? String(d.pms_identifier) : ''
  if (!machineId) throw new Error('Tautulli did not report the Plex machine identifier')

  // pms_url is present on current Tautulli; rebuild from the parts if it is not.
  const url = d?.pms_url
    ? base(String(d.pms_url))
    : `${Number(d?.pms_ssl) ? 'https' : 'http'}://${d?.pms_ip ?? ''}:${d?.pms_port ?? 32400}`
  if (!/^https?:\/\/[^:/]+(:\d+)?$/.test(url))
    throw new Error('Tautulli did not report a usable Plex address')

  return { url, machineId }
}

/** Mark one item watched for the account the token belongs to. Returns the HTTP
 *  status rather than throwing on a non-2xx, so the caller can record it on the
 *  event row instead of losing it. */
export async function markWatched(plexUrl: string, token: string, ratingKey: string): Promise<number> {
  const u = `${base(plexUrl)}/:/scrobble?key=${encodeURIComponent(ratingKey)}&identifier=com.plexapp.plugins.library`
  const res = await fetch(u, {
    headers: { 'X-Plex-Token': token, accept: 'application/json' },
  })
  return res.status
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/plex.spec.ts && npm run typecheck`
Expected: PASS. If typecheck emits `WARN Duplicated imports` for `getPlexServer` or `markWatched`, rename to avoid the h3/Nitro collision.

- [ ] **Step 5: Commit**

```bash
git add server/utils/plex.ts tests/plex.spec.ts
git commit -m "feat(plex): add server discovery and the /:/scrobble mark-watched call"
```

---

### Task 3: Per-user token discovery and caching

**Files:**
- Modify: `server/utils/plex.ts`
- Test: `tests/plex.spec.ts`

**Interfaces:**
- Consumes: `base()` and the `PlexServer` type from Task 2
- Produces:
  - `parseSharedServers(xml: string): Map<string, string>` (lowercased username → token)
  - `getSharedTokens(machineId: string, ownerToken: string): Promise<Map<string, string>>`
  - `resolvePlexToken(username: string, override: string, machineId: string, ownerToken: string): Promise<string | null>`
  - `resetPlexTokenCache(): void`

- [ ] **Step 1: Write the failing tests**

Append to `tests/plex.spec.ts` (and add the four new names to the import at the top):

```typescript
// plex.tv answers this endpoint in XML — the only XML in this codebase.
const SHARED_SERVERS_XML = `<?xml version="1.0" encoding="UTF-8"?>
<MediaContainer friendlyName="myPlex" identifier="com.plexapp.plugins.myplex">
  <SharedServer id="1" username="Ana" email="ana@example.com" userID="111" accessToken="ana-tok" acceptedAt="1600000000">
    <Section id="10" key="1" title="Movies" type="movie" shared="1"/>
  </SharedServer>
  <SharedServer id="2" username="mihai" email="m@example.com" userID="222" accessToken="mihai-tok">
    <Section id="11" key="2" title="TV Shows" type="show" shared="1"/>
  </SharedServer>
  <SharedServer id="3" username="" email="" userID="333" accessToken="managed-tok"/>
  <SharedServer id="4" username="notoken" email="n@example.com" userID="444" accessToken=""/>
</MediaContainer>`

describe('parseSharedServers', () => {
  it('maps usernames to access tokens, lowercased', () => {
    const out = parseSharedServers(SHARED_SERVERS_XML)

    // Lowercased because mapping usernames match COLLATE NOCASE in SQLite.
    expect(out.get('ana')).toBe('ana-tok')
    expect(out.get('mihai')).toBe('mihai-tok')
  })

  it('drops entries with no username — home profiles rely on the manual override', () => {
    expect([...parseSharedServers(SHARED_SERVERS_XML).values()]).not.toContain('managed-tok')
  })

  it('drops entries with an empty accessToken', () => {
    expect(parseSharedServers(SHARED_SERVERS_XML).has('notoken')).toBe(false)
  })

  it('returns an empty map for XML with no shared users', () => {
    expect(parseSharedServers('<MediaContainer size="0"/>').size).toBe(0)
  })

  it('returns an empty map for junk input rather than throwing', () => {
    expect(parseSharedServers('not xml at all').size).toBe(0)
  })
})

describe('getSharedTokens', () => {
  it('requests shared_servers for the machine id with the owner token', async () => {
    fetchMock.mockResolvedValue({ ok: true, text: async () => SHARED_SERVERS_XML } as unknown as Response)

    const out = await getSharedTokens('abc123machine', 'owner-tok')

    expect(String(fetchMock.mock.calls[0]![0])).toBe(
      'https://plex.tv/api/servers/abc123machine/shared_servers?X-Plex-Token=owner-tok',
    )
    expect(out.get('ana')).toBe('ana-tok')
  })

  it('throws on an HTTP error from plex.tv', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 401 } as unknown as Response)

    await expect(getSharedTokens('m', 'bad')).rejects.toThrow('plex.tv HTTP 401')
  })
})

describe('resolvePlexToken', () => {
  beforeEach(() => resetPlexTokenCache())

  function sharedServersReply() {
    fetchMock.mockResolvedValue({ ok: true, text: async () => SHARED_SERVERS_XML } as unknown as Response)
  }

  it('prefers a manual override without calling plex.tv at all', async () => {
    sharedServersReply()

    await expect(resolvePlexToken('ana', 'manual-tok', 'm', 'owner')).resolves.toBe('manual-tok')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('discovers a token by username, case-insensitively', async () => {
    sharedServersReply()

    await expect(resolvePlexToken('ANA', '', 'm', 'owner')).resolves.toBe('ana-tok')
  })

  it('returns null for a user plex.tv does not list', async () => {
    sharedServersReply()

    await expect(resolvePlexToken('nobody', '', 'm', 'owner')).resolves.toBeNull()
  })

  it('returns null without a lookup when no owner token is configured', async () => {
    await expect(resolvePlexToken('ana', '', 'm', '')).resolves.toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('caches the lookup across users, so a fan-out costs one plex.tv call', async () => {
    sharedServersReply()

    await resolvePlexToken('ana', '', 'm', 'owner')
    await resolvePlexToken('mihai', '', 'm', 'owner')

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('re-fetches after the cache is reset', async () => {
    sharedServersReply()

    await resolvePlexToken('ana', '', 'm', 'owner')
    resetPlexTokenCache()
    await resolvePlexToken('ana', '', 'm', 'owner')

    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run tests/plex.spec.ts -t "parseSharedServers"`
Expected: FAIL — `parseSharedServers` is not exported.

- [ ] **Step 3: Implement discovery and the cache**

Append to `server/utils/plex.ts`:

```typescript
const PLEX_TV = 'https://plex.tv'

/** plex.tv answers shared_servers in XML — the only XML this codebase parses. Taken
 *  apart with a regex over the SharedServer open tags rather than pulling in an XML
 *  dependency for one endpoint.
 *
 *  Keys are lowercased because mapping usernames are matched COLLATE NOCASE in
 *  SQLite, so the two lookups must agree on case. Entries with no username are
 *  skipped: those are home/managed profiles, which plex.tv does not name here and
 *  which rely on the per-mapping manual override instead. */
export function parseSharedServers(xml: string): Map<string, string> {
  const out = new Map<string, string>()
  for (const tag of xml.match(/<SharedServer\b[^>]*>/g) ?? []) {
    const username = /\busername="([^"]*)"/.exec(tag)?.[1] ?? ''
    const token = /\baccessToken="([^"]*)"/.exec(tag)?.[1] ?? ''
    if (username && token) out.set(username.toLowerCase(), token)
  }
  return out
}

export async function getSharedTokens(
  machineId: string,
  ownerToken: string,
): Promise<Map<string, string>> {
  const u = `${PLEX_TV}/api/servers/${encodeURIComponent(machineId)}/shared_servers?X-Plex-Token=${encodeURIComponent(ownerToken)}`
  const res = await fetch(u, { headers: { accept: 'application/xml' } })
  if (!res.ok) throw new Error(`plex.tv HTTP ${res.status}`)
  return parseSharedServers(await res.text())
}

// Discovered tokens are cached IN MEMORY and never written to SQLite: they are other
// people's Plex credentials, and the only thing a restart costs is one plex.tv call.
// Same shape as the library-refresh cooldown in tautulli.ts.
const TOKEN_TTL_MS = 10 * 60_000
let tokenCache: { at: number; tokens: Map<string, string> } | null = null

/** Test seam only — module state would otherwise leak between specs. */
export function resetPlexTokenCache(): void {
  tokenCache = null
}

/** The Plex token to act as `username`, in precedence order: the operator's manual
 *  override, then the discovery cache, then one plex.tv lookup.
 *
 *  Returns null rather than throwing when the user simply has no token — that is a
 *  recordable skip ("no Plex token for Ana"), not a failure of the bridge. */
export async function resolvePlexToken(
  username: string,
  override: string,
  machineId: string,
  ownerToken: string,
): Promise<string | null> {
  if (override) return override
  if (!ownerToken) return null

  if (!tokenCache || Date.now() - tokenCache.at > TOKEN_TTL_MS) {
    tokenCache = { at: Date.now(), tokens: await getSharedTokens(machineId, ownerToken) }
  }
  return tokenCache.tokens.get(username.toLowerCase()) ?? null
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/plex.spec.ts && npm run typecheck`
Expected: PASS (all describe blocks).

- [ ] **Step 5: Commit**

```bash
git add server/utils/plex.ts tests/plex.spec.ts
git commit -m "feat(plex): discover per-user tokens from shared_servers with an in-memory cache"
```

---

### Task 4: Pipeline integration

**Files:**
- Modify: `server/utils/pipeline.ts` (`deliverToMapping` lines 25-67, `processEvent` lines 72-152, `backfillSharedTitle` lines 156-211)
- Test: `tests/pipeline.spec.ts`

**Interfaces:**
- Consumes: `getPlexServer`, `markWatched`, `resolvePlexToken`, `PlexServer` (Tasks 2-3); `getSharedTitle`, `SettingsRow.plex_token`, `MappingRow.plex_token`, `SharedTitleRow.plex_sync`, `EventRowDb.plex_status` (Task 1)
- Produces: no new exports — `processEvent` and `backfillSharedTitle` keep their signatures and return types

- [ ] **Step 1: Write the failing tests**

In `tests/pipeline.spec.ts`, add the plex mock beside the existing tautulli/seenr mocks (after line 34):

Declare the argument lists as `unknown[]`, not with named parameters: later tests
assert `toHaveBeenCalledWith(…)` with all four arguments, and a mock typed with fewer
parameters fails `npm run typecheck:tests` even though it works at runtime.

```typescript
const getPlexServer = vi.fn(async (..._a: unknown[]) => ({
  url: 'http://plex:32400',
  machineId: 'mach',
}))
const resolvePlexToken = vi.fn(async (...a: unknown[]) => `tok-${String(a[0])}`)
const markWatched = vi.fn(async (..._a: unknown[]) => 200)

vi.mock('../server/utils/plex', () => ({
  getPlexServer: (...a: unknown[]) => getPlexServer(...(a as [])),
  resolvePlexToken: (...a: unknown[]) => resolvePlexToken(...(a as [])),
  markWatched: (...a: unknown[]) => markWatched(...(a as [])),
}))
```

Add to the existing `beforeEach` (after line 53):

```typescript
  getPlexServer.mockClear()
  getPlexServer.mockImplementation(async () => ({ url: 'http://plex:32400', machineId: 'mach' }))
  resolvePlexToken.mockClear()
  resolvePlexToken.mockImplementation(async (...a: unknown[]) => `tok-${String(a[0])}`)
  markWatched.mockClear()
  markWatched.mockImplementation(async () => 200)
```

Then append this describe block:

```typescript
// Plex writes are per shared title and opt-in. The trigger user is never written to:
// they pressed play, so Plex already has their copy right.
describe('processEvent Plex marking', () => {
  async function sharedWithPlex(plex_sync: number) {
    const { db, pipeline } = await configured()
    db.saveSettings({ plex_token: 'owner-tok' })
    const alice = db.upsertMapping('alice', 'tok-alice', 1, 1, 1)
    const bob = db.upsertMapping('bob', 'tok-bob', 1, 1, 1)
    db.setSharedTitle({ rating_key: '999', media_type: 'show', plex_sync }, [alice.id, bob.id])
    return { db, pipeline }
  }

  it('marks the co-watcher in Plex but not the trigger', async () => {
    const { pipeline } = await sharedWithPlex(1)

    await pipeline.processEvent(input) // input.username === 'alice'

    expect(markWatched).toHaveBeenCalledOnce()
    expect(markWatched).toHaveBeenCalledWith('http://plex:32400', 'tok-bob', '12345')
  })

  it('marks the EPISODE key, not the show key the share is filed under', async () => {
    const { pipeline } = await sharedWithPlex(1)

    await pipeline.processEvent(input)

    // '999' is the share key; '12345' is the episode actually watched.
    expect(markWatched.mock.calls[0]![2]).toBe('12345')
  })

  it('records the Plex status on the co-watcher row and leaves the trigger row null', async () => {
    const { db, pipeline } = await sharedWithPlex(1)

    await pipeline.processEvent(input)

    const rows = db.listEvents(10)
    expect(rows.find((r) => r.username === 'bob')!.plex_status).toBe(200)
    expect(rows.find((r) => r.username === 'alice')!.plex_status).toBeNull()
  })

  it('does nothing in Plex when the share has plex_sync off', async () => {
    const { pipeline } = await sharedWithPlex(0)

    await pipeline.processEvent(input)

    expect(markWatched).not.toHaveBeenCalled()
    expect(getPlexServer).not.toHaveBeenCalled()
  })

  it('does not touch Plex for an unshared watch', async () => {
    const { db, pipeline } = await configured()
    db.saveSettings({ plex_token: 'owner-tok' })
    db.upsertMapping('alice', 'tok-alice', 1, 1, 1)

    await pipeline.processEvent(input)

    expect(getPlexServer).not.toHaveBeenCalled()
    expect(markWatched).not.toHaveBeenCalled()
  })

  it('records why nothing was marked when no Plex account is connected', async () => {
    const { db, pipeline } = await configured()
    const alice = db.upsertMapping('alice', 'tok-alice', 1, 1, 1)
    const bob = db.upsertMapping('bob', 'tok-bob', 1, 1, 1)
    db.setSharedTitle({ rating_key: '999', media_type: 'show', plex_sync: 1 }, [alice.id, bob.id])

    const r = await pipeline.processEvent(input)

    expect(markWatched).not.toHaveBeenCalled()
    // seenr still succeeded — Plex is the extra, not the job.
    expect(r.ok).toBe(true)
    const bobRow = db.listEvents(10).find((row) => row.username === 'bob')!
    expect(bobRow.ok).toBe(1)
    expect(bobRow.error).toContain('No Plex account connected')
  })

  it('records the reason when a co-watcher has no discoverable token', async () => {
    const { db, pipeline } = await sharedWithPlex(1)
    resolvePlexToken.mockImplementation(async () => null)

    await pipeline.processEvent(input)

    const bobRow = db.listEvents(10).find((r) => r.username === 'bob')!
    expect(bobRow.ok).toBe(1)
    expect(bobRow.error).toContain('No Plex token for bob')
  })

  it('leaves ok=1 when the Plex write fails but seenr succeeded', async () => {
    const { db, pipeline } = await sharedWithPlex(1)
    markWatched.mockImplementation(async () => 401)

    const r = await pipeline.processEvent(input)

    expect(r.ok).toBe(true)
    const bobRow = db.listEvents(10).find((row) => row.username === 'bob')!
    expect(bobRow.ok).toBe(1)
    expect(bobRow.plex_status).toBe(401)
    expect(bobRow.error).toContain('Plex HTTP 401')
  })

  it('survives a thrown Plex error and records it', async () => {
    const { db, pipeline } = await sharedWithPlex(1)
    markWatched.mockImplementation(async () => {
      throw new Error('ECONNREFUSED')
    })

    const r = await pipeline.processEvent(input)

    expect(r.ok).toBe(true)
    expect(db.listEvents(10).find((row) => row.username === 'bob')!.error).toContain('ECONNREFUSED')
  })

  it('records a server-lookup failure without blocking the seenr fan-out', async () => {
    const { db, pipeline } = await sharedWithPlex(1)
    getPlexServer.mockImplementation(async () => {
      throw new Error('Tautulli HTTP 502')
    })

    const r = await pipeline.processEvent(input)

    expect(r.fanout).toBe(2)
    expect(forwardToSeenr).toHaveBeenCalledTimes(2)
    expect(markWatched).not.toHaveBeenCalled()
    expect(db.listEvents(10).find((row) => row.username === 'bob')!.error).toContain('Tautulli HTTP 502')
  })

  it('still marks Plex when the seenr forward fails — separate destinations', async () => {
    const { db, pipeline } = await sharedWithPlex(1)
    forwardToSeenr.mockImplementation(async () => {
      throw new Error('seenr down')
    })

    await pipeline.processEvent(input)

    expect(markWatched).toHaveBeenCalledOnce()
    const bobRow = db.listEvents(10).find((row) => row.username === 'bob')!
    expect(bobRow.ok).toBe(0)
    expect(bobRow.plex_status).toBe(200)
  })

  it('does not mark Plex for a profile whose per-type sync is off', async () => {
    const { db, pipeline } = await configured()
    db.saveSettings({ plex_token: 'owner-tok' })
    const alice = db.upsertMapping('alice', 'tok-alice', 1, 1, 1)
    const bob = db.upsertMapping('bob', 'tok-bob', 1, 1, 0) // episode sync off
    db.setSharedTitle({ rating_key: '999', media_type: 'show', plex_sync: 1 }, [alice.id, bob.id])

    await pipeline.processEvent(input)

    expect(markWatched).not.toHaveBeenCalled()
  })

  it('passes a per-mapping override through to token resolution', async () => {
    const { db, pipeline } = await configured()
    db.saveSettings({ plex_token: 'owner-tok' })
    const alice = db.upsertMapping('alice', 'tok-alice', 1, 1, 1)
    const bob = db.upsertMapping('bob', 'tok-bob', 1, 1, 1, 'bob-manual')
    db.setSharedTitle({ rating_key: '999', media_type: 'show', plex_sync: 1 }, [alice.id, bob.id])

    await pipeline.processEvent(input)

    expect(resolvePlexToken).toHaveBeenCalledWith('bob', 'bob-manual', 'mach', 'owner-tok')
  })
})

describe('backfillSharedTitle Plex marking', () => {
  it('marks every assigned profile — a backfill has no trigger user', async () => {
    const { db, pipeline } = await configured()
    db.saveSettings({ plex_token: 'owner-tok' })
    const alice = db.upsertMapping('alice', 'tok-alice', 1, 1, 1)
    const bob = db.upsertMapping('bob', 'tok-bob', 1, 1, 1)
    db.setSharedTitle({ rating_key: '999', media_type: 'show', plex_sync: 1 }, [alice.id, bob.id])
    getWatchedEpisodeKeys.mockImplementation(async () => ['101', '102'])

    await pipeline.backfillSharedTitle('999')

    // 2 episodes x 2 profiles, nobody excluded.
    expect(markWatched).toHaveBeenCalledTimes(4)
    expect(markWatched.mock.calls.map((c) => c[2]).sort()).toEqual(['101', '101', '102', '102'])
  })

  it('resolves the Plex server once for the whole backfill', async () => {
    const { db, pipeline } = await configured()
    db.saveSettings({ plex_token: 'owner-tok' })
    const alice = db.upsertMapping('alice', 'tok-alice', 1, 1, 1)
    db.setSharedTitle({ rating_key: '999', media_type: 'show', plex_sync: 1 }, [alice.id])
    getWatchedEpisodeKeys.mockImplementation(async () => ['101', '102', '103'])

    await pipeline.backfillSharedTitle('999')

    expect(getPlexServer).toHaveBeenCalledOnce()
  })

  it('does not touch Plex when the share has plex_sync off', async () => {
    const { db, pipeline } = await configured()
    db.saveSettings({ plex_token: 'owner-tok' })
    const alice = db.upsertMapping('alice', 'tok-alice', 1, 1, 1)
    db.setSharedTitle({ rating_key: '500', media_type: 'movie', plex_sync: 0 }, [alice.id])
    getMetadata.mockImplementation(async () => ({ ...meta, media_type: 'movie', rating_key: '500' }))

    await pipeline.backfillSharedTitle('500')

    expect(markWatched).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run tests/pipeline.spec.ts -t "Plex marking"`
Expected: FAIL — `markWatched` never called; `plex_status` undefined on rows.

- [ ] **Step 3: Restructure `deliverToMapping`**

Replace `deliverToMapping` (lines 25-67) entirely. Note the two structural changes: the tail parameters become an options object, and the two `insertEvent` calls collapse into one so a single row can carry both outcomes.

```typescript
import { getPlexServer, markWatched, resolvePlexToken, type PlexServer } from './plex'

interface DeliverOpts {
  /** Record a real event row. False for previews. */
  record: boolean
  /** Where to mark watched, or null to skip Plex for this delivery. */
  plex: PlexServer | null
  /** Why Plex could not be attempted at all, for the event row. */
  plexError: string | null
}

// Deliver one item, as watched/whatever, to one profile. Honors the profile's
// enabled + per-type sync switches. Records a real event unless record === false.
// Returns null when skipped (nothing forwarded), else the delivery result.
async function deliverToMapping(
  meta: TautulliMetadata,
  ratingKey: string,
  action: string,
  mapping: MappingRow,
  settings: SettingsRow,
  now: number,
  opts: DeliverOpts,
): Promise<{ ok: boolean; seenr_status?: number } | null> {
  if (!mapping.enabled) return null
  if (meta.media_type === 'movie' && !mapping.sync_movies) return null
  if (meta.media_type === 'episode' && !mapping.sync_episodes) return null

  const built = buildPayload(meta, action, mapping.username)
  const image = imageFor(meta)
  const series_key = seriesKeyFor(meta)

  // Plex first, and independent of seenr: they are separate destinations, so a
  // seenr outage must not leave the co-watcher's Plex untouched (or vice versa).
  let plex_status: number | null = null
  let plexError: string | null = opts.plexError
  if (opts.plex && !plexError) {
    try {
      const token = await resolvePlexToken(
        mapping.username,
        mapping.plex_token,
        opts.plex.machineId,
        settings.plex_token,
      )
      if (!token) {
        plexError = `No Plex token for ${mapping.username}`
      } else {
        plex_status = await markWatched(opts.plex.url, token, ratingKey)
        if (plex_status < 200 || plex_status >= 300) plexError = `Plex HTTP ${plex_status}`
      }
    } catch (e) {
      plexError = `Plex write failed: ${e instanceof Error ? e.message : String(e)}`
    }
  }

  let status: number | null = null
  let seenrError: string | null = null
  try {
    const r = await forwardToSeenr(settings.seenr_base_url, mapping.seenr_token, built.payload)
    status = r.status
    if (status < 200 || status >= 300)
      seenrError = `seenr HTTP ${status} ${r.body?.slice(0, 200)}`.trim()
  } catch (e) {
    seenrError = `Forward to seenr failed: ${e instanceof Error ? e.message : String(e)}`
  }

  // `ok` means THE SEENR FORWARD SUCCEEDED, deliberately. A failed Plex write must
  // not flip it, or the Dashboard's failure count stops describing the bridge's job.
  const ok = status !== null && status >= 200 && status < 300
  if (opts.record)
    insertEvent({
      ts: now, action, event: built.event, username: mapping.username, media_type: meta.media_type,
      title: built.title, rating_key: ratingKey, ids: JSON.stringify(built.ids), image, series_key,
      seenr_status: status, plex_status, ok: ok ? 1 : 0,
      error: [seenrError, plexError].filter(Boolean).join(' · ') || null,
      payload: JSON.stringify(built.payload),
    })

  return { ok, seenr_status: status ?? undefined }
}
```

- [ ] **Step 4: Add the shared resolver helper**

Add above `processEvent`:

```typescript
// Resolve the Plex server ONCE per pipeline run, not once per delivery: a 60-episode
// backfill across two co-watchers would otherwise ask Tautulli for the same address
// 120 times. Never throws — a lookup failure becomes text on the event row.
async function plexTargetFor(
  settings: SettingsRow,
): Promise<{ target: PlexServer | null; error: string | null }> {
  if (!settings.plex_token)
    return { target: null, error: 'No Plex account connected in Settings' }
  try {
    return { target: await getPlexServer(settings.tautulli_url, settings.tautulli_apikey), error: null }
  } catch (e) {
    return { target: null, error: `Plex server lookup failed: ${e instanceof Error ? e.message : String(e)}` }
  }
}
```

- [ ] **Step 5: Wire it into `processEvent`**

Replace the fan-out block (lines 131-144) with:

```typescript
  // Fan-out: if this title is shared AND the watcher is one of its profiles,
  // deliver to every assigned profile; otherwise just the watcher.
  const key = titleKeyFor(meta, input.rating_key)
  const shared = getSharedRecipients(key)
  let recipients: MappingRow[] = [trigger]
  if (shared.length && shared.some((r) => r.id === trigger.id)) recipients = shared

  // Plex marking is opt-in per share. Only asked about when there is somebody other
  // than the trigger to write for, so an ordinary solo watch costs no extra calls.
  const share = recipients.length > 1 ? getSharedTitle(key) : undefined
  const plex = share?.plex_sync ? await plexTargetFor(settings) : { target: null, error: null }

  let triggerResult: { ok: boolean; seenr_status?: number } | null = null
  let delivered = 0
  for (const rcpt of recipients) {
    // The trigger is excluded from Plex: they pressed play, so their copy is already
    // watched. Everything else about their delivery is unchanged.
    const isTrigger = rcpt.id === trigger.id
    const res = await deliverToMapping(meta, input.rating_key, input.action, rcpt, settings, now, {
      record,
      plex: isTrigger ? null : plex.target,
      plexError: isTrigger ? null : plex.error,
    })
    if (res) delivered++
    if (isTrigger) triggerResult = res
  }
```

- [ ] **Step 6: Wire it into `backfillSharedTitle`**

After the `profiles` guard (line 167), add:

```typescript
  // No trigger user exists in a backfill — nobody just watched anything — so every
  // assigned profile is marked, with none excluded.
  const plex = share.plex_sync ? await plexTargetFor(settings) : { target: null, error: null }
```

and change the inner delivery call (line 193) to:

```typescript
      const res = await deliverToMapping(meta, itemKey, 'watched', p, settings, now, {
        record: true,
        plex: plex.target,
        plexError: plex.error,
      })
```

Also add `getSharedTitle` to the `./db` import at the top of the file.

- [ ] **Step 7: Fix the remaining `insertEvent` call**

`fail()` inside `processEvent` still needs `plex_status: null` (added in Task 1 step 9 — confirm it is there).

- [ ] **Step 8: Run the full suite**

Run: `npm test && npm run typecheck`
Expected: PASS — all 90 pre-existing tests plus the new ones. The pre-existing fan-out and backfill tests must still pass unchanged; if any broke, the `deliverToMapping` restructure changed observable behaviour and needs correcting rather than the test relaxing.

- [ ] **Step 9: Commit**

```bash
git add server/utils/pipeline.ts tests/pipeline.spec.ts
git commit -m "feat(pipeline): mark co-watchers watched in Plex for shares that opt in"
```

---

### Task 5: API endpoints

**Files:**
- Create: `server/api/plex/pin.post.ts`, `server/api/plex/pin/[id].get.ts`, `server/api/plex/users.get.ts`
- Modify: `server/utils/plex.ts` (the PIN pair), `server/api/settings/index.put.ts`, `server/api/mappings/index.post.ts`, `server/api/shared/index.put.ts`, `shared/types/index.ts`
- Test: `tests/plex.spec.ts`

**Interfaces:**
- Consumes: `getPlexClientId`, `saveSettings`, `getSettings`, `listMappings` (Task 1); `getPlexServer`, `getSharedTokens` (Tasks 2-3)
- Produces:
  - `startPinLogin(clientId: string): Promise<{ id: string; code: string }>`
  - `pollPinLogin(clientId: string, id: string): Promise<string | null>`
  - `plexAuthUrl(clientId: string, code: string): string`
  - Wire: `interface PlexLinkStatus { connected: boolean; matched: string[]; unmatched: string[]; error?: string }`

- [ ] **Step 1: Write the failing tests for the PIN pair**

Append to `tests/plex.spec.ts` (adding the three names to the import):

```typescript
describe('OAuth PIN login', () => {
  it('creates a strong PIN with the client identifier and product', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ id: 12345, code: 'ABCD', authToken: null }),
    } as unknown as Response)

    const pin = await startPinLogin('client-uuid')

    expect(pin).toEqual({ id: '12345', code: 'ABCD' })
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://plex.tv/api/v2/pins?strong=true')
    expect(init.method).toBe('POST')
    const headers = init.headers as Record<string, string>
    expect(headers['X-Plex-Client-Identifier']).toBe('client-uuid')
    expect(headers['X-Plex-Product']).toBe('Seenr Bridge')
  })

  it('throws when plex.tv rejects the PIN request', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500 } as unknown as Response)

    await expect(startPinLogin('c')).rejects.toThrow('plex.tv HTTP 500')
  })

  it('returns null while the PIN is still unclaimed', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ id: 12345, code: 'ABCD', authToken: null }),
    } as unknown as Response)

    await expect(pollPinLogin('client-uuid', '12345')).resolves.toBeNull()
  })

  it('returns the token once the PIN is claimed, polling with the SAME client id', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ id: 12345, code: 'ABCD', authToken: 'owner-token' }),
    } as unknown as Response)

    await expect(pollPinLogin('client-uuid', '12345')).resolves.toBe('owner-token')

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://plex.tv/api/v2/pins/12345')
    // A different identifier here than the one that created the PIN never returns a token.
    expect((init.headers as Record<string, string>)['X-Plex-Client-Identifier']).toBe('client-uuid')
  })

  it('builds the sign-in URL the operator visits', () => {
    expect(plexAuthUrl('client-uuid', 'ABCD')).toBe(
      'https://app.plex.tv/auth#?clientID=client-uuid&code=ABCD&context%5Bdevice%5D%5Bproduct%5D=Seenr%20Bridge',
    )
  })
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run tests/plex.spec.ts -t "OAuth PIN"`
Expected: FAIL — `startPinLogin` is not exported.

- [ ] **Step 3: Implement the PIN pair**

Append to `server/utils/plex.ts`:

```typescript
const PLEX_PRODUCT = 'Seenr Bridge'

interface PlexPin {
  id?: number | string
  code?: string
  authToken?: string | null
}

// plex.tv's OAuth PIN flow. The client identifier passed here MUST be the same value
// used to poll the PIN later, or plex.tv never returns a token — which is why it is
// persisted rather than generated per request.
function pinHeaders(clientId: string): Record<string, string> {
  return {
    accept: 'application/json',
    'X-Plex-Product': PLEX_PRODUCT,
    'X-Plex-Client-Identifier': clientId,
  }
}

export async function startPinLogin(clientId: string): Promise<{ id: string; code: string }> {
  const res = await fetch(`${PLEX_TV}/api/v2/pins?strong=true`, {
    method: 'POST',
    headers: pinHeaders(clientId),
  })
  if (!res.ok) throw new Error(`plex.tv HTTP ${res.status}`)

  const pin = (await res.json()) as PlexPin
  if (!pin?.id || !pin?.code) throw new Error('plex.tv returned no PIN')
  return { id: String(pin.id), code: String(pin.code) }
}

/** The owner's token once they approve the PIN, or null while it is still pending. */
export async function pollPinLogin(clientId: string, id: string): Promise<string | null> {
  const res = await fetch(`${PLEX_TV}/api/v2/pins/${encodeURIComponent(id)}`, {
    headers: pinHeaders(clientId),
  })
  if (!res.ok) throw new Error(`plex.tv HTTP ${res.status}`)

  const pin = (await res.json()) as PlexPin
  return pin?.authToken || null
}

export function plexAuthUrl(clientId: string, code: string): string {
  const q = new URLSearchParams({
    clientID: clientId,
    code,
    'context[device][product]': PLEX_PRODUCT,
  })
  return `https://app.plex.tv/auth#?${q.toString()}`
}
```

- [ ] **Step 4: Run the PIN tests**

Run: `npx vitest run tests/plex.spec.ts -t "OAuth PIN"`
Expected: PASS. If the URL-encoding assertion fails, match the test to whatever `URLSearchParams` actually produces — the encoded form is what matters, not the exact escaping.

- [ ] **Step 5: Accept the new fields on the existing endpoints**

In `server/api/settings/index.put.ts`, add to the returned object in `validate()`:

```typescript
    plex_token: str(b.plex_token),
```

In `server/api/mappings/index.post.ts`, pass a sixth argument to `upsertMapping`:

```typescript
      b.sync_episodes === false ? 0 : 1,
      typeof b.plex_token === 'string' ? b.plex_token.trim() : '',
```

In `server/api/shared/index.put.ts`, add to the `setSharedTitle` object:

```typescript
      // Absent means off, not unknown: both the add flow and the edit modal always
      // send the checkbox, and defaulting to off is what keeps an upgrade from
      // writing into anyone's Plex.
      plex_sync: b.plex_sync ? 1 : 0,
```

- [ ] **Step 6: Add the wire type**

In `shared/types/index.ts`:

```typescript
/** Whether a Plex account is linked, and which mapped users have a usable token. */
export interface PlexLinkStatus {
  connected: boolean
  matched: string[]
  unmatched: string[]
  error?: string
}
```

- [ ] **Step 7: Create the three endpoints**

These are `server/api/*` files, so they **do** use Nitro auto-imports (`defineEventHandler`, `createError`, `getRouterParam`) — the opposite of the `server/utils` rule.

`server/api/plex/pin.post.ts`:

```typescript
import { getPlexClientId } from '../../utils/db'
import { startPinLogin, plexAuthUrl } from '../../utils/plex'

export default defineEventHandler(async () => {
  const clientId = getPlexClientId()
  const pin = await startPinLogin(clientId)
  return { id: pin.id, code: pin.code, url: plexAuthUrl(clientId, pin.code) }
})
```

`server/api/plex/pin/[id].get.ts`:

```typescript
import { getPlexClientId, saveSettings } from '../../../utils/db'
import { pollPinLogin, resetPlexTokenCache } from '../../../utils/plex'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'pin id required' })

  const token = await pollPinLogin(getPlexClientId(), id)
  if (!token) return { pending: true }

  // Saved server-side and NEVER returned to the browser: the settings PUT can carry
  // a token when an operator pastes one, but there is no reason to ship this one out.
  saveSettings({ plex_token: token })
  // A new account means the cached per-user tokens belong to the old one.
  resetPlexTokenCache()
  return { pending: false }
})
```

`server/api/plex/users.get.ts`:

```typescript
import { getSettings, listMappings } from '../../utils/db'
import { getPlexServer, getSharedTokens } from '../../utils/plex'
import type { PlexLinkStatus } from '../../../shared/types'

// Which mapped users the bridge can actually act as. Surfaced in Settings so a
// missing token is visible now, rather than as a silent no-op at 2am.
export default defineEventHandler(async (): Promise<PlexLinkStatus> => {
  const s = getSettings()
  if (!s.plex_token) return { connected: false, matched: [], unmatched: [] }

  const mappings = listMappings()
  try {
    const { machineId } = await getPlexServer(s.tautulli_url, s.tautulli_apikey)
    const tokens = await getSharedTokens(machineId, s.plex_token)
    const has = (username: string, override: string) =>
      !!override || tokens.has(username.toLowerCase())

    return {
      connected: true,
      matched: mappings.filter((m) => has(m.username, m.plex_token)).map((m) => m.username),
      unmatched: mappings.filter((m) => !has(m.username, m.plex_token)).map((m) => m.username),
    }
  } catch (e) {
    return {
      connected: true,
      matched: [],
      unmatched: mappings.map((m) => m.username),
      error: e instanceof Error ? e.message : String(e),
    }
  }
})
```

- [ ] **Step 8: Verify the endpoints are authenticated and routable**

Run: `npm run dev` in one shell, then in another:

```bash
curl -s -o /dev/null -w '%{http_code}\n' localhost:8687/api/plex/users
curl -s -o /dev/null -w '%{http_code}\n' -X POST localhost:8687/api/plex/pin
```

Expected: `401` for both — nothing was added to `PUBLIC_API_PATHS`, so the gate covers them. A `404` means the file path is wrong; a `200` means the auth gate was bypassed and must be investigated.

- [ ] **Step 9: Run the suite and commit**

```bash
npm test && npm run typecheck
git add server/utils/plex.ts server/api shared/types/index.ts tests/plex.spec.ts
git commit -m "feat(api): add Plex OAuth login, token report, and accept the new fields"
```

---

### Task 6: Settings UI — link a Plex account

**Files:**
- Modify: `app/pages/settings.vue` (insert a `SetupStep` after the seenr users step, which closes at line 581; extend the Configure modal at ~line 696)
- Modify: `app/stores/settings.ts` if the Plex state belongs there rather than in the page

**Interfaces:**
- Consumes: `POST /api/plex/pin`, `GET /api/plex/pin/:id`, `GET /api/plex/users`, `PlexLinkStatus`, `Settings.plex_token`, `Mapping.plex_token` (Tasks 1, 5)
- Produces: no exports — UI only

- [ ] **Step 1: Check the components exist before using them**

Run: `grep -nE "UButton|UBadge|UAlert|UFormField|UInput|USwitch|UCheckbox" .nuxt/components.d.ts | head`
Expected: each name present. A misspelled Nuxt UI component passes `typecheck` AND `build`, then renders nothing — `UButtonGroup` was renamed to `UFieldGroup` in v4 and silently produced an invisible control on the Shared page. Do not skip this.

- [ ] **Step 2: Add the Plex step to the script block**

Add to `app/pages/settings.vue`'s `<script setup>`:

```typescript
import type { PlexLinkStatus } from '../../shared/types'

const plexLink = ref<PlexLinkStatus | null>(null)
const plexBusy = ref(false)
const plexError = ref<string | null>(null)

async function loadPlexLink() {
  try {
    plexLink.value = await $fetch<PlexLinkStatus>('/api/plex/users')
  } catch (e) {
    plexError.value = apiErrorMessage(e, 'Could not read the Plex link status.')
  }
}

// The PIN flow: create a PIN, open plex.tv in a new tab, then poll until the operator
// approves it. The token is saved server-side by the poll endpoint and never comes back
// to the browser.
async function signInWithPlex() {
  plexBusy.value = true
  plexError.value = null
  try {
    const pin = await $fetch<{ id: string; code: string; url: string }>('/api/plex/pin', {
      method: 'POST',
    })
    window.open(pin.url, '_blank', 'noopener')

    const deadline = Date.now() + 120_000
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 2000))
      const r = await $fetch<{ pending: boolean }>(`/api/plex/pin/${encodeURIComponent(pin.id)}`)
      if (!r.pending) {
        await store.load()
        await loadPlexLink()
        return
      }
    }
    plexError.value = 'Timed out waiting for Plex. Try again.'
  } catch (e) {
    plexError.value = apiErrorMessage(e, 'Could not sign in with Plex.')
  } finally {
    plexBusy.value = false
  }
}

onMounted(() => void loadPlexLink())
```

Check the existing script block for how `store` and `apiErrorMessage` are already imported and reuse those — do not add duplicate imports.

- [ ] **Step 3: Add the step to the template**

Insert immediately after the `</SetupStep>` that closes the seenr users step (line 581), following the numbering and prop style of steps 1 and 2.

One deliberate divergence from the spec: the spec sketched *"Signed in as **you**"*, but `/api/plex/users` does not return the account name and fetching it would mean another plex.tv call (`/api/v2/user`) for a cosmetic label. The matched-user count carries the information that matters — whether the bridge can actually act for each person — so the button label reflects connected state instead. Add the account name later if it is missed.

```vue
    <SetupStep :n="3" title="Plex" hint="optional — also mark co-watched titles watched in Plex">
      <p class="text-sm text-muted">
        Plex stores "watched" per account, so marking a co-watcher's copy needs their own
        access. Sign in as the server owner once and the bridge finds the rest.
      </p>

      <UAlert v-if="plexError" color="error" variant="subtle" class="mt-3" :description="plexError" />

      <div class="mt-3 flex flex-wrap items-center gap-3">
        <UButton
          :label="plexLink?.connected ? 'Reconnect Plex' : 'Sign in with Plex'"
          :loading="plexBusy"
          icon="i-lucide-link"
          @click="signInWithPlex"
        />
        <span v-if="plexBusy" class="text-xs text-dimmed">
          Approve the request in the Plex tab that just opened…
        </span>
        <template v-else-if="plexLink?.connected">
          <UBadge
            :color="plexLink.unmatched.length ? 'warning' : 'success'"
            variant="subtle"
            size="sm"
            :label="`${plexLink.matched.length} of ${plexLink.matched.length + plexLink.unmatched.length} users matched`"
          />
        </template>
      </div>

      <p v-if="plexLink?.error" class="mt-2 text-xs text-warning">
        Plex reported: {{ plexLink.error }}
      </p>
      <p v-else-if="plexLink?.unmatched.length" class="mt-2 text-xs text-warning">
        No token found for {{ plexLink.unmatched.join(', ') }} — likely a Plex Home profile.
        Add one by hand under Configure for that user, or their Plex will be left alone.
      </p>
      <p class="mt-2 text-xs text-dimmed">
        Nothing is written to Plex until a shared title has "Also mark watched in Plex"
        ticked on the Shared page.
      </p>
    </SetupStep>
```

- [ ] **Step 4: Add the per-user override to the Configure modal**

In the mapping Configure modal (~line 696), beside the existing sync switches, add:

```vue
      <UFormField
        label="Plex token (optional)"
        help="Only needed when Plex did not report this user — e.g. a Plex Home profile."
      >
        <UInput v-model="edit.plex_token" type="password" placeholder="leave blank to auto-detect" class="w-full" />
      </UFormField>
```

Confirm the modal's save path POSTs the whole `edit` object to `/api/mappings` — `upsertMapping` resets any field the POST omits, exactly as it already does for `sync_movies`.

- [ ] **Step 5: Verify in a browser**

Run: `npm run dev`, open `http://localhost:8687/settings`.

Check: step 3 renders with a working button; the badge appears after linking; the unmatched warning names the right users; the Configure modal shows and saves the token field. **A blank area means a mis-named component — go back to step 1.**

- [ ] **Step 6: Commit**

```bash
npm run typecheck
git add app/pages/settings.vue app/stores/settings.ts
git commit -m "feat(ui): link a Plex account from Settings and show which users matched"
```

---

### Task 7: The per-title toggle and the Dashboard badge

**Files:**
- Modify: `app/components/SharedTitleModal.vue`, `app/utils/shared-row.ts`, `app/pages/shared.vue`, `app/utils/event-group.ts`, `app/components/EventRow.vue`
- Test: `tests/event-group.spec.ts`

**Interfaces:**
- Consumes: `SharedTitle.plex_sync`, `ScrobbleEvent.plex_status` (Task 1); `PlexLinkStatus` (Task 5)
- Produces: `SharedTitlePayload.plex_sync: boolean`, `SharedRow.plex_sync: boolean`, `EventRecipient.plex_status: number | null`

- [ ] **Step 1: Write the failing test for the grouping change**

`tests/event-group.spec.ts` already has a row factory named `ev(over)` at the top of the file — use it, and add `plex_status: null` to its defaults object (`ScrobbleEvent` now requires the field, so the factory will not typecheck without it). Then append inside the `describe('groupEvents', …)` block:

```typescript
  it('carries plex_status onto each recipient', () => {
    const out = groupEvents([
      ev({ id: 1, username: 'alice', plex_status: null }),
      ev({ id: 2, username: 'bob', plex_status: 200 }),
    ])

    expect(out).toHaveLength(1) // same ts/rating_key/event → one group
    expect(out[0]!.recipients.map((r) => r.plex_status)).toEqual([null, 200])
  })
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/event-group.spec.ts -t "plex_status"`
Expected: FAIL — `plex_status` is not on `EventRecipient`.

- [ ] **Step 3: Thread `plex_status` through grouping**

In `app/utils/event-group.ts`, add `plex_status: number | null` to `EventRecipient` and `plex_status: e.plex_status,` to the `g.recipients.push({…})` call.

- [ ] **Step 4: Show the Plex outcome on the recipient badge**

In `app/components/EventRow.vue`, extend `recipientStatus()` so the tooltip tells both stories:

```typescript
function recipientStatus(r: EventRecipient) {
  const seenr = r.ok ? 'checked in' : r.seenr_status ? `seenr ${r.seenr_status}` : 'failed'
  if (r.plex_status === null) return seenr
  const plex = r.plex_status >= 200 && r.plex_status < 300 ? 'marked in Plex' : `Plex ${r.plex_status}`
  return `${seenr} · ${plex}`
}
```

Add a trailing icon to the recipient `UBadge` (line ~94) so a Plex write is visible without hovering:

```vue
            :trailing-icon="r.plex_status !== null ? 'i-lucide-clapperboard' : undefined"
```

- [ ] **Step 5: Run the grouping test**

Run: `npx vitest run tests/event-group.spec.ts`
Expected: PASS, including the file's pre-existing tests.

- [ ] **Step 6: Add `plex_sync` to the share payload types**

In `app/utils/shared-row.ts`, add `plex_sync: boolean` to **both** `SharedTitlePayload` and `SharedRow`.

- [ ] **Step 7: Add the checkbox to the modal**

In `app/components/SharedTitleModal.vue`:

Script — add the ref, set it in `reset()`, and include it in the payload:

```typescript
const plexSync = ref(false)
```

In `reset()`, beside the existing `profileIds` restore:

```typescript
  plexSync.value = isEdit.value ? !!props.row?.plex_sync : false
```

In `submit()`, add to the emitted object:

```typescript
    plex_sync: plexSync.value,
```

Template — add inside the "Share with" `<section>`, after the profile checkbox loop's closing `</div>` (line 317):

```vue
          <UCheckbox
            v-model="plexSync"
            class="mt-3"
            label="Also mark watched in Plex"
            :disabled="!plexConnected"
            :description="
              plexConnected
                ? 'Each co-watcher\'s own Plex copy is marked watched too. The person who pressed play is skipped — theirs already is.'
                : 'Sign in with Plex under Settings first.'
            "
          />
```

Add a `plexConnected?: boolean` prop to `defineProps` and pass it from `shared.vue`, which already fetches its own data — fetch `/api/plex/users` there and pass `plexLink?.connected ?? false`.

- [ ] **Step 8: Thread it through the page**

Two edits in `app/pages/shared.vue`:

In `saveTitle()`, add to the PUT body (after `profiles: p.profiles,` at line 72):

```typescript
        plex_sync: p.plex_sync,
```

In the `rows` computed that maps `SharedTitle` → `SharedRow` (line 29), add beside `isShared`:

```typescript
      plex_sync: s.plex_sync,
```

That second one is what makes edit mode restore the checkbox — `editing.value` is a `SharedRow`, and the modal reads `props.row?.plex_sync`.

Leave the other `$fetch('/api/shared')` (in `removeTitle`, line ~126) alone: it sends `profiles: []`, which deletes the share row outright, so `plex_sync` is irrelevant there.

- [ ] **Step 8a: Fetch the link status for the disabled state**

`shared.vue` needs `plexConnected` to pass to the modal. Add beside the two existing `useAsyncData` calls:

```typescript
const { data: plexLink } = useAsyncData<PlexLinkStatus>(
  'plex-link',
  () => $fetch('/api/plex/users'),
  { default: (): PlexLinkStatus => ({ connected: false, matched: [], unmatched: [] }), lazy: true },
)
```

Import `PlexLinkStatus` from `'../../shared/types'` alongside the existing type imports, and pass `:plex-connected="plexLink.connected"` to `<SharedTitleModal>` at line ~206.

- [ ] **Step 9: Verify the round-trip in a browser**

Run: `npm run dev`, open `http://localhost:8687/shared`.

Check: tick the box, save, reopen the row in edit mode — the box is still ticked. Untick, save, reopen — still unticked. With no Plex account linked, the box is disabled with the explanatory text.

- [ ] **Step 10: Commit**

```bash
npm test && npm run typecheck
git add app tests/event-group.spec.ts
git commit -m "feat(ui): per-title Plex toggle and the Plex outcome on event rows"
```

---

### Task 8: End-to-end verification against the live server

**Files:** none — verification only.

- [ ] **Step 1: Build and run the real artifact**

Run: `npm run build && npm start`

The dev server is not enough: with `ssr: false`, a route without a prerendered `index.html` ships a blank shell that still returns 200. Confirm the pages actually load:

```bash
curl -s localhost:8687/settings | grep -c '_nuxt/'
curl -s localhost:8687/shared | grep -c '_nuxt/'
```

Expected: non-zero for both. A `0` means the SPA shell shipped without the entry script.

- [ ] **Step 2: Link Plex and confirm the match report**

In Settings → Plex, sign in. Confirm the badge reports the expected number of matched users, and that anyone flagged unmatched is one of the home profiles identified in Task 0.

- [ ] **Step 3: Tick a share and watch something**

Pick a shared show with a co-watcher, tick "Also mark watched in Plex", then play an episode to completion as the other profile (or use Settings → Test a scrobble with that episode's `rating_key`).

Confirm: the co-watcher's Plex shows the episode watched; the Dashboard row shows both the seenr check-in and the Plex indicator; the trigger user's row shows no Plex indicator.

- [ ] **Step 4: Confirm there is still no feedback loop**

Wait a minute, then reload the Dashboard. Expected: exactly one event group for that watch. A second group appearing without anyone playing anything means the Plex write came back through Tautulli — stop and report, because that is an unbounded fan-out.

- [ ] **Step 5: Confirm a backfill**

On the Shared page, edit a title with "Also mark watched in Plex" ticked and choose "Sync all previously watched episodes". Confirm the co-watcher's Plex flips for the whole run and that the Dashboard records each one.

---

### Task 9: Release

**Files:**
- Modify: `shared/version.ts`, `CHANGELOG.md`, `CLAUDE.md`

- [ ] **Step 1: Bump the version**

`shared/version.ts` — `2.2.3` → `2.3.0` (a feature, so the minor moves):

```typescript
// Single source of truth for the app version. Bump on release.
export const VERSION = '2.3.0'
```

The README badge reads the latest release from shields.io, so there is nothing to update there.

- [ ] **Step 2: Write the changelog section**

Insert above the `## 2.2.3` heading in `CHANGELOG.md`. CI reads this section verbatim as the release notes:

```markdown
## 2.3.0

### Added

- Shared titles can now also be marked watched **in Plex** for their co-watching profiles, not just checked in to seenr. Tick "Also mark watched in Plex" on a shared title; the person who pressed play is skipped, since their own copy is already watched.
- Settings gained a Plex step: sign in once as the server owner and the bridge discovers each co-watcher's own Plex access from plex.tv. Users it cannot find — typically Plex Home profiles — can be given a token by hand under Configure.
- Event rows show whether the Plex write landed alongside the seenr result.

### Notes

- Watched state in Plex belongs to an account rather than to an item, so marking a co-watcher's copy requires that co-watcher's own access. Nothing is written to Plex until a title opts in, and existing shared titles default to off.
```

- [ ] **Step 3: Record the conventions worth keeping**

Add to the "Conventions that still bite you" list in `CLAUDE.md`:

```markdown
- **Plex watched state is per-account, so `server/utils/plex.ts` treats a token as a *choice of user*, not as authentication.** `/:/scrobble` with the owner's token marks the owner's copy; there is no admin impersonation parameter. Co-watchers' tokens come from `plex.tv/api/servers/<machineId>/shared_servers` (the only XML this codebase parses) and are cached in memory only — never written to SQLite, because they are other people's credentials. Plex Home profiles are absent from that endpoint and rely on the per-mapping `plex_token` override.
- **`shared_titles.plex_sync` defaults to `0`, deliberately inverting the "empty means all" rule that `settings.libraries` uses.** That rule is safe because it only widens forwarding; this one writes into other people's Plex libraries, so an upgrade must not start doing it to titles shared months ago.
- **`events.ok` means the seenr forward succeeded, not the Plex write.** A failed Plex write records `plex_status` and appends to `error` without flipping `ok`, so the Dashboard's failure count keeps describing the bridge's actual job.
- **The X-Plex-Client-Identifier (`settings.plex_client_id`) must be identical between creating an OAuth PIN and polling it**, so it is generated once by `getPlexClientId()` and deliberately kept off `SettingsRow` and the wire.
```

Also soften the webhook claim in the "What this service does" section: Plex's docs state a server "receive[s] webhooks for the user who is signed into the server, as well as webhooks for shared users", and webhooks are configured per user account. The reason the bridge exists is unaffected — Tautulli sees every user's playback without each of them configuring anything — but the current wording is wrong.

- [ ] **Step 4: Final verification**

Run: `npm test && npm run typecheck`
Expected: PASS, all tests.

- [ ] **Step 5: Commit and open the PR**

```bash
git add shared/version.ts CHANGELOG.md CLAUDE.md
git commit -m "chore: bump version to 2.3.0"
git push -u origin feat/plex-mark-watched
gh pr create --title "Mark co-watched titles as watched in Plex" --body "$(cat <<'BODY'
Shared titles can now also be marked watched in Plex for their co-watching
profiles. Watched state in Plex belongs to an account, so this needs each
co-watcher's own access: the operator signs in once as the server owner and
the bridge discovers the rest from plex.tv `shared_servers`, holding those
tokens in memory only.

Opt-in per shared title, defaulting to off — an upgrade writes to nobody.
The trigger user is skipped, since their copy is already watched.

Spec: `docs/superpowers/specs/2026-07-27-plex-mark-watched-design.md`
Plan: `docs/superpowers/plans/2026-07-27-plex-mark-watched.md`

🤖 Generated with [Claude Code](https://claude.com/claude-code)
BODY
)"
```

Note `gh` needs `GH_CONFIG_DIR` set in this environment.

---

## Notes for the implementer

- **Task 0 is not optional and not a formality.** Every task after it assumes a borrowed `accessToken` can write to `/:/scrobble`. If it cannot, stop and report rather than building around it.
- **The trigger-user exclusion is the one behaviour easiest to get subtly wrong.** `processEvent` excludes them; `backfillSharedTitle` excludes nobody, because a backfill has no trigger. Both cases have tests — if you find yourself relaxing one, re-read the reasoning first.
- **`ok` must keep meaning "seenr succeeded."** It is tempting to make a Plex failure fail the row. Don't: the Dashboard's failure count is how forwarding problems get noticed, and a Plex hiccup drowning that signal is worse than a quiet Plex failure.
