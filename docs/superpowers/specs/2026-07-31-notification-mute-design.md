# Notification copy, per-show muting, and the deep-link race

Date: 2026-07-31
Status: awaiting approval

Follow-up to `2026-07-29-push-notifications-design.md`, shipped in `2.6.0`/`2.6.1`.
Three changes to what the notification says, how often it says it, and what the
dialog it opens looks like when it gets there. One `2.6.2` bump covers all three.

## Goal

1. Rewrite the notification copy so the title carries what is playing and the body
   carries who started it plus the action.
2. Stop a long-running show from producing one notification per episode, and give
   the operator a deliberate way to silence a show for good.
3. Fix the Watch-together dialog opening with an empty selection when it is reached
   from a notification — which today can silently strip an existing share.

## Copy

Title is the subject plus its detail; body is the actor plus the call to action.

```
Severance — S2·E4 · Woe's Hollow
Started by alice · Watch together →
```

```
Dune — 2021
Started by bob · Watch together →
```

`detail()` already emits `S5·E14 · Ozymandias` for episodes and the year for
movies, so this is a two-line change at `notify.ts:94-99`:

```ts
title: [showOrTitle(meta), detail(meta)].filter(Boolean).join(' — '),
body: `Started by ${input.username} · Watch together →`,
```

The `.filter(Boolean)` is load-bearing on both: a movie with no year must not
render a trailing em dash, and an episode with no title already falls back to
`S?·E?` inside `detail()`.

"Watch together" is the name of the button in `NowPlaying.vue:260` and the title of
the dialog the notification opens. The old body said "Tap to count it for someone",
which named the same feature a third way.

## Flood control

### Why a binge produces one notification per episode

`dedupeKey()` is `username:rating_key`, and `rating_key` identifies the episode, not
the show. Every episode is therefore a key the map has never seen, and the
30-minute window never gets a chance to apply. What that window actually catches
today is a repeat of *the same* episode — Tautulli re-sending `play` after a
pause/resume, or a restart.

### Two tiers

**Tier 1 — exact, unchanged.** `username:rating_key`, 30 minutes, checked before
`getMetadata`. Keeps catching re-fires without spending a Tautulli round-trip.

**Tier 2 — per show, new.** `username:show:<subject key>`, 6 hours, checked after
`getMetadata`. `subjectKey(meta)` lives in `notify.ts` beside `showOrTitle()` and is
exported so the specs and the mute gate share one definition: it returns
`grandparent_rating_key` for an episode and `rating_key` for anything else, so a
movie keeps deduping against itself.

The tier-2 stamp is refreshed on every play of that show, so the window slides:
while episodes keep starting, the show stays silent. A fixed window measured from
the first notification would lapse mid-binge and buzz again.

A suppressed event refreshes the stamp of every key it was able to compute — tier 1
only when tier 1 matched (the show is still unknown at that point), both when
tier 2 matched.

**Why 6 hours.** The window has to exceed the gap between consecutive episode
starts, and that gap is one episode long. A 45-minute drama beats a 30-minute
window on every single episode — not every other one. 6 hours clears any episode
length; the practical effect is one notification per show per evening.

**Why tier 2 cannot be merged into tier 1.** The webhook carries the episode's
`rating_key` and nothing else. Which show it belongs to is only known once
`get_metadata` returns, so a single pre-metadata check cannot be show-scoped, and a
single post-metadata check would spend a Tautulli round-trip on every re-fire.

### `tag` becomes show-scoped

Dedupe decides whether the bridge sends; `tag` decides whether the OS stacks. It is
episode-scoped today (`notify.ts:98`), so twelve episodes leave twelve lock-screen
rows. Keying it on the subject makes each notification replace the last one for that
show.

This is the backstop for what dedupe structurally cannot cover: `recent`
(`notify.ts:9`) is an in-process map, so a bridge restart forgets every suppression
it was holding. The mute table below is SQLite and does not.

## Muting a show

Scope is **the show, whoever plays it** — muting *The Big Bang Theory* silences it
for alice and bob alike. Duration is **until explicitly unmuted**. Both were chosen
over the alternatives (per-user pairs, a self-expiring 24-hour mute) because the
intent being expressed is "I do not watch this show", which is neither
user-specific nor temporary.

### Storage

A new table, not a migration — new tables go in the `CREATE TABLE IF NOT EXISTS`
block at `db.ts:44-142`; the `PRAGMA table_info` guards at the bottom of the file
are only for new columns on existing tables.

```sql
CREATE TABLE IF NOT EXISTS notify_mutes (
  subject_key TEXT PRIMARY KEY,
  title       TEXT NOT NULL,
  media_type  TEXT NOT NULL,
  created     INTEGER NOT NULL
)
```

`subject_key` is the same value tier-2 dedupe uses, so the two agree by
construction. `title` and `media_type` are denormalised copies so the Settings list
can render without a Tautulli round-trip per row — and still renders for a title
whose `rating_key` Plex no longer resolves.

`db.ts` gains `listNotifyMutes()`, `isNotifyMuted(subjectKey)`,
`addNotifyMute(subjectKey, title, mediaType)` and `deleteNotifyMute(subjectKey)`,
all explicit-relative-import style per the `server/utils` rule. The row has no
booleans, so no `*ToWire()` conversion is needed; `NotifyMute` in
`shared/types/index.ts` matches the row shape.

Check the new export names against h3's auto-imports before committing —
`npm run typecheck` reports collisions as `WARN Duplicated imports`.

### The gate

In `notify.ts`, after `getMetadata` and before the library gate:

```ts
if (isNotifyMuted(subjectKey(meta)))
  return { notified: false, reason: `Muted: ${showOrTitle(meta)}` }
```

Ahead of the library gate because it is an explicit instruction from the operator
and its reason is the more informative of the two. It must sit after
`getMetadata` for the same reason tier-2 dedupe does. Like every other notify path,
it writes no `events` row.

### Three ways to set it

**In the dialog — the iOS path.** A "Notifications" section in the Watch-together
modal, mirroring the existing "Plex" section at `NowPlaying.vue:322-325`:

```
Notifications
[✓] Notify when this show starts
```

`USwitch`, on by default, off means muted. It reflects stored state, so it unmutes
too. It participates in `dirty` (`NowPlaying.vue:128-138`) — add
`if (muted.value !== mutedFor(s)) return true` — so a single Update applies it
alongside profile and Plex changes. Label reads "Notify when this plays" for a
movie.

`NowPlaying` gains a `mutes` prop, fed by a new `useAsyncData('mutes')` in
`dashboard.vue` and refreshed by `refreshWatchTogether()`.

**From the notification — Android and desktop only.**

```ts
actions: [{ action: 'mute', title: 'Mute this show' }]
```

iOS reports `maxActions: 0` and drops `actions` silently, which is why
`2026-07-29-pwa-mobile-design.md:196-198` made tapping deep-link instead. Nothing
breaks there; the button simply does not render, and the in-dialog switch remains
the only iOS route. Added because an unsupported option costs nothing.

The payload carries the subject key and display title in `data`, well inside the
~4KB encrypted-payload budget. `sw.js:23` branches on `event.action === 'mute'` and
POSTs `/api/notify/mutes` instead of opening a window.

A service worker `fetch` does carry the same-origin `sb_session` cookie, so the
endpoint stays authed — unlike a notification *image* fetch, which happens outside
any page. If the session has expired the POST returns 401, and the handler must
`showNotification` a one-line "Couldn't mute — open Seenr Bridge" rather than
failing silently.

**In Settings → Notifications** (`settings.vue:1042`) — the muted list, each row
with an unmute control. This is the only place a mute set from a notification can be
found and reversed, so it is not optional.

### Endpoints

- `GET /api/notify/mutes` — list
- `POST /api/notify/mutes` — `{ subject_key, title, media_type }`
- `DELETE /api/notify/mutes` — `{ subject_key }`, body-carried per the `/api/pending`
  precedent

All three authed; nothing is added to `PUBLIC_API_PATHS`.

## The deep-link race

### What happens

`openDialog()` (`NowPlaying.vue:83-89`) snapshots its state at open time:

```ts
picked.value = countedIds(s)   // reads props.shares + props.pending
plexSync.value = plexBound(s)  // same
```

The focus watch (`NowPlaying.vue:95-109`) fires as soon as `sessions` receives a
payload. But `dashboard.vue:24-58` starts six `useAsyncData` calls in parallel, each
`lazy: true` and each defaulting to `[]`, and the watch never checks whether
`shares` and `pending` have landed. `/api/tautulli/activity` is one Tautulli
round-trip; `/api/shared` can be several, because of the `backfillLibraries` loop at
`server/api/shared/index.get.ts:14-49`. Activity winning is the ordinary case.

`emit('focused')` then clears `?watch=`, `props.focus` goes null, and the dialog is
never re-seeded.

### Why it is worse than empty checkboxes

Once `shares` resolves, `countedIds()` returns the real members while `picked` is
still `[]`. `dirty` (`:128-138`) flips true, Update lights up, and pressing it takes the
`!picked.length` branch — **removing every profile from a title that was already
shared**. The warning at `NowPlaying.vue:317` does say "saving now clears this
title", but it reads as noise to someone who never unticked anything.

Only the notification path can reach this. On the Dashboard the button is clicked
seconds after load, by which time every request has resolved.

### Fix

`dashboard.vue` computes `ready` from the `shares`/`pending`/`mappings`/`mutes`
statuses and passes it down; the focus watch refuses to open until it is true, and
adds `() => props.ready` to its sources so it re-evaluates when it flips.

Gate the open rather than re-seed a dialog already on screen — re-seeding would
overwrite clicks the operator had started making.

The predicate moves to `app/utils/` as a pure function so it can be unit-tested.
`app/utils/event-group.ts` is the sole precedent for testing `app/` code and exists
for the same reason: the logic is easy to get subtly wrong and impossible to cover
from the server specs.

## Testing

`tests/notify.spec.ts`:

- the new title and body for an episode and for a movie (replacing the assertions at
  `:288-320`)
- tier 1 still suppresses a repeat of the same episode, **without** calling
  `getMetadata`
- tier 2 suppresses episode 2 of the same show
- tier 2 restamps: episodes at 0h, 5h and 10h produce one notification, not two
- a different show still notifies inside the window
- a muted show is skipped, with `Muted: <title>` as the reason
- the mute gate fires before the library gate
- no notify path writes an `events` row

`tests/db.spec.ts`: mute add / list / is-muted / delete, and that adding the same
subject twice does not throw.

New spec for the open predicate: no focus, focus but not ready, ready but no
matching session, ready with a match, and already open.

## Verification and its limits

The dialog fix cannot be proven by the suite — the predicate can, the wiring cannot.
Verify by hand: with a title already shared, tap a notification on a cold page load
and confirm the profiles are ticked and the Plex switch reflects the share.

`npm run typecheck` covers `app/` + `server/` + `shared/` and the test tsconfig.
A misspelled Nuxt UI component passes both typecheck and build and then renders
nothing, so check `USwitch` against `.nuxt/components.d.ts` if it is not already
used in this file — it is, at `:324`.

## Non-goals

- **Poster art in the notification.** Safari ignores `icon` and has never
  implemented `image`, so on the iOS platform floor it renders nothing. Settle it
  with a throwaway poster URL on `/api/push/test` before building the signed
  poster endpoint that `/api/image`'s session gate would otherwise require.
- **Swipe-to-dismiss as a mute signal.** `notificationclose` is unreliable on iOS,
  and an accidental swipe silently muting a show is undiscoverable.
- **Per-user mutes**, and **self-expiring mutes**. Both were considered and rejected
  above; recorded so they are not re-litigated.
- **A configurable dedupe window.** Two constants in `notify.ts`, not settings.

## Migration checklist

- `shared/version.ts` → `2.6.2`, with a matching `## 2.6.2` section in
  `CHANGELOG.md`. CI fails the PR without both.
- No `ALTER TABLE`; `notify_mutes` is created on first boot.
- No new public paths, no new dependencies, no new prerendered routes.
