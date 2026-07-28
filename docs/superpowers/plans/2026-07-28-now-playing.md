# Now playing + one-off watch counting — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show live Tautulli sessions in a Now playing card on the Dashboard, and let the operator either count the in-flight watch for extra profiles or share the title from now on.

**Architecture:** The Dashboard polls a new `/api/tautulli/activity` endpoint on its existing 5s tick; nothing runs server-side when the page is closed. "Share this show" reuses `setSharedTitle` unchanged. "Count this episode" writes a `pending_watches` row that `processEvent` consumes when Tautulli's `watched` event arrives for that item, so co-watchers are counted at the same instant the watcher is.

**Tech Stack:** Nuxt 4 (SPA, `ssr: false`), Nitro server routes, better-sqlite3, Nuxt UI v4, Vitest.

**Spec:** `docs/superpowers/specs/2026-07-28-now-playing-design.md`

## Global Constraints

- **`server/utils/*` uses explicit relative imports only** — never Nitro auto-imports. `server/api/*` deliberately does the opposite. Plain Vitest imports `server/utils` modules directly and has no idea Nitro globals exist.
- **Before adding a `server/utils` export, check it does not collide with an h3/Nitro auto-import.** `npm run typecheck` surfaces collisions as `WARN Duplicated imports`.
- **Migrations are append-only `PRAGMA table_info` guards** at the bottom of `db.ts`. Never edit an existing guard.
- **`shared/types` is the wire shape** — real booleans. The SQLite `0`/`1` representation stays behind `*ToWire()` in `db.ts`.
- **New authed endpoints need no registration.** Only *public* paths go in `PUBLIC_API_PATHS` (`server/utils/auth.ts`). Everything here is authed.
- **No new page route**, so `nitro.prerender.routes` and the `TITLES` map in `app/layouts/default.vue` are untouched.
- **Grep `.nuxt/components.d.ts` for any Nuxt UI component used for the first time.** A misspelled component name passes both `typecheck` and `build`, then renders nothing.
- **There is no linter.** `npm run typecheck` and `npm test` are the only checks. Both must pass before every commit.
- **Version:** bump `shared/version.ts` to `2.5.0` with a matching `## 2.5.0` section in `CHANGELOG.md` — once, in Task 8. `.github/workflows/pr-checks.yml` fails the PR without both.
- **Pulse animation must respect reduced motion**: every animated element carries `motion-reduce:animate-none`.

---

### Task 1: `getActivity()` in the Tautulli client

**Files:**
- Modify: `shared/types/index.ts` (add `ActivitySession`)
- Modify: `server/utils/tautulli.ts` (add `getActivity`, after `getChildren`)
- Test: `tests/tautulli.spec.ts`

**Interfaces:**
- Consumes: `tautulliApi<T>(url, apiKey, cmd, params)` — existing private helper, POST form-encoded, throws on non-success.
- Produces: `getActivity(url: string, apiKey: string): Promise<ActivitySession[]>`, and the `ActivitySession` wire type used by Tasks 4, 6, 7.

**Context:** Verified live — `get_activity` returns `data.sessions` plus `stream_count` and bandwidth counters. When nothing plays, `stream_count` is `0` and `sessions` is `[]`; the call does **not** error, so idle and broken are indistinguishable by failure and must be by shape.

`guid` / `grandparent_guid` presence in a session is **unconfirmed** (nothing was playing at design time). Type them optional and default to `''`. Task 6 calls `get_metadata` on click when they are empty, so both worlds work.

- [ ] **Step 1: Add the wire type**

In `shared/types/index.ts`:

```ts
/** One live Tautulli playback session, flattened for the Now playing card.
 *  `guid` / `show_guid` are '' when Tautulli's session payload omits them — the
 *  card then resolves them with get_metadata on click rather than per poll. */
export interface ActivitySession {
  session_key: string
  rating_key: string
  media_type: string
  /** Episode title for an episode, film title for a movie. */
  title: string
  /** The show's title; '' for a movie. */
  show_title: string
  season: string
  episode: string
  year: string
  username: string
  /** 'playing' | 'paused' | 'buffering', per Tautulli. Not narrowed: Tautulli
   *  may add states and an unknown one must render, not crash. */
  state: string
  progress_percent: number
  image: string | null
  library_name: string
  section_id: string
  guid: string
  show_rating_key: string
  show_guid: string
}
```

- [ ] **Step 2: Write the failing tests**

Append to `tests/tautulli.spec.ts` (the `ok()` helper and `fetchMock` already exist at the top of that file):

```ts
describe('getActivity', () => {
  it('flattens sessions onto ActivitySession', async () => {
    fetchMock.mockResolvedValue(
      ok({
        stream_count: '1',
        sessions: [
          {
            session_key: '12',
            rating_key: 25634,
            media_type: 'episode',
            title: 'Ozymandias',
            grandparent_title: 'Breaking Bad',
            parent_media_index: 5,
            media_index: 14,
            year: 2013,
            username: 'isntw',
            state: 'playing',
            progress_percent: '62',
            thumb: '/library/metadata/25634/thumb/1',
            grandparent_thumb: '/library/metadata/999/thumb/1',
            library_name: 'TV Shows',
            section_id: 2,
            guid: 'plex://episode/abc',
            grandparent_rating_key: 999,
            grandparent_guid: 'plex://show/def',
          },
        ],
      }),
    )

    const out = await getActivity('http://tautulli:8181', 'key')

    expect(out).toEqual([
      {
        session_key: '12',
        rating_key: '25634',
        media_type: 'episode',
        title: 'Ozymandias',
        show_title: 'Breaking Bad',
        season: '5',
        episode: '14',
        year: '2013',
        username: 'isntw',
        state: 'playing',
        progress_percent: 62,
        // The show's art, not the episode's — the same choice imageFor() makes
        // in the pipeline, so a card and its later event row show one poster.
        image: '/library/metadata/999/thumb/1',
        library_name: 'TV Shows',
        section_id: '2',
        guid: 'plex://episode/abc',
        show_rating_key: '999',
        show_guid: 'plex://show/def',
      },
    ])
  })

  it('returns [] for the idle response rather than throwing', async () => {
    fetchMock.mockResolvedValue(ok({ stream_count: '0', sessions: [] }))
    expect(await getActivity('http://tautulli:8181', 'key')).toEqual([])
  })

  it('degrades to [] when sessions is missing or not an array', async () => {
    fetchMock.mockResolvedValue(ok({ stream_count: '0' }))
    expect(await getActivity('http://tautulli:8181', 'key')).toEqual([])

    fetchMock.mockResolvedValue(ok({ sessions: 'nope' }))
    expect(await getActivity('http://tautulli:8181', 'key')).toEqual([])
  })

  it('drops a session with no rating_key — nothing can be done with it', async () => {
    fetchMock.mockResolvedValue(
      ok({ sessions: [{ session_key: '1', state: 'playing' }, { rating_key: 5, state: 'playing' }] }),
    )
    expect((await getActivity('http://tautulli:8181', 'key')).map((s) => s.rating_key)).toEqual(['5'])
  })

  it('defaults a missing guid to the empty string, not undefined', async () => {
    fetchMock.mockResolvedValue(ok({ sessions: [{ rating_key: 5, media_type: 'movie', state: 'playing' }] }))
    const [s] = await getActivity('http://tautulli:8181', 'key')
    expect(s!.guid).toBe('')
    expect(s!.show_guid).toBe('')
    expect(s!.progress_percent).toBe(0)
  })
})
```

Update the import at the top of the file:

```ts
import { getActivity, getChildren, getLibraryItems, resetLibraryRefreshCooldown } from '../server/utils/tautulli'
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run tests/tautulli.spec.ts -t getActivity`
Expected: FAIL — `getActivity is not a function`.

- [ ] **Step 4: Implement**

In `server/utils/tautulli.ts`, add to the type block near the other `Tautulli*` interfaces:

```ts
interface TautulliSession {
  session_key?: string | number
  rating_key?: string | number
  media_type?: string
  title?: string
  grandparent_title?: string
  parent_media_index?: string | number
  media_index?: string | number
  year?: string | number
  username?: string
  state?: string
  progress_percent?: string | number
  thumb?: string
  grandparent_thumb?: string
  library_name?: string
  section_id?: string | number
  guid?: string
  grandparent_rating_key?: string | number
  grandparent_guid?: string
}

interface TautulliActivityData {
  stream_count?: string | number
  sessions?: TautulliSession[]
}
```

And the function, after `getChildren`:

```ts
// Live sessions, for the Dashboard's Now playing card. Polled at view time only.
//
// Tautulli reports "nothing is playing" as a SUCCESSFUL reply with an empty
// sessions array, so there is no error to distinguish idle from broken — every
// shape that is not a populated array collapses to [] and the card simply does
// not render.
//
// Not driven by Tautulli's on_play/on_stop notifier triggers, deliberately: those
// post to /api/webhook/tautulli, and mapEvent() maps play/pause/stop to real Plex
// event names that processEvent then forwards to seenr. Enabling them to learn what
// is playing would start posting plays and stops to every user's seenr token.
const str = (v: unknown): string => (v == null ? '' : String(v))

export async function getActivity(url: string, apiKey: string): Promise<ActivitySession[]> {
  const data = await tautulliApi<TautulliActivityData>(url, apiKey, 'get_activity')
  const rows = Array.isArray(data?.sessions) ? data.sessions : []
  return rows
    .filter((s) => s.rating_key != null && String(s.rating_key) !== '')
    .map((s) => ({
      session_key: str(s.session_key),
      rating_key: str(s.rating_key),
      media_type: str(s.media_type),
      title: str(s.title),
      show_title: str(s.grandparent_title),
      season: str(s.parent_media_index),
      episode: str(s.media_index),
      year: str(s.year),
      username: str(s.username),
      state: str(s.state),
      // Tautulli sends this as a string; NaN would render as "NaN%".
      progress_percent: Number(s.progress_percent) || 0,
      image: s.grandparent_thumb || s.thumb || null,
      library_name: str(s.library_name),
      section_id: str(s.section_id),
      guid: str(s.guid),
      show_rating_key: str(s.grandparent_rating_key),
      show_guid: str(s.grandparent_guid),
    }))
}
```

Add `ActivitySession` to the existing `import type { ... } from '../../shared/types'` line at the top of the file.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run tests/tautulli.spec.ts` then `npm run typecheck`
Expected: PASS, typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add shared/types/index.ts server/utils/tautulli.ts tests/tautulli.spec.ts
git commit -m "feat(tautulli): read live sessions with get_activity"
```

---

### Task 2: The `pending_watches` table

**Files:**
- Modify: `server/utils/db.ts` (schema, migration guard, row interface, four functions)
- Test: `tests/db.spec.ts`

**Interfaces:**
- Consumes: `useDb()` from the same module.
- Produces, used by Tasks 3 and 4:
  - `addPendingWatches(ratingKey: string, guid: string | null, mappingIds: number[]): number` — rows written
  - `getPendingWatches(ratingKey: string, guid?: string | null): PendingWatch[]`
  - `deletePendingWatchesByIds(ids: number[]): void`
  - `sweepPendingWatches(): number` — rows dropped
  - `export interface PendingWatch { id: number; mapping: MappingRow }`

**Context:** One row per (item, profile). Keyed on the **item** — this episode, this film — because "count this episode" means exactly that. `guid` is stored and matched as a fallback for the same reason shares do it: two libraries can hold the same title under different `rating_key`s.

- [ ] **Step 1: Write the failing tests**

Append to `tests/db.spec.ts`:

```ts
describe('pending watches', () => {
  const DAY = 24 * 60 * 60 * 1000

  it('adds one row per profile and is idempotent per (item, profile)', async () => {
    const db = await freshDb()
    const alice = db.upsertMapping('alice', 'tok-a', 1, 1, 1)
    const bob = db.upsertMapping('bob', 'tok-b', 1, 1, 1)

    expect(db.addPendingWatches('12345', 'plex://episode/abc', [alice.id, bob.id])).toBe(2)
    // Clicking twice must not double-deliver.
    expect(db.addPendingWatches('12345', 'plex://episode/abc', [alice.id])).toBe(0)

    expect(db.getPendingWatches('12345').map((p) => p.mapping.username).sort()).toEqual(['alice', 'bob'])
  })

  it('matches on guid when the played copy has a different rating_key', async () => {
    const db = await freshDb()
    const alice = db.upsertMapping('alice', 'tok-a', 1, 1, 1)
    db.addPendingWatches('9815', 'plex://episode/abc', [alice.id])

    // Same episode, other library copy: different key, identical guid.
    expect(db.getPendingWatches('9809', 'plex://episode/abc')).toHaveLength(1)
    expect(db.getPendingWatches('9809', null)).toHaveLength(0)
  })

  it('never matches on an empty guid, which would collide across every item', async () => {
    const db = await freshDb()
    const alice = db.upsertMapping('alice', 'tok-a', 1, 1, 1)
    db.addPendingWatches('111', null, [alice.id])

    expect(db.getPendingWatches('222', '')).toHaveLength(0)
    expect(db.getPendingWatches('222', null)).toHaveLength(0)
    expect(db.getPendingWatches('111')).toHaveLength(1)
  })

  it('hides and sweeps rows older than 24h', async () => {
    const db = await freshDb()
    const alice = db.upsertMapping('alice', 'tok-a', 1, 1, 1)
    db.addPendingWatches('12345', null, [alice.id])
    // Age the row directly: an abandoned session leaves exactly this behind.
    db.useDb().prepare('UPDATE pending_watches SET created = ?').run(Date.now() - DAY - 1000)

    expect(db.getPendingWatches('12345')).toHaveLength(0)
    expect(db.sweepPendingWatches()).toBe(1)
    expect(db.sweepPendingWatches()).toBe(0)
  })

  it('deletes by id, so consuming a guid match removes the right row', async () => {
    const db = await freshDb()
    const alice = db.upsertMapping('alice', 'tok-a', 1, 1, 1)
    const bob = db.upsertMapping('bob', 'tok-b', 1, 1, 1)
    db.addPendingWatches('12345', null, [alice.id, bob.id])

    const rows = db.getPendingWatches('12345')
    db.deletePendingWatchesByIds([rows[0]!.id])

    expect(db.getPendingWatches('12345')).toHaveLength(1)
    db.deletePendingWatchesByIds([])
    expect(db.getPendingWatches('12345')).toHaveLength(1)
  })

  it('cascades when the mapping is deleted', async () => {
    const db = await freshDb()
    const alice = db.upsertMapping('alice', 'tok-a', 1, 1, 1)
    db.addPendingWatches('12345', null, [alice.id])

    db.deleteMapping(alice.id)

    expect(db.getPendingWatches('12345')).toHaveLength(0)
  })

  it('adds the table to a database created before it existed', async () => {
    const db = await freshDb()
    db.useDb().exec('DROP TABLE pending_watches')
    db.closeDb()

    const upgraded = await freshDb()
    expect(() => upgraded.getPendingWatches('1')).not.toThrow()
  })
})
```

**Note for the implementer:** confirm `deleteMapping` is the real export name in `db.ts` before running the cascade test — grep it. If mappings are deleted by another name, use that; do not add a new one.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/db.spec.ts -t "pending watches"`
Expected: FAIL — `db.addPendingWatches is not a function`.

- [ ] **Step 3: Add the schema**

In the `CREATE TABLE` block in `server/utils/db.ts`, after the `shared_titles` tables:

```sql
CREATE TABLE IF NOT EXISTS pending_watches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  -- The ITEM playing: this episode, or this film. Not the show — "count this
  -- episode" means this one, and the watched event carries the episode's own key.
  rating_key TEXT NOT NULL,
  guid TEXT,
  mapping_id INTEGER NOT NULL,
  created INTEGER NOT NULL,
  UNIQUE (rating_key, mapping_id),
  FOREIGN KEY (mapping_id) REFERENCES mappings (id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_pending_rating_key ON pending_watches (rating_key);
```

Then the migration guard, appended at the very bottom of the migration function:

```ts
// A whole table rather than a column, so the guard is CREATE TABLE IF NOT EXISTS
// run unconditionally — cheap, and it needs no table_info probe.
db.exec(`
  CREATE TABLE IF NOT EXISTS pending_watches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    rating_key TEXT NOT NULL,
    guid TEXT,
    mapping_id INTEGER NOT NULL,
    created INTEGER NOT NULL,
    UNIQUE (rating_key, mapping_id),
    FOREIGN KEY (mapping_id) REFERENCES mappings (id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_pending_rating_key ON pending_watches (rating_key);
`)
```

**Check first:** grep `db.ts` for `foreign_keys`. SQLite enforces `ON DELETE CASCADE` only when `PRAGMA foreign_keys = ON`. If the pragma is absent, add `db.pragma('foreign_keys = ON')` beside the other pragmas near `useDb()` — and re-run the **whole** suite, because enabling it retroactively enforces every existing FK.

- [ ] **Step 4: Implement the four functions**

Near the shared-titles helpers in `server/utils/db.ts`:

```ts
export interface PendingWatchRow {
  id: number
  rating_key: string
  guid: string | null
  mapping_id: number
  created: number
}

/** A pending one-off, joined to the profile it is for. `id` is carried so the
 *  consumer can delete the exact row it used — which matters when the row was
 *  matched by guid and its rating_key is not the key that was played. */
export interface PendingWatch {
  id: number
  mapping: MappingRow
}

const PENDING_TTL_MS = 24 * 60 * 60 * 1000

/** Rows older than the TTL are dropped. Swept on insert, the same way
 *  insertEvent trims the events cap: an abandoned session leaves a row behind and
 *  nothing else would ever come along to clear it. */
export function sweepPendingWatches(): number {
  return useDb()
    .prepare('DELETE FROM pending_watches WHERE created <= ?')
    .run(Date.now() - PENDING_TTL_MS).changes
}

export function addPendingWatches(
  ratingKey: string,
  guid: string | null,
  mappingIds: number[],
): number {
  sweepPendingWatches()
  const stmt = useDb().prepare(
    `INSERT OR IGNORE INTO pending_watches (rating_key, guid, mapping_id, created)
     VALUES (?, ?, ?, ?)`,
  )
  const now = Date.now()
  let written = 0
  const tx = useDb().transaction((ids: number[]) => {
    for (const id of ids) written += stmt.run(ratingKey, guid || null, id, now).changes
  })
  tx(mappingIds)
  return written
}

export function getPendingWatches(ratingKey: string, guid?: string | null): PendingWatch[] {
  // An empty guid must never match: it is the "Tautulli did not tell us" value,
  // and matching on it would make every pending row match every item.
  const g = guid || null
  const rows = useDb()
    .prepare(
      `SELECT p.id AS pending_id, m.*
         FROM pending_watches p
         JOIN mappings m ON m.id = p.mapping_id
        WHERE p.created > ?
          AND (p.rating_key = ? OR (? IS NOT NULL AND p.guid = ?))`,
    )
    .all(Date.now() - PENDING_TTL_MS, ratingKey, g, g) as (MappingRow & { pending_id: number })[]

  return rows.map(({ pending_id, ...mapping }) => ({ id: pending_id, mapping: mapping as MappingRow }))
}

export function deletePendingWatchesByIds(ids: number[]): void {
  if (!ids.length) return
  useDb()
    .prepare(`DELETE FROM pending_watches WHERE id IN (${ids.map(() => '?').join(',')})`)
    .run(...ids)
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run tests/db.spec.ts` then `npm test` then `npm run typecheck`
Expected: all PASS. Watch for `WARN Duplicated imports` in the typecheck output — none of these four names collide with h3, but the check is cheap.

- [ ] **Step 6: Commit**

```bash
git add server/utils/db.ts tests/db.spec.ts
git commit -m "feat(db): pending_watches, a one-shot record of who else to count"
```

---

### Task 3: The pipeline consumes pending one-offs

**Files:**
- Modify: `server/utils/pipeline.ts` (`processEvent`, lines ~148-217)
- Test: `tests/pipeline.spec.ts`

**Interfaces:**
- Consumes: `getPendingWatches`, `deletePendingWatchesByIds`, `PendingWatch` from Task 2.
- Produces: no new exports. Behaviour only.

**Context — read before editing.** `processEvent` currently returns *silently* when the username has no mapping (`pipeline.ts:149`), before any share lookup. A one-off must survive that, because "a guest is playing something, count it for me" is a primary use of the feature. The gate therefore becomes: return early only when there is neither a usable trigger **nor** a pending row.

The lookup order keeps the hot path cheap. The first query uses `rating_key` alone — one indexed `SELECT`, no Tautulli call. Only when it finds something (or a trigger exists) does the function go on to `get_metadata`. After metadata, it queries again *including* the guid, to catch the cross-library copy.

- [ ] **Step 1: Write the failing tests**

Append to `tests/pipeline.spec.ts`:

```ts
describe('processEvent one-off pending watches', () => {
  it('delivers to a pending profile and deletes the row', async () => {
    const { db, pipeline } = await configured()
    db.upsertMapping('alice', 'tok-a', 1, 1, 1)
    const bob = db.upsertMapping('bob', 'tok-b', 1, 1, 1)
    db.addPendingWatches('12345', null, [bob.id]) // '12345' is the fixture episode

    const r = await pipeline.processEvent(input) // alice plays it

    expect(r.ok).toBe(true)
    expect(forwardToSeenr).toHaveBeenCalledTimes(2)
    expect(db.listEvents(10).map((row) => row.username).sort()).toEqual(['alice', 'bob'])
    // Consumed: a rewatch next week must not silently fire again.
    expect(db.getPendingWatches('12345')).toHaveLength(0)
  })

  it('fires even when the person playing has no mapping at all', async () => {
    const { db, pipeline } = await configured()
    const bob = db.upsertMapping('bob', 'tok-b', 1, 1, 1)
    db.addPendingWatches('12345', null, [bob.id])

    // 'alice' is not mapped: today this returns before any lookup.
    const r = await pipeline.processEvent(input)

    expect(forwardToSeenr).toHaveBeenCalledOnce()
    expect(db.listEvents(10).map((row) => row.username)).toEqual(['bob'])
    expect(r.fanout).toBe(1)
  })

  it('still returns silently for an unmapped user with nothing pending', async () => {
    const { db, pipeline } = await configured()
    const r = await pipeline.processEvent(input)

    expect(r.skipped).toBe(true)
    expect(r.reason).toContain('No seenr mapping')
    expect(forwardToSeenr).not.toHaveBeenCalled()
    expect(db.listEvents(10)).toHaveLength(0)
  })

  it('fires when the trigger mapping is disabled — the one-off is about other people', async () => {
    const { db, pipeline } = await configured()
    db.upsertMapping('alice', 'tok-a', 0, 1, 1) // disabled
    const bob = db.upsertMapping('bob', 'tok-b', 1, 1, 1)
    db.addPendingWatches('12345', null, [bob.id])

    await pipeline.processEvent(input)

    expect(db.listEvents(10).map((row) => row.username)).toEqual(['bob'])
  })

  it('does not double-deliver to a profile already in the share', async () => {
    const { db, pipeline } = await configured()
    const alice = db.upsertMapping('alice', 'tok-a', 1, 1, 1)
    const bob = db.upsertMapping('bob', 'tok-b', 1, 1, 1)
    db.setSharedTitle({ rating_key: '999', media_type: 'show' }, [alice.id, bob.id])
    db.addPendingWatches('12345', null, [bob.id])

    const r = await pipeline.processEvent(input)

    expect(r.fanout).toBe(2)
    expect(forwardToSeenr).toHaveBeenCalledTimes(2)
  })

  it('matches a pending row by guid when the other library copy is played', async () => {
    const { db, pipeline } = await configured()
    db.upsertMapping('alice', 'tok-a', 1, 1, 1)
    const bob = db.upsertMapping('bob', 'tok-b', 1, 1, 1)
    // Pending was filed against a different key, same episode guid.
    db.addPendingWatches('99999', 'plex://episode/abc', [bob.id])

    await pipeline.processEvent(input) // fixture meta.guid === 'plex://episode/abc'

    expect(db.listEvents(10).map((row) => row.username).sort()).toEqual(['alice', 'bob'])
    expect(db.getPendingWatches('99999', 'plex://episode/abc')).toHaveLength(0)
  })

  it('marks Plex for a one-off only when the title share says so', async () => {
    const { db, pipeline } = await configured()
    db.saveSettings({ plex_token: 'owner-tok' })
    const alice = db.upsertMapping('alice', 'tok-a', 1, 1, 1)
    const bob = db.upsertMapping('bob', 'tok-b', 1, 1, 1)
    db.setSharedTitle({ rating_key: '999', media_type: 'show', plex_sync: 1 }, [alice.id])
    db.addPendingWatches('12345', null, [bob.id])

    await pipeline.processEvent(input)

    // Inherited from the show's share; bob is not the trigger, so he is written.
    expect(markWatched).toHaveBeenCalledOnce()
    expect(markWatched).toHaveBeenCalledWith('http://plex:32400', 'tok-bob', '12345')
  })

  it('leaves Plex alone for a one-off on an unshared title', async () => {
    const { db, pipeline } = await configured()
    db.saveSettings({ plex_token: 'owner-tok' })
    db.upsertMapping('alice', 'tok-a', 1, 1, 1)
    const bob = db.upsertMapping('bob', 'tok-b', 1, 1, 1)
    db.addPendingWatches('12345', null, [bob.id])

    await pipeline.processEvent(input)

    expect(markWatched).not.toHaveBeenCalled()
  })

  it('consumes nothing on a dry run, so Preview cannot burn a one-off', async () => {
    const { db, pipeline } = await configured()
    db.upsertMapping('alice', 'tok-a', 1, 1, 1)
    const bob = db.upsertMapping('bob', 'tok-b', 1, 1, 1)
    db.addPendingWatches('12345', null, [bob.id])

    await pipeline.processEvent(input, { dryRun: true, record: false })

    expect(forwardToSeenr).not.toHaveBeenCalled()
    expect(db.getPendingWatches('12345')).toHaveLength(1)
  })

  it('does not consume an expired row', async () => {
    const { db, pipeline } = await configured()
    db.upsertMapping('alice', 'tok-a', 1, 1, 1)
    const bob = db.upsertMapping('bob', 'tok-b', 1, 1, 1)
    db.addPendingWatches('12345', null, [bob.id])
    db.useDb().prepare('UPDATE pending_watches SET created = ?').run(Date.now() - 25 * 60 * 60 * 1000)

    await pipeline.processEvent(input)

    expect(db.listEvents(10).map((row) => row.username)).toEqual(['alice'])
  })
})
```

**Note:** the fixture's `markWatched` assertion uses `'tok-bob'` because `resolvePlexToken` is mocked as `` `tok-${username}` ``. Check the mock at the top of `pipeline.spec.ts` before trusting that string.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/pipeline.spec.ts -t "one-off"`
Expected: FAIL — the unmapped case returns `skipped` and forwards nothing.

- [ ] **Step 3: Rewrite the gate**

In `server/utils/pipeline.ts`, extend the import from `./db` with `getPendingWatches`, `deletePendingWatchesByIds` and `type PendingWatch`, then replace the trigger block (currently lines 148-152):

```ts
  const trigger = getMappingByUsername(input.username)

  // Pending one-offs are consulted BEFORE the unmapped-user return below, and this
  // is the reason the query takes only the rating_key: it runs on a path that used
  // to cost nothing, so it has to stay one indexed SELECT with no Tautulli call.
  // Without it, "a guest account is playing something, count it for me" — the case
  // the Now playing card exists for — would silently do nothing.
  const pendingByKey = getPendingWatches(input.rating_key)

  const triggerUsable = !!trigger && !!trigger.enabled
  if (!triggerUsable && !pendingByKey.length) {
    if (!trigger)
      return { ok: false, skipped: true, reason: `No seenr mapping for user "${input.username}"` }
    return { ok: false, skipped: true, reason: `Mapping for "${input.username}" is disabled` }
  }
```

- [ ] **Step 4: Fold the one-offs into the recipient list**

Replace the fan-out block (currently lines 186-196, from `const key =` down to the `plex` assignment):

```ts
  const key = titleKeyFor(meta, input.rating_key)
  const guid = titleGuidFor(meta)
  const shared = getSharedRecipients(key, guid)

  // Queried a second time, now that metadata is in hand: the first pass could only
  // match the exact rating_key, and a pending row filed against the other library
  // copy of this episode matches on the item's guid instead.
  const pending: PendingWatch[] = getPendingWatches(input.rating_key, meta.guid || null)

  let recipients: MappingRow[] = triggerUsable ? [trigger!] : []
  if (shared.length && trigger && shared.some((r) => r.id === trigger.id)) recipients = shared
  // One-offs join the list, deduped: a profile already in the share must not be
  // delivered to twice, and the pending row is still consumed either way.
  for (const p of pending) {
    if (!recipients.some((r) => r.id === p.mapping.id)) recipients.push(p.mapping)
  }

  // Plex marking is opt-in per share, and a one-off INHERITS that rather than
  // deciding for itself: the bridge must not start writing into other people's
  // Plex libraries because somebody used a quick action.
  const share = recipients.length > 1 || pending.length ? getSharedTitle(key, guid) : undefined
  const plex = share?.plex_sync ? await plexTargetFor(settings) : { target: null, error: null }
```

- [ ] **Step 5: Consume the rows, and fix the trigger comparison**

Inside the delivery loop, the trigger test must tolerate there being no trigger at all:

```ts
    const isTrigger = !!trigger && rcpt.id === trigger.id
```

Then immediately after the loop, before the `if (!triggerResult)` block:

```ts
  // Consumed once the deliveries for this watch are done, whatever their outcome:
  // the intent was "count this item", the item has now been watched, and a row left
  // behind would fire again on a rewatch weeks later.
  if (pending.length) deletePendingWatchesByIds(pending.map((p) => p.id))
```

Finally, the `!triggerResult` branch must not claim a skip when the only deliveries were one-offs. Replace it with:

```ts
  // No trigger row is written when the person playing is unmapped or their mapping
  // is off — but a one-off may still have delivered, so `ok` follows what happened,
  // not who triggered it.
  if (!triggerResult) {
    if (!triggerUsable)
      return { ok: delivered > 0, skipped: delivered === 0, fanout: delivered, ...common }
    const why = meta.media_type === 'movie' ? 'Movie sync is off' : meta.media_type === 'episode' ? 'Episode sync is off' : 'Skipped'
    return { ok: delivered > 0, skipped: delivered === 0, reason: `${why} for ${trigger!.username}`, fanout: delivered, ...common }
  }
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run tests/pipeline.spec.ts` then `npm test` then `npm run typecheck`
Expected: all PASS. The pre-existing guard tests (`skips when the username has no mapping`, `skips when the mapping is disabled`) must still pass untouched — if either fails, the gate rewrite is wrong, not the test.

- [ ] **Step 7: Commit**

```bash
git add server/utils/pipeline.ts tests/pipeline.spec.ts
git commit -m "feat(pipeline): consume one-off pending watches, even for unmapped players"
```

---

### Task 4: The two endpoints

**Files:**
- Create: `server/api/tautulli/activity.get.ts`
- Create: `server/api/pending/index.post.ts`
- Modify: `docs/api.md`

**Interfaces:**
- Consumes: `getActivity` (Task 1), `addPendingWatches` (Task 2), `getSettings`, `listMappings`.
- Produces: `GET /api/tautulli/activity` → `ActivitySession[]`; `POST /api/pending` → `{ added: number }`.

**Context:** These are `server/api/*`, so they **do** use Nitro auto-imports (`defineEventHandler`, `readBody`, `createError`) — the opposite of `server/utils/*`. Both are authed, so nothing goes in `PUBLIC_API_PATHS`.

- [ ] **Step 1: The activity endpoint**

Create `server/api/tautulli/activity.get.ts`:

```ts
import { getSettings } from '../../utils/db'
import { getActivity } from '../../utils/tautulli'
import type { ActivitySession } from '../../../shared/types'

// Polled by the Dashboard while it is open. An unconfigured or unreachable Tautulli
// yields [] rather than an error: the card is an extra on a page that must keep
// rendering its history, and a 500 here would break the whole Dashboard fetch.
export default defineEventHandler(async (): Promise<ActivitySession[]> => {
  const s = getSettings()
  if (!s.tautulli_url || !s.tautulli_apikey) return []
  try {
    return await getActivity(s.tautulli_url, s.tautulli_apikey)
  } catch {
    return []
  }
})
```

- [ ] **Step 2: The pending endpoint**

Create `server/api/pending/index.post.ts`:

```ts
import { addPendingWatches, listMappings } from '../../utils/db'

// Records "when this item is watched, count it for these profiles too".
export default defineEventHandler(async (event) => {
  const body = await readBody<{ rating_key?: string; guid?: string; mapping_ids?: number[] }>(event)

  const rating_key = String(body?.rating_key ?? '').trim()
  if (!rating_key) throw createError({ statusCode: 400, statusMessage: 'rating_key is required' })

  const requested = Array.isArray(body?.mapping_ids) ? body.mapping_ids.map(Number) : []
  if (!requested.length) throw createError({ statusCode: 400, statusMessage: 'Pick at least one profile' })

  // Only real mappings: an id from a stale page must 400, not write a row that can
  // never resolve to a seenr token.
  const known = new Set(listMappings().map((m) => m.id))
  const unknown = requested.filter((id) => !known.has(id))
  if (unknown.length)
    throw createError({ statusCode: 400, statusMessage: `Unknown profile id ${unknown.join(', ')}` })

  return { added: addPendingWatches(rating_key, body?.guid || null, requested) }
})
```

**Check first:** grep `db.ts` for the function that lists mappings — it may be `listMappings` or `getMappings`. Use the real name.

- [ ] **Step 3: Verify by hand**

Run `npm run dev`, sign in, then in the browser console:

```js
await $fetch('/api/tautulli/activity')                                  // [] when idle
await $fetch('/api/pending', { method: 'POST', body: { mapping_ids: [] } })  // 400
```

Expected: the array (or `[]`), and a clean 400 rather than an HTML shell. A 200 with HTML means the route file is misplaced.

- [ ] **Step 4: Document both**

Add to `docs/api.md`, matching the surrounding style:

```markdown
### `GET /api/tautulli/activity`

Live Tautulli sessions, as `ActivitySession[]`. `[]` when nothing is playing, when
Tautulli is not configured, and when Tautulli cannot be reached — the Dashboard
treats all three the same, by not rendering the Now playing card.

### `POST /api/pending`

Body: `{ rating_key: string, guid?: string, mapping_ids: number[] }`.
Records a one-off: when that item's `watched` event arrives, it is also counted for
those profiles, then the record is deleted. Rows expire after 24h. Returns
`{ added: number }`; adding the same profile twice adds nothing.
```

- [ ] **Step 5: Commit**

```bash
git add server/api/tautulli/activity.get.ts server/api/pending/index.post.ts docs/api.md
git commit -m "feat(api): serve live activity and record one-off watches"
```

---

### Task 5: `LiveDot` — the pulsing state indicator

**Files:**
- Create: `app/components/LiveDot.vue`

**Interfaces:**
- Produces: `<LiveDot :state="session.state" />`, auto-imported by Nuxt.

**Context:** The dot reflects **state**, not merely presence. A pulse on a paused stream claims something untrue, and playing-vs-paused is what the operator wants at a glance. Tailwind's `animate-ping` is exactly the scale-and-fade ring wanted, and `motion-reduce:animate-none` is the reduced-motion escape — no custom keyframes needed.

- [ ] **Step 1: Confirm UChip is registered**

Run: `grep -c "UChip" .nuxt/components.d.ts`
Expected: at least 1. (A misspelled Nuxt UI component passes typecheck and build, then renders nothing.)

- [ ] **Step 2: Write the component**

```vue
<script setup lang="ts">
// The live signal for the Now playing card. It reports Tautulli's session state
// rather than just "something is on": a pulse next to a paused stream would be a
// lie, and paused-vs-playing is the thing worth knowing at a glance.
//
// The pulse is a ring BEHIND the dot (Tailwind's animate-ping: scale + fade), not
// an opacity blink on the dot itself, so the dot's own colour stays readable at
// every frame. `motion-reduce:animate-none` leaves a solid dot when the viewer has
// asked for less motion — the state still reads, from the colour and from the word
// the card prints beside it.
const props = defineProps<{ state: string }>()

const kind = computed(() => {
  switch ((props.state || '').toLowerCase()) {
    case 'playing': return { color: 'success' as const, ping: 'bg-success', pulses: true }
    case 'buffering': return { color: 'info' as const, ping: 'bg-info', pulses: true }
    case 'paused': return { color: 'warning' as const, ping: '', pulses: false }
    default: return { color: 'neutral' as const, ping: '', pulses: false }
  }
})
</script>

<template>
  <span class="relative inline-flex items-center justify-center">
    <span
      v-if="kind.pulses"
      class="absolute size-1.5 animate-ping rounded-full opacity-75 motion-reduce:animate-none"
      :class="kind.ping"
      aria-hidden="true"
    />
    <UChip standalone inset size="xs" :color="kind.color" />
  </span>
</template>
```

- [ ] **Step 3: Verify it renders**

Run `npm run dev` and drop `<LiveDot state="playing" /><LiveDot state="paused" />` temporarily at the top of `app/pages/dashboard.vue`.
Expected: a green pulsing dot and a static amber one. Then remove the temporary markup.

- [ ] **Step 4: Commit**

```bash
git add app/components/LiveDot.vue
git commit -m "feat(ui): a state-aware live dot, quiet under reduced motion"
```

---

### Task 6: The `NowPlaying` card

**Files:**
- Create: `app/components/NowPlaying.vue`

**Interfaces:**
- Consumes: `ActivitySession` (Task 1), `Mapping`, `LiveDot` (Task 5), `POST /api/pending` (Task 4), the existing `POST /api/shared` used by `SharedTitleModal`.
- Produces: `<NowPlaying :sessions="..." :mappings="..." @changed="..." />`, emitting `changed` after a successful write so the parent can refresh.

**Context:** The profile checklist is deliberately **not** extracted from `SharedTitleModal`. That picker is six lines of `UCheckbox` in a `v-for`; a shared component for it would be indirection without payoff. If a third copy ever appears, extract then.

Session → share subject: an episode shares its **show** (`show_rating_key` / `show_guid`), a movie shares itself (`rating_key` / `guid`). When Tautulli's session omits the guid, resolve it with `get_metadata` **on click** — never per poll.

- [ ] **Step 1: Check the shared-title endpoint's contract**

Run: `grep -n "method\|body" app/components/SharedTitleModal.vue | head -20` and read `server/api/shared/index.post.ts`.
Write down the exact body shape it wants. The next step's `shareShow()` must match it — do not invent a payload.

- [ ] **Step 2: Write the component**

```vue
<script setup lang="ts">
import type { ActivitySession, Mapping } from '../../shared/types'

const props = defineProps<{ sessions: ActivitySession[]; mappings: Mapping[] }>()
const emit = defineEmits<{ changed: [] }>()

const toast = useToast()
const busy = ref<string | null>(null)
// Which session's profile picker is open, and what is ticked in it.
const picking = ref<string | null>(null)
const picked = ref<number[]>([])

function label(s: ActivitySession) {
  return s.media_type === 'episode' && s.show_title ? s.show_title : s.title
}

function sub(s: ActivitySession) {
  if (s.media_type === 'episode')
    return `S${s.season || '?'}·E${s.episode || '?'}${s.title ? `  ·  ${s.title}` : ''}`
  return s.year
}

function openPicker(s: ActivitySession) {
  picking.value = s.session_key
  // Nobody is pre-ticked: this action sends somebody else's watch history somewhere,
  // so it must be an explicit choice every time.
  picked.value = []
}

function toggle(id: number, on: boolean) {
  picked.value = on ? [...picked.value, id] : picked.value.filter((x) => x !== id)
}

async function countThis(s: ActivitySession) {
  busy.value = s.session_key
  try {
    const { added } = await $fetch<{ added: number }>('/api/pending', {
      method: 'POST',
      body: { rating_key: s.rating_key, guid: s.guid || undefined, mapping_ids: picked.value },
    })
    // Says when it will happen, not that it has: the watch has not finished yet.
    toast.add({
      title: added
        ? `Will be counted for ${added === 1 ? '1 profile' : `${added} profiles`} when this finishes.`
        : 'Already queued for those profiles.',
      color: 'success',
    })
    picking.value = null
    emit('changed')
  } catch (e) {
    toast.add({ title: apiErrorMessage(e, 'Could not queue that.'), color: 'error' })
  } finally {
    busy.value = null
  }
}
</script>

<template>
  <UCard v-if="sessions.length">
    <template #header>
      <div class="flex items-center gap-2">
        <h2 class="text-sm font-semibold text-highlighted">Now playing</h2>
        <LiveDot :state="sessions.some((s) => s.state === 'playing') ? 'playing' : 'paused'" />
      </div>
    </template>

    <div class="divide-y divide-default">
      <div v-for="s in sessions" :key="s.session_key" class="flex items-start gap-3 py-3 first:pt-0">
        <img
          v-if="s.image"
          :src="`/api/image?path=${encodeURIComponent(s.image)}`"
          alt=""
          loading="lazy"
          class="h-[72px] w-12 shrink-0 rounded-md object-cover ring-1 ring-default"
        >
        <div v-else class="h-[72px] w-12 shrink-0 rounded-md bg-elevated ring-1 ring-default" />

        <div class="min-w-0 flex-1">
          <div class="truncate text-sm font-medium text-highlighted">{{ label(s) }}</div>
          <div class="mt-0.5 truncate text-xs text-muted">{{ sub(s) }}</div>
          <div class="mt-1 flex items-center gap-1.5 text-xs text-dimmed">
            <LiveDot :state="s.state" />
            {{ s.username }} · {{ s.state }} · {{ s.progress_percent }}%
          </div>
          <UProgress :model-value="s.progress_percent" :max="100" size="sm" class="mt-2" />

          <div v-if="picking === s.session_key" class="mt-3 space-y-1">
            <UCheckbox
              v-for="m in mappings"
              :key="m.id"
              :label="m.username"
              :model-value="picked.includes(m.id)"
              @update:model-value="(v) => toggle(m.id, v === true)"
            />
            <div class="flex gap-2 pt-1">
              <UButton
                size="xs"
                :disabled="!picked.length"
                :loading="busy === s.session_key"
                label="Count for these"
                @click="countThis(s)"
              />
              <UButton size="xs" color="neutral" variant="ghost" label="Cancel" @click="picking = null" />
            </div>
          </div>
          <div v-else class="mt-2 flex flex-wrap gap-2">
            <UButton
              size="xs"
              color="neutral"
              variant="subtle"
              icon="i-lucide-user-plus"
              label="Count this for…"
              @click="openPicker(s)"
            />
          </div>
        </div>
      </div>
    </div>
  </UCard>
</template>
```

- [ ] **Step 3: Confirm every component used exists**

Run: `grep -E "UCard|UProgress|UCheckbox|UButton" .nuxt/components.d.ts | head`
Expected: all four present. If `UProgress` is absent under that name, find the real one — **do not** ship an invisible bar.

- [ ] **Step 4: Wire "Share this show" — its own step because it needs Task 6 Step 1's answer**

Add to the script, using the body shape recorded in Step 1:

```ts
async function shareShow(s: ActivitySession) {
  busy.value = s.session_key
  try {
    // An episode shares its SHOW; a movie shares itself. When the session carries no
    // guid, resolve it on click — one call, on demand, never per poll.
    const isEpisode = s.media_type === 'episode'
    const rating_key = isEpisode ? s.show_rating_key || s.rating_key : s.rating_key
    let guid = isEpisode ? s.show_guid : s.guid
    if (!guid) {
      const meta = await $fetch<{ guid?: string; grandparent_guid?: string }>('/api/tautulli/metadata', {
        query: { rating_key },
      })
      guid = meta?.guid || ''
    }
    await $fetch('/api/shared', {
      method: 'POST',
      body: { rating_key, guid, media_type: isEpisode ? 'show' : 'movie', profiles: picked.value },
    })
    toast.add({ title: 'Shared. Future watches fan out too.', color: 'success' })
    picking.value = null
    emit('changed')
  } catch (e) {
    toast.add({ title: apiErrorMessage(e, 'Could not share that.'), color: 'error' })
  } finally {
    busy.value = null
  }
}
```

and the second button beside the first:

```vue
            <UButton
              size="xs"
              color="neutral"
              variant="subtle"
              icon="i-lucide-users"
              label="Share this show"
              @click="shareShow(s)"
            />
```

**If `/api/tautulli/metadata` does not exist**, grep `server/api/tautulli/` for the route that wraps `getMetadata` and use that path — the picker already fetches metadata somewhere, so a route exists.

- [ ] **Step 5: Commit**

```bash
git add app/components/NowPlaying.vue
git commit -m "feat(ui): the Now playing card, with both add-profile actions"
```

---

### Task 7: Wire it into the Dashboard

**Files:**
- Modify: `app/pages/dashboard.vue`

**Interfaces:**
- Consumes: `NowPlaying` (Task 6), `GET /api/tautulli/activity` (Task 4).

**Context:** The page already polls every 5s. Activity joins that same tick — do not add a second timer. Read how the existing refresh is built (`useFetch`? `setInterval`? a store?) and follow it exactly.

- [ ] **Step 1: Read the existing poll**

Run: `grep -n "setInterval\|useFetch\|refresh\|5000\|onMounted\|onUnmounted" app/pages/dashboard.vue`
Write down which mechanism drives the 5s refresh, and whether mappings are already fetched on this page (the card needs them).

- [ ] **Step 2: Fetch activity alongside it**

Add to the script, matching whatever the page already does:

```ts
const { data: activity, refresh: refreshActivity } = await useFetch<ActivitySession[]>(
  '/api/tautulli/activity',
  { default: () => [], lazy: true },
)
```

and call `refreshActivity()` inside the existing tick, beside the existing refreshes. If mappings are not already loaded here, fetch them the same way the Shared page does.

- [ ] **Step 3: Render the card above Recent scrobbles**

```vue
    <!-- Absent, not empty, when nothing plays: an idle card reporting a non-event
         would occupy the top of the page permanently. -->
    <NowPlaying
      :sessions="activity ?? []"
      :mappings="mappings ?? []"
      @changed="refreshActivity()"
    />
```

placed immediately before the Recent scrobbles card.

- [ ] **Step 4: Verify end to end**

1. `npm run dev`, sign in, open the Dashboard — no card while idle.
2. Press play on something in Plex. Within ~5s the card appears: poster, title, `username · playing · N%`, a **green pulsing dot**, a progress bar.
3. Pause it. Within ~5s the dot is **amber and static** and the word reads `paused`.
4. Click **Count this for…**, tick a profile, confirm. Toast says it will be counted when the watch finishes.
5. Check the row exists: `sqlite3 data/seenr-bridge.db 'SELECT * FROM pending_watches;'`
6. Let the item finish (or seek past ~90% so Tautulli fires `watched`). The Dashboard gets a new event **naming that profile**, and the pending row is gone.
7. Stop playback — the card disappears within ~5s.
8. In macOS System Settings → Accessibility → Display → Reduce motion, confirm the dot stops animating and stays solid.

- [ ] **Step 5: Run the full suite and commit**

```bash
npm run typecheck && npm test
git add app/pages/dashboard.vue
git commit -m "feat(ui): show Now playing on the Dashboard"
```

---

### Task 8: Version and changelog

**Files:**
- Modify: `shared/version.ts`
- Modify: `CHANGELOG.md`

**Context:** One bump per release, at the end. `.github/workflows/pr-checks.yml` fails the PR when app code changed without both a bump and a matching `## X.Y.Z` section. Do **not** run `git tag` or `gh release create` — the workflow does that from the version file on merge.

- [ ] **Step 1: Bump**

```ts
export const VERSION = '2.5.0'
```

- [ ] **Step 2: Write the section**

At the top of `CHANGELOG.md`, above `## 2.4.1`:

```markdown
## 2.5.0

### Added

- **Now playing on the Dashboard.** While anyone is streaming, a card at the top shows what it is, who is watching, and how far in, with a green pulsing dot that goes amber and still when the stream is paused. It appears only while something plays, and it costs nothing when the page is closed — the Dashboard asks Tautulli for live sessions on the same refresh it already runs, and nothing polls in the background.
- **Count a watch for someone who was not in the share.** Two people sit down together unplanned: pick their profiles from the Now playing card and this watch is counted for them when it finishes, exactly when it counts for the person who pressed play. Nothing is added to the Shared page and future episodes are unaffected. It also works when the person playing is not one of your mapped users at all, which is the case a share could never cover.
- **Share the playing title from the same card**, for when it is not a one-off — the equivalent of adding it on the Shared page, without leaving the Dashboard or typing the title.

### Notes

- A one-off marks Plex only if that title's share already has Plex marking switched on. A quick action never starts writing into other people's Plex libraries on its own.
- A one-off that never completes — the stream is abandoned — expires after 24 hours and sends nothing.
```

- [ ] **Step 3: Verify and commit**

```bash
npm run typecheck && npm test
git add shared/version.ts CHANGELOG.md
git commit -m "chore: bump version to 2.5.0"
```

- [ ] **Step 4: Push and open the PR**

```bash
git push -u origin feat/now-playing
GH_CONFIG_DIR="$HOME/.config/gh-isntw" gh pr create --base main
```

---

## Self-review notes

- **Spec coverage:** card (6, 7), pulsing state dot with reduced motion (5), `get_activity` polling (1, 4, 7), push-rejection rationale (recorded in code comments in 1), two actions (6), one-off fires at `watched` (3), unmapped player (3), Plex inheritance (3), item-keyed with guid fallback (2, 3), TTL swept on insert (2), every listed test (1, 2, 3), version (8).
- **Deliberately deferred:** deleting a queued one-off from the UI. Nothing in the spec asks for it, the TTL bounds the mistake at 24h, and it is additive later.
- **Known unknowns flagged inline, not guessed:** the `foreign_keys` pragma (Task 2 Step 3), the mapping-list function's name (Task 4 Step 2), the mapping-delete function's name (Task 2 Step 1), the `/api/shared` body shape (Task 6 Step 1), the metadata route path (Task 6 Step 4), and the Dashboard's refresh mechanism (Task 7 Step 1). Each is a grep, not a decision.
