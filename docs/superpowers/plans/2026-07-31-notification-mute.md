# Notification Copy, Per-Show Muting, and the Deep-Link Race — Implementation Plan

> **For agentic workers:** implement task-by-task, in order. Steps use checkbox (`- [ ]`) syntax for tracking. Each task ends with its own verification and commit; do not batch commits.

**Goal:** New notification copy; one notification per show instead of one per episode; a deliberate, persistent way to mute a show; and a fix for the Watch-together dialog opening empty when reached from a notification.

**Architecture:** Two dedupe tiers in `server/utils/notify.ts` (exact item pre-metadata, show post-metadata), a new `notify_mutes` table with three authed endpoints, a mute switch in the existing Watch-together modal plus an Android/desktop notification action, and a `ready` gate on the modal's deep-link open path.

**Tech Stack:** Nuxt 4 (`ssr: false`), Nuxt UI v4, better-sqlite3, `web-push`, Vitest 4. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-07-31-notification-mute-design.md`

**Branch:** `feat/notification-mute`, in the worktree at `.claude/worktrees/notification-mute`. Spec already committed as `efa2577`.

**Baseline:** 264 tests across 11 files pass, `npm run typecheck` clean, `shared/version.ts` at `2.6.1`.

## Global Constraints

- **No new dependencies.** `package.json` and `package-lock.json` unchanged at the end of the branch.
- **`server/utils/*` uses explicit relative imports, never Nitro auto-imports.** `server/api/*` does the opposite. Breaking this breaks the specs' ability to resolve those modules.
- **Check new `server/utils` export names against h3's auto-imports.** `npm run typecheck` reports collisions as `WARN Duplicated imports`. `isNotifyMuted`, `listNotifyMutes`, `addNotifyMute`, `deleteNotifyMute` and `subjectKey` are all expected to be clear, but confirm rather than assume.
- **No notify path writes an `events` row.** That table is capped at 1000 and trimmed on every insert; play-time rows would flush real scrobbles out twice as fast.
- **Nothing is added to `PUBLIC_API_PATHS`.** The service worker's `fetch` carries the same-origin session cookie, so the mute endpoints stay authed.
- **One version bump for the whole branch, at the end:** `shared/version.ts` → `2.6.2` plus a matching `## 2.6.2` section in `CHANGELOG.md`. The PR check fails without both.
- **Check any first-time Nuxt UI component against `.nuxt/components.d.ts`.** A misspelled name passes typecheck *and* build, then renders nothing. `USwitch`, `UCheckbox`, `UButton` and `USeparator` are all already used in the files being touched.
- **Never commit to `main`.** All work on `feat/notification-mute` in the worktree, merged via PR.
- **`npm test` after every task**, not just at the end. The suite runs in ~2s; there is no reason to defer it.

---

### Task 1: New notification copy

**Files:**
- Modify: `server/utils/notify.ts`
- Modify: `tests/notify.spec.ts`

**Interfaces:**
- Consumes: `showOrTitle()` and `detail()`, unchanged.
- Produces: the `title`/`body` strings every later task's tests assert around.

`detail()` already emits `S5·E14 · Ozymandias` for an episode and the bare year for a movie, so this task adds no formatting logic. The `.filter(Boolean)` on both lines is load-bearing: a movie with no year must not render a trailing em dash.

- [ ] **Step 1: Rewrite the payload's title and body**

In `handlePlaybackStart`, replace the `title`/`body` lines of the `sendToAll` call:

```ts
  const send = await sendToAll({
    title: [showOrTitle(meta), detail(meta)].filter(Boolean).join(' — '),
    body: `Started by ${input.username} · Watch together →`,
    url: `/dashboard?watch=${encodeURIComponent(input.rating_key)}&user=${encodeURIComponent(input.username)}`,
    tag: dedupeKey(input.username, input.rating_key),
  })
```

`url` and `tag` are untouched here; `tag` changes in Task 2.

- [ ] **Step 2: Update the copy assertions**

`tests/notify.spec.ts` currently asserts the old strings at `:288-320`. Replace those three tests' expectations:

```ts
  it('names the show and episode in the title', async () => {
    const { db, notify } = await load()
    enable(db)

    await notify.handlePlaybackStart(play)

    const payload = sendToAll.mock.calls[0]![0]
    expect(payload.title).toBe('Breaking Bad — S5·E14 · Ozymandias')
    expect(payload.body).toBe('Started by alice · Watch together →')
  })
```

Mirror it for the movie case: `expect(payload.title).toBe('The Matrix — 1999')`. Keep the deep-link test as-is.

- [ ] **Step 3: Add a no-year movie case**

Proves the `.filter(Boolean)` rather than trusting it:

```ts
  it('omits the dash when a movie has no year', async () => {
    const { db, notify } = await load()
    enable(db)
    getMetadata.mockImplementation(async () => ({ ...movie, year: '' }))

    await notify.handlePlaybackStart({ ...play, rating_key: '555' })

    expect(sendToAll.mock.calls[0]![0].title).toBe('The Matrix')
  })
```

- [ ] **Step 4: Verify and commit**

```bash
npm test && npm run typecheck
git commit -am "feat(notify): put the subject in the title and the actor in the body"
```

---

### Task 2: Two-tier dedupe and a show-scoped tag

**Files:**
- Modify: `server/utils/notify.ts`
- Modify: `tests/notify.spec.ts`

**Interfaces:**
- Produces: `export function subjectKey(m: TautulliMetadata): string` — Task 4's mute gate and Task 8's payload both use it.
- Produces: `resetNotifyDedupe()` keeps its existing signature; the specs already call it between cases.

**The bug being fixed:** `dedupeKey()` is `username:rating_key`, and `rating_key` identifies the episode. Every episode is a key the map has never seen, so the 30-minute window never applies and a 100-episode binge sends 100 notifications.

**Why two tiers rather than one show-scoped check:** the webhook carries only the episode's `rating_key`. Which show it belongs to is unknown until `get_metadata` returns, so a pre-metadata check cannot be show-scoped — and a single post-metadata check would spend a Tautulli round-trip on every pause/resume re-fire.

- [ ] **Step 1: Replace the dedupe primitives**

Swap the current constant, `dedupeKey`, `seenRecently` and `remember` for:

```ts
const ITEM_WINDOW_MS = 30 * 60 * 1000
const SHOW_WINDOW_MS = 6 * 60 * 60 * 1000

const recent = new Map<string, number>()

export function resetNotifyDedupe(): void {
  recent.clear()
}

function itemKey(username: string, ratingKey: string): string {
  return `${username.toLowerCase()}:${ratingKey}`
}

export function subjectKey(m: TautulliMetadata): string {
  return m.media_type === 'episode' && m.grandparent_rating_key
    ? m.grandparent_rating_key
    : m.rating_key
}

function showKey(username: string, subject: string): string {
  return `${username.toLowerCase()}:show:${subject}`
}

function seen(key: string, windowMs: number, now: number): boolean {
  const last = recent.get(key)
  return last !== undefined && now - last < windowMs
}

// Prune against the longest window, not the item window — a show stamp is still
// live long after the item stamp that shares the map has expired.
function stamp(now: number, ...keys: string[]): void {
  for (const [k, ts] of recent) {
    if (now - ts >= SHOW_WINDOW_MS) recent.delete(k)
  }
  for (const k of keys) recent.set(k, now)
}
```

The prune comment is the one comment this task adds. Pruning on the item window would silently drop show stamps and reopen the flood.

- [ ] **Step 2: Wire both tiers into `handlePlaybackStart`**

Tier 1 stays where the old check was, before `getMetadata`. Tier 2 goes after the metadata lookup. Both restamp on suppression — tier 1 alone when tier 1 matched, because the show is still unknown at that point.

```ts
  const item = itemKey(input.username, input.rating_key)
  if (seen(item, ITEM_WINDOW_MS, now)) {
    stamp(now, item)
    return { notified: false, reason: 'Already notified for this item recently' }
  }

  let meta: TautulliMetadata
  try {
    meta = await getMetadata(settings.tautulli_url, settings.tautulli_apikey, input.rating_key)
  } catch (e) {
    // unchanged
  }

  const gate = libraryGateReason(settings, meta)
  if (gate) return { notified: false, reason: gate }

  const subject = subjectKey(meta)
  const show = showKey(input.username, subject)
  if (seen(show, SHOW_WINDOW_MS, now)) {
    stamp(now, show, item)
    return { notified: false, reason: `Already notified for ${showOrTitle(meta)} recently` }
  }

  stamp(now, show, item)
```

Nothing is stamped when the library gate rejects — no notification was sent, so nothing should be suppressed later.

- [ ] **Step 3: Make `tag` show-scoped**

```ts
    tag: show,
```

Dedupe decides whether the bridge sends; `tag` decides whether the OS stacks. This is the backstop for what dedupe structurally cannot cover — `recent` is an in-process map, so a restart forgets every suppression it held.

- [ ] **Step 4: Cover both tiers**

Add to `tests/notify.spec.ts`. Fixtures need `grandparent_rating_key` on the episode metadata; add it if the existing fixture lacks it.

```ts
  it('suppresses a repeat of the same episode without asking Tautulli again', async () => {
    const { db, notify } = await load()
    enable(db)

    await notify.handlePlaybackStart(play, { now: 0 })
    getMetadata.mockClear()
    const second = await notify.handlePlaybackStart(play, { now: 60_000 })

    expect(second.notified).toBe(false)
    expect(getMetadata).not.toHaveBeenCalled()
    expect(sendToAll).toHaveBeenCalledTimes(1)
  })

  it('suppresses the next episode of the same show', async () => {
    // episode 2 has its own rating_key but the same grandparent_rating_key
  })

  it('slides the window while a binge continues', async () => {
    // three episodes at 0h, 5h and 10h → exactly one notification
  })

  it('still notifies for a different show inside the window', async () => {
    // different grandparent_rating_key → notified
  })

  it('tags the notification by show so the OS replaces rather than stacks', async () => {
    expect(sendToAll.mock.calls[0]![0].tag).toBe('alice:show:9001')
  })
```

The sliding test is the one that would pass against a naive fixed window, so write it as three calls with explicit `now` values rather than two.

- [ ] **Step 5: Verify and commit**

```bash
npm test && npm run typecheck
git commit -am "fix(notify): dedupe per show, not per episode"
```

---

### Task 3: The `notify_mutes` table

**Files:**
- Modify: `server/utils/db.ts`
- Modify: `shared/types/index.ts`
- Modify: `tests/db.spec.ts`

**Interfaces:**
- Produces: `NotifyMute` on the wire; `listNotifyMutes()`, `isNotifyMuted()`, `addNotifyMute()`, `deleteNotifyMute()` in `db.ts`.

A new **table**, so it goes in the `CREATE TABLE IF NOT EXISTS` block (`db.ts:44-142`). The `PRAGMA table_info` guards at the bottom of the file are for new *columns* on existing tables and are not touched.

- [ ] **Step 1: Add the table**

After `push_subscriptions`, matching the existing column style (`created`, not `created_at`, INTEGER milliseconds from `Date.now()`):

```sql
CREATE TABLE IF NOT EXISTS notify_mutes (
  subject_key TEXT PRIMARY KEY,
  title       TEXT NOT NULL,
  media_type  TEXT NOT NULL,
  created     INTEGER NOT NULL
);
```

`subject_key` is the value `subjectKey()` returns — the show's `rating_key` for an episode, the item's own for anything else. That is the same key space `shared_titles.rating_key` uses, so a mute and a share for the same show agree by construction.

`title` and `media_type` are denormalised so the Settings list renders without a Tautulli round-trip per row, and still renders for a show whose `rating_key` Plex has since dropped.

- [ ] **Step 2: Add the wire type**

`shared/types/index.ts` — no booleans, so no `*ToWire()` conversion is needed and the row shape crosses as-is:

```ts
export interface NotifyMute {
  subject_key: string
  title: string
  media_type: string
  created: number
}
```

- [ ] **Step 3: Add the four query helpers**

`db.ts`, in the chained `useDb().prepare(...)` style the file already uses:

```ts
export function listNotifyMutes(): NotifyMute[] {
  return useDb()
    .prepare(
      `SELECT subject_key, title, media_type, created
         FROM notify_mutes
        ORDER BY title COLLATE NOCASE`,
    )
    .all() as NotifyMute[]
}

export function isNotifyMuted(subjectKey: string): boolean {
  return !!useDb().prepare('SELECT 1 FROM notify_mutes WHERE subject_key = ?').get(subjectKey)
}

export function addNotifyMute(subjectKey: string, title: string, mediaType: string): void {
  useDb()
    .prepare(
      `INSERT INTO notify_mutes (subject_key, title, media_type, created)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(subject_key) DO UPDATE SET title = excluded.title, media_type = excluded.media_type`,
    )
    .run(subjectKey, title, mediaType, Date.now())
}

export function deleteNotifyMute(subjectKey: string): void {
  useDb().prepare('DELETE FROM notify_mutes WHERE subject_key = ?').run(subjectKey)
}
```

The `ON CONFLICT` clause matters: the dialog and the notification button can both mute the same show, and the second one must refresh the stored title rather than throw.

- [ ] **Step 4: Cover the helpers**

`tests/db.spec.ts`: add, list, `isNotifyMuted` true/false, delete, and muting the same subject twice with a changed title (asserting one row and the newer title).

- [ ] **Step 5: Verify and commit**

```bash
npm test && npm run typecheck
git commit -am "feat(db): add notify_mutes"
```

---

### Task 4: The mute gate

**Files:**
- Modify: `server/utils/notify.ts`
- Modify: `tests/notify.spec.ts`

- [ ] **Step 1: Import and gate**

Add `isNotifyMuted` to the existing `./db` import. The gate goes after `getMetadata` — it needs the subject key — and **before** the library gate, because it is an explicit instruction from the operator and its reason is the more informative of the two:

```ts
  const subject = subjectKey(meta)
  if (isNotifyMuted(subject))
    return { notified: false, reason: `Muted: ${showOrTitle(meta)}` }

  const gate = libraryGateReason(settings, meta)
  if (gate) return { notified: false, reason: gate }
```

Hoist the `const subject = subjectKey(meta)` line introduced in Task 2 above this gate and reuse it; do not compute it twice.

A muted show is not stamped. Nothing was suppressed by a *window*, so leaving the map untouched keeps the reason honest if the mute is later removed.

- [ ] **Step 2: Cover the gate**

```ts
  it('skips a muted show and says so', async () => {
    const { db, notify } = await load()
    enable(db)
    db.addNotifyMute('9001', 'Breaking Bad', 'show')

    const result = await notify.handlePlaybackStart(play)

    expect(result.notified).toBe(false)
    expect(result.reason).toBe('Muted: Breaking Bad')
    expect(sendToAll).not.toHaveBeenCalled()
  })

  it('checks the mute before the library gate', async () => {
    // muted show in a deselected library → reason is the mute, not the library
  })
```

Also assert no `events` row is written by either path, matching the existing notify-only guarantee.

- [ ] **Step 3: Verify and commit**

```bash
npm test && npm run typecheck
git commit -am "feat(notify): skip muted shows"
```

---

### Task 5: The mute endpoints

**Files:**
- Create: `server/api/notify/mutes/index.get.ts`, `index.post.ts`, `index.delete.ts`

**Interfaces:**
- Produces: `GET/POST/DELETE /api/notify/mutes`. Task 6 (dialog), Task 8 (service worker) and Task 9 (settings) all consume them.

These are `server/api/*` files, so they use Nitro auto-imports (`defineEventHandler`, `readBody`, `createError`) — the opposite of the `server/utils` rule. DELETE carries its subject in the body, following the `/api/pending` precedent. All three authed; `PUBLIC_API_PATHS` is not touched.

- [ ] **Step 1: `index.get.ts`**

```ts
import { listNotifyMutes } from '../../../utils/db'
import type { NotifyMute } from '../../../../shared/types'

export default defineEventHandler((): NotifyMute[] => listNotifyMutes())
```

- [ ] **Step 2: `index.post.ts`**

```ts
import { addNotifyMute } from '../../../utils/db'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ subject_key?: string; title?: string; media_type?: string }>(event)
  const subjectKey = String(body?.subject_key || '')
  if (!subjectKey) throw createError({ statusCode: 400, statusMessage: 'subject_key is required' })

  addNotifyMute(subjectKey, String(body?.title || subjectKey), String(body?.media_type || 'show'))
  return { ok: true }
})
```

`title` falls back to the key rather than 400-ing: the service worker's payload could be from an older build, and a mute with an ugly label beats a mute that failed.

- [ ] **Step 3: `index.delete.ts`**

Same shape, calling `deleteNotifyMute`, 400 on a missing `subject_key`.

- [ ] **Step 4: Verify and commit**

`npm test && npm run typecheck`, then check the route files appear in the dev server's route list. Commit as `feat(api): mute endpoints`.

---

### Task 6: The mute switch in the Watch-together dialog

**Files:**
- Modify: `app/components/NowPlaying.vue`
- Modify: `app/pages/dashboard.vue`

**Interfaces:**
- Consumes: `GET/POST/DELETE /api/notify/mutes`.
- Produces: a `mutes` prop on `NowPlaying`, and a `mutes` async-data key Task 7's `ready` gate includes.

This is the iOS path — the only one, since Safari drops notification action buttons.

- [ ] **Step 1: Fetch the mutes on the Dashboard**

`dashboard.vue`, alongside the existing calls, and add it to `refreshWatchTogether()`:

```ts
const { data: mutes, refresh: refreshMutes } = useAsyncData<NotifyMute[]>(
  'mutes',
  () => $fetch('/api/notify/mutes'),
  { default: (): NotifyMute[] => [], lazy: true },
)
```

Pass `:mutes="mutes ?? []"` to `<NowPlaying>`.

- [ ] **Step 2: Accept the prop and derive state**

`NowPlaying.vue` — the subject key is what `shareSubject()` already computes, so mute and share cannot disagree about what "this show" means:

```ts
const notifyOn = ref(true)

function mutedFor(s: ActivitySession) {
  return props.mutes.some((m) => m.subject_key === shareSubject(s).rating_key)
}
```

In `openDialog()`: `notifyOn.value = !mutedFor(s)`.

In `dirty`: `if (notifyOn.value === mutedFor(s)) return true` — the switch being *on* while the show *is* muted is a change, and vice versa.

- [ ] **Step 3: Add the section**

After the Plex section (`:322-325`), mirroring its markup:

```vue
          <section>
            <h3 class="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">
              Notifications
            </h3>
            <USwitch
              v-model="notifyOn"
              :label="isEpisode(target) ? 'Notify when this show starts' : 'Notify when this plays'"
            />
            <p v-if="!notifyOn" class="mt-2 text-xs text-dimmed">
              No more notifications for this until you turn it back on here or in Settings.
            </p>
          </section>
```

- [ ] **Step 4: Persist it in `save()`**

Before the toast, so a failure surfaces as an error rather than a false success:

```ts
    if (notifyOn.value === mutedFor(s)) {
      const subject = shareSubject(s)
      await (notifyOn.value
        ? $fetch('/api/notify/mutes', {
            method: 'DELETE',
            body: { subject_key: subject.rating_key },
          })
        : $fetch('/api/notify/mutes', {
            method: 'POST',
            body: {
              subject_key: subject.rating_key,
              title: subject.title || s.title,
              media_type: subject.media_type,
            },
          }))
    }
```

`subject.title || s.title` guards the episode whose `show_title` Tautulli left blank.

- [ ] **Step 5: Verify and commit**

`npm test && npm run typecheck`. Then in the dev server: open the dialog for a playing item, flip the switch, Update, reopen and confirm the switch reflects the stored state. Commit as `feat(ui): mute a show from the Watch-together dialog`.

---

### Task 7: The deep-link race

**Files:**
- Create: `app/utils/focus-target.ts`
- Create: `tests/focus-target.spec.ts`
- Modify: `app/components/NowPlaying.vue`, `app/pages/dashboard.vue`

**The bug:** `openDialog()` snapshots `picked` and `plexSync` from `props.shares`/`props.pending` at open time. The focus watch fires as soon as `sessions` arrives, but `dashboard.vue` starts every request in parallel with `lazy: true` and each defaults to `[]` — and `/api/shared` can be several Tautulli round-trips because of `backfillLibraries`, while activity is one. `emit('focused')` then clears `?watch=`, so the dialog is never re-seeded.

**Why it is worse than empty checkboxes:** once `shares` resolves, `countedIds()` returns the real members while `picked` is still `[]`, so `dirty` flips true, Update lights up, and saving takes the `!picked.length` branch — stripping every profile from a title that was already shared. Only the notification path can reach this; on the Dashboard the button is clicked seconds after load.

- [ ] **Step 1: Extract the predicate**

`app/utils/focus-target.ts`. A pure function, following the `event-group.ts` precedent — the only `app/` code this repo tests, and for the same reason:

```ts
import type { ActivitySession } from '../../shared/types'

export interface FocusRequest {
  rating_key: string
  username: string
}

export function focusTarget(
  focus: FocusRequest | null | undefined,
  sessions: ActivitySession[],
  ready: boolean,
  open: boolean,
): ActivitySession | null {
  if (!focus || !ready || open) return null
  return (
    sessions.find(
      (s) =>
        s.rating_key === focus.rating_key &&
        s.username.toLowerCase() === focus.username.toLowerCase(),
    ) ?? null
  )
}
```

- [ ] **Step 2: Gate the watch on it**

`NowPlaying.vue` — add `ready?: boolean` to the props and `() => props.ready` to the watch sources:

```ts
watch(
  [() => props.focus, () => props.sessions, () => props.ready],
  () => {
    const match = focusTarget(props.focus, props.sessions, props.ready ?? false, open.value)
    if (!match) return
    openDialog(match)
    emit('focused')
  },
  { immediate: true },
)
```

Gate the open rather than re-seed a dialog already on screen — re-seeding would overwrite selections the operator had started making.

- [ ] **Step 3: Compute `ready` on the Dashboard**

Capture `status` from the `shares`, `pending`, `mappings` and `mutes` calls, then:

```ts
// An errored request must not wedge the dialog shut — resolved, not successful,
// is the bar. A failed /api/shared already renders as an empty share elsewhere.
const ready = computed(() =>
  [sharesStatus, pendingStatus, mappingsStatus, mutesStatus].every(
    (s) => s.value === 'success' || s.value === 'error',
  ),
)
```

Pass `:ready="ready"`.

- [ ] **Step 4: Cover the predicate**

`tests/focus-target.spec.ts`: no focus; focus but `ready: false`; ready with no matching session; ready with a match (returns it); already open; and a username differing only in case.

- [ ] **Step 5: Verify by hand — the wiring cannot be unit-tested**

With a title already shared and nothing playing yet, start playback, tap the notification on a **cold page load**, and confirm the profiles are ticked and the Plex switch reflects the share. The predicate spec cannot catch a mis-passed prop.

- [ ] **Step 6: Commit**

```bash
git commit -am "fix(ui): don't open the watch dialog before its data lands"
```

---

### Task 8: The notification action button

**Files:**
- Modify: `server/utils/push.ts`, `server/utils/notify.ts`, `public/sw.js`
- Modify: `tests/notify.spec.ts`

**Platform reality:** iOS reports `maxActions: 0` and drops `actions` silently — `docs/superpowers/specs/2026-07-29-pwa-mobile-design.md:196-198` records this. The button renders on Android Chrome and desktop Chrome/Edge only, and nothing breaks where it doesn't. It is worth adding because an unsupported option costs nothing.

- [ ] **Step 1: Extend the payload type**

`push.ts`:

```ts
export interface PushPayload {
  title: string
  body: string
  url: string
  tag: string
  mute?: { subject_key: string; title: string; media_type: string }
}
```

- [ ] **Step 2: Populate it**

`notify.ts`, in the `sendToAll` call. `media_type` maps `episode` → `show` so it matches what the dialog sends for the same subject:

```ts
    mute: {
      subject_key: subject,
      title: showOrTitle(meta),
      media_type: meta.media_type === 'episode' ? 'show' : meta.media_type,
    },
```

- [ ] **Step 3: Offer the action**

`public/sw.js`, in the `push` handler:

```js
      data: { url: p.url || '/dashboard', mute: p.mute || null },
      actions: p.mute ? [{ action: 'mute', title: 'Mute this show' }] : [],
```

- [ ] **Step 4: Handle it**

In `notificationclick`, before the existing focus-or-open logic:

```js
  const data = event.notification.data || {}
  if (event.action === 'mute' && data.mute) {
    event.waitUntil(mute(data.mute))
    return
  }
```

And the handler itself. A service worker `fetch` carries the same-origin session cookie, so the endpoint stays authed — but an expired session returns 401, and that must be visible:

```js
async function mute(subject) {
  try {
    const res = await fetch('/api/notify/mutes', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(subject),
    })
    if (!res.ok) throw new Error(String(res.status))
  } catch {
    await self.registration.showNotification('Could not mute that show', {
      body: 'Open Seenr Bridge and mute it from the Watch together dialog.',
      icon: '/icon-192.png',
      badge: '/badge-96.png',
      tag: 'seenr-bridge-mute-failed',
      data: { url: '/settings' },
    })
  }
}
```

- [ ] **Step 5: Cover the payload**

The service worker is not under test, but the payload it depends on is:

```ts
  it('carries what the mute action needs', async () => {
    const payload = sendToAll.mock.calls[0]![0]
    expect(payload.mute).toEqual({
      subject_key: '9001',
      title: 'Breaking Bad',
      media_type: 'show',
    })
  })
```

- [ ] **Step 6: Verify and commit**

`npm test && npm run typecheck`. State plainly in the commit body that the button is unverified on iOS by design. Commit as `feat(push): offer a mute action where the platform supports it`.

---

### Task 9: The muted list in Settings

**Files:**
- Modify: `app/pages/settings.vue`

Without this, a mute set from a notification cannot be found or reversed. It is not optional.

- [ ] **Step 1: Fetch and unmute**

In the script block, near the other notify state:

```ts
const { data: notifyMutes, refresh: refreshNotifyMutes } = useAsyncData<NotifyMute[]>(
  'notify-mutes',
  () => $fetch('/api/notify/mutes'),
  { default: (): NotifyMute[] => [], lazy: true },
)

async function unmute(m: NotifyMute) {
  notifyBusy.value = true
  try {
    await $fetch('/api/notify/mutes', { method: 'DELETE', body: { subject_key: m.subject_key } })
    await refreshNotifyMutes()
    toast.add({ title: `Notifications for ${m.title} are back on.`, color: 'success' })
  } catch (e) {
    toast.add({ title: apiErrorMessage(e, 'Could not unmute that.'), color: 'error' })
  } finally {
    notifyBusy.value = false
  }
}
```

- [ ] **Step 2: Render it**

Inside the existing `Notifications` `DisclosureCard`, after the "Send notifications" switch and a `USeparator`. Absent rather than empty when there is nothing muted, matching how the Dashboard treats an idle Now-playing card:

```vue
      <template v-if="notifyMutes?.length">
        <USeparator />
        <div class="space-y-1">
          <p class="text-sm font-medium text-highlighted">Muted</p>
          <p class="text-xs text-dimmed">These never notify, whoever plays them.</p>
        </div>
        <div class="space-y-2">
          <div
            v-for="m in notifyMutes"
            :key="m.subject_key"
            class="flex items-center justify-between gap-3"
          >
            <p class="min-w-0 truncate text-sm text-default">{{ m.title }}</p>
            <UButton
              color="neutral"
              variant="subtle"
              size="sm"
              icon="i-lucide-bell"
              :disabled="notifyBusy"
              label="Unmute"
              class="shrink-0"
              @click="unmute(m)"
            />
          </div>
        </div>
      </template>
```

- [ ] **Step 3: Check the summary line**

`notifySummary` describes the panel when collapsed. If a muted count fits its existing phrasing, add it; if not, leave it — do not restructure the summary for this.

- [ ] **Step 4: Verify and commit**

`npm test && npm run typecheck`, then confirm in the browser that muting from the dialog makes a row appear here and unmuting removes it. Commit as `feat(ui): list and undo muted shows in Settings`.

---

### Task 10: Release

- [ ] **Step 1: Bump the version**

`shared/version.ts` → `2.6.2`.

- [ ] **Step 2: Add the changelog section**

A `## 2.6.2` section in `CHANGELOG.md`, matching the file's existing voice. Cover: the new copy, one notification per show instead of per episode, muting a show from the dialog / the notification / Settings, and the dialog no longer opening empty from a notification.

- [ ] **Step 3: Confirm the PR gate's two conditions agree**

The check fails unless the version bump and a matching heading both exist:

```bash
grep VERSION shared/version.ts && grep -n '^## 2.6.2' CHANGELOG.md
```

- [ ] **Step 4: Full check**

```bash
npm test && npm run typecheck
```

Both must pass. No production build is needed — no page was added, so `nitro.prerender.routes` is untouched.

- [ ] **Step 5: Push and open the PR**

```bash
git push -u origin feat/notification-mute
GH_CONFIG_DIR="$HOME/.config/gh-isntw" gh pr create --base main --title "feat(notify): show-scoped notifications, muting, and the deep-link fix" --body "$(cat <<'BODY'
...
BODY
)"
```

The `GH_CONFIG_DIR` is required — a non-interactive shell does not source `.zshrc`, so the `gh()` identity wrapper is absent and `gh pr create` fails with "must be a collaborator".

---

## Deliberately not included

- **Poster art in the notification.** Safari ignores `icon` and never implemented `image`, so it renders nothing on the iOS platform floor. Settle it with a throwaway poster URL on `/api/push/test` before building the signed poster endpoint that `/api/image`'s session gate would otherwise require.
- **Swipe-to-dismiss as a mute signal.** `notificationclose` is unreliable on iOS, and an accidental swipe silently muting a show is undiscoverable.
- **Per-user mutes** and **self-expiring mutes.** Both considered and rejected in the spec.
- **A configurable dedupe window.** Two constants in `notify.ts`, not settings.

## Verification

- `npm test` and `npm run typecheck` pass after every task, not just at the end
- Both dedupe tiers covered, including the sliding-window case that a fixed window would pass
- The mute gate covered, including its ordering against the library gate
- No notify path writes an `events` row

**Cannot be proven by the suite — verify by hand and say so plainly:**

- **The deep-link fix.** The predicate is unit-tested; the prop wiring is not. Cold-load a notification tap for an already-shared title and confirm the profiles are ticked.
- **The mute action button.** Not verifiable on iOS at all, where it does not render by design. Needs an Android or desktop Chrome subscription to exercise.
- **The 6-hour window.** No test can prove the number is *right* for how this household watches television, only that the mechanism slides. Revisit if a show ever notifies twice in an evening.

Spec: `docs/superpowers/specs/2026-07-31-notification-mute-design.md`
