# Now playing on the Dashboard, and counting a watch for extra profiles

**Date:** 2026-07-28
**Status:** design agreed, awaiting review — not yet implemented
**Target version:** 2.5.0 (new capability, compatible base)

## Problem

Two things are invisible or impossible today.

**Nothing on the Dashboard says what is playing right now.** The page lists watches that
have already been recorded, so the interesting moment — somebody is on the sofa watching
something *at this second* — is exactly the moment the bridge has nothing to show.

**A watch cannot be counted for someone who is in the room but not in the share.** Shares
are set up in advance, per title, on the Shared page. If two people sit down together
unplanned, the only ways to make the watch count for the second person are to create a
share before the watch completes (four clicks on another page, and only if you remember
the title's exact name) or to run the retroactive backfill afterwards, which walks the
whole show's history rather than the one episode.

Goal: a **Now playing** card on the Dashboard showing live sessions, with two actions per
session — count *this* watch for extra profiles, or share the title from now on.

## Investigation

### Tautulli can do this, by polling `get_activity`

Verified live against the operator's instance on 2026-07-28. `GET /api/v2?cmd=get_activity`
returns the standard envelope, with `data` carrying:

```
stream_count, sessions, stream_count_direct_play, stream_count_direct_stream,
stream_count_transcode, total_bandwidth, lan_bandwidth, wan_bandwidth
```

`sessions` is the array we want. `stream_count: 0` and an empty `sessions` array is the
idle response — the call does not fail when nothing is playing, so there is no error path
to distinguish "idle" from "broken".

### Push was considered and rejected

Tautulli *can* push playback events, and the bridge already owns a notifier it fully
controls (`syncSeenrWebhook` in `server/utils/tautulli.ts`) whose trigger set it rewrites
on every sync. Enabling `on_play` / `on_stop` there would deliver session starts and stops
to `/api/webhook/tautulli` with no polling at all.

It must not be done. `mapEvent` (`server/utils/scrobble.ts:4-15`) already maps `play` →
`media.play`, `pause` → `media.pause`, `stop` → `media.stop`, and `processEvent` forwards
whatever action arrives to every recipient's seenr token. Turning those triggers on would
therefore start **posting plays, pauses and stops to seenr** as a side effect of wanting a
banner. Making push safe means teaching the pipeline a class of state-only events that are
recorded but never forwarded — a much larger change, and one that puts the forwarding path
at risk for a read-only feature.

Polling also wins on merit: `get_activity` reports live progress, which a play/stop event
stream cannot keep current.

### The cost is view-time, not a background service

The Dashboard already polls every 5s (`Live — refreshes every 5s`). Activity is one more
LAN-local Tautulli call on that same interval, and **zero when nobody has the page open** —
there is no timer in the server, no state to keep warm, and nothing to reconcile after a
restart. This is deliberately a view, not a subsystem.

### The one-off already has a home in the pipeline

`processEvent` resolves recipients at *scrobble* time — `getSharedRecipients(key, guid)`
is read when Tautulli fires `watched`, at roughly 90% progress, not when playback starts.
So profiles added **while the episode is still playing** are picked up by the existing
fan-out with no change to the delivery path at all. The one-off only needs somewhere to
record the intent and a lookup next to the existing share lookup.

## Design

### Now playing card

A card above `Recent scrobbles`, rendered only while `stream_count > 0`, one row per
session shaped like an event row so the page reads consistently:

```
┌─ Now playing ● ────────────────────────────────────────────────┐
│ [img]  Breaking Bad   S5·E14 · Ozymandias                      │
│        isntw · ▸ playing · 62%                                 │
│        ▓▓▓▓▓▓▓▓▓▓▓▓░░░░░░░░                                    │
│        shared with [anamariaelisa]                             │
│        [+ Count this episode]  [+ Share this show]             │
└────────────────────────────────────────────────────────────────┘
```

The card is absent, not empty, when nothing plays: an idle card saying "nothing is
playing" would occupy the top of the page permanently to report a non-event.

**The live signal is a pulsing green dot** beside the card heading, plus a per-row state
dot. It is the one piece of the page that is genuinely live rather than merely refreshed,
and a static badge cannot say that. Specifics:

- Green and pulsing while `state === 'playing'`.
- **Amber and static when `state === 'paused'`** — a pulse on a paused stream is a lie,
  and paused-vs-playing is exactly what the operator wants to know at a glance.
- Blue-ish and pulsing for `state === 'buffering'`.
- The pulse is a CSS `animation` on an absolutely-positioned ring behind the dot (a
  scale + fade keyframe), not an opacity blink on the dot itself, so the dot's own colour
  stays readable throughout.
- **`@media (prefers-reduced-motion: reduce)` disables the animation** and leaves the
  solid dot. The state is still carried by colour and by the word next to it, so nothing
  is lost when the animation is suppressed.

Nuxt UI's `UChip` is used for the dot itself (`standalone inset`), as everywhere else in
this codebase, with the pulse ring added as a sibling span rather than by overriding the
chip's theme.

### Two actions, two meanings

**`+ Share this show`** — a shortcut into the existing shared-titles flow, prefilled with
the playing item. Creates or extends the share for the *title* (the show, for an episode),
so the in-flight watch counts for the added profiles when it completes and every future
episode does too. Reuses `setSharedTitle` and needs no new domain logic. The result appears
on the Shared page like any other share.

**`+ Count this episode`** — a one-off. Records the intent against the *item* actually
playing (this episode, or this film), consumed when its `watched` event arrives, then
deleted. Nothing persists and the Shared page is untouched.

### Why the one-off fires on completion, not on click

Clicking stores a pending row; the pipeline consumes it at `watched`. The co-watchers are
therefore counted at the same instant the watcher is, which is what every other path in
this bridge means by a watch. Firing immediately would mark a title watched for people
while it is still playing, and if the watcher abandons it at 70% the co-watchers end up
watched while the person who actually pressed play does not.

The cost of waiting is that an abandoned session leaves a pending row behind, which is
what expiry is for.

### A one-off must work when the player is unmapped

`processEvent` returns silently today when the username has no mapping
(`server/utils/pipeline.ts:149`), before any share lookup. But "a guest account is playing
something, count it for me" is a primary use of this feature, so the pending lookup has to
happen **before** that early return.

It stays cheap: the lookup is one indexed `SELECT` on `rating_key`, and the expensive part
(`get_metadata`, payload building) only runs when a pending row actually exists. The
common case — an unmapped user playing something nobody asked about — costs one indexed
query more than today.

With no trigger user there is nobody to exclude from the Plex write, so every one-off
recipient is eligible for it, subject to the inheritance rule below.

### Plex marking is inherited, never invented

A one-off marks Plex only if the title already has a share with `plex_sync` on. Otherwise
it is a seenr check-in and nothing else. This follows the rule `shared_titles.plex_sync`
already sets: the bridge does not start writing into other people's Plex libraries without
being asked, and a quick action is not asking.

## Data model

One new table. One row per (item, profile) pair, so adding the same profile twice is a
no-op rather than a duplicate delivery.

```sql
CREATE TABLE IF NOT EXISTS pending_watches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rating_key TEXT NOT NULL,     -- the ITEM playing: this episode, or this film
  guid TEXT,                    -- the item's own Plex guid, for the library-copy case
  mapping_id INTEGER NOT NULL,
  created INTEGER NOT NULL,
  UNIQUE (rating_key, mapping_id),
  FOREIGN KEY (mapping_id) REFERENCES mappings (id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_pending_rating_key ON pending_watches (rating_key);
```

- **Keyed on the item, not the title.** "Count this episode" means this episode. The
  `watched` event carries the episode's own `rating_key`, so an exact match is the normal
  path; `guid` is stored as well and matched as a fallback, for the same reason shares do
  it — two libraries can hold the same title under different keys (see `CLAUDE.md`).
- **`ON DELETE CASCADE`** — deleting a mapping must not leave a pending row pointing at a
  profile that no longer exists.
- **Expiry is a TTL swept on insert**, the pattern `insertEvent` already uses for the
  1000-row events cap: rows older than 24h are deleted whenever a new one is written. A
  session that never completes therefore cannot accumulate. Tying expiry to the session
  disappearing from `get_activity` was rejected: it would make correctness depend on
  somebody having the Dashboard open.

## Files

| File | Change |
| --- | --- |
| `server/utils/tautulli.ts` | `getActivity()` — `get_activity`, parse `sessions` into a typed shape, tolerate the idle response |
| `server/utils/db.ts` | `pending_watches` table + migration guard; `addPendingWatches`, `getPendingWatches`, `consumePendingWatches`, TTL sweep |
| `server/utils/pipeline.ts` | consult pending rows before the unmapped-user return; union with share recipients; delete on consume; inherit `plex_sync` |
| `server/api/tautulli/activity.get.ts` | new — serves the session list to the Dashboard |
| `server/api/pending/index.post.ts` | new — records a one-off for an item + profiles |
| `shared/types/index.ts` | `ActivitySession`, `PendingWatch` wire shapes |
| `app/components/NowPlaying.vue` | new — the card, the pulsing dot, the two actions |
| `app/components/LiveDot.vue` | new — the dot + pulse + reduced-motion handling, reused per row |
| `app/pages/dashboard.vue` | poll activity alongside the existing 5s refresh; render the card above Recent scrobbles |
| `app/stores/status.ts` | possibly the activity poll, if it belongs with the other polled state |

## Testing

Vitest, following the existing split (`server/utils` imported directly, `global.fetch`
stubbed only in `tautulli.spec.ts`).

- **`tautulli.spec.ts`** — `getActivity` parses a two-session envelope; the idle response
  (`stream_count: 0`, `sessions: []`) yields `[]` rather than throwing; a malformed
  envelope degrades to `[]`.
- **`db.spec.ts`** — insert is idempotent per (item, profile); the TTL sweep drops rows
  older than 24h and keeps newer ones; deleting a mapping cascades; the migration guard
  adds the table to an existing file.
- **`pipeline.spec.ts`** — a pending row is consumed at `watched` and the profile receives
  the forward; the row is **deleted** afterwards, so a rewatch does not silently re-fire;
  it works when the player has no mapping; recipients are the union with an existing
  share, deduped; Plex is marked only when the title's share has `plex_sync`; an expired
  row is not consumed; `dryRun` consumes nothing.
- **`event-group.spec.ts`** — unchanged, but the fixture gains nothing: sessions are not
  events and never enter the grouping.

## Open question — one live check needed

**Do `get_activity` sessions carry `guid` / `grandparent_guid`?** Could not be confirmed:
nothing was playing at design time (`stream_count: 0`). It matters because the pending row
stores the item guid, and the "Share this show" action needs the *show's* guid to create a
share that matches across library copies.

- If yes, the card and both actions work from the session payload alone.
- If no, each action calls `get_metadata(rating_key)` once on click — already implemented,
  cheap, and only on click rather than per poll.

Either way the design holds; this only decides whether one extra call is needed. **Resolve
by pressing play and re-running the `get_activity` probe.**
