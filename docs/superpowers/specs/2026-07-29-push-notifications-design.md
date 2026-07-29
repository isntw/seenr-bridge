# Push notifications on stream start

Date: 2026-07-29
Status: awaiting approval

Second of the two mobile pieces. The first (PWA shell, manifest, icons, safe-area
insets, a no-caching service worker) is committed on `feat/pwa-mobile`. This piece
continues on **the same branch, under the same `2.6.0` bump** — its changelog
entries fold into the existing `## 2.6.0` section rather than adding a second one.

## Goal

When someone starts a stream, the operator's phone gets a notification. Tapping it
opens the Dashboard with that session's Watch-together dialog ready, so the watch
can be counted for a co-watcher while it is still playing.

## Why this shape

Three findings from the first piece's investigation drive the whole design.

**The `watched` webhook fires too late.** `syncSeenrWebhook` defaults to
`['watched']`, so Tautulli calls the bridge only once Plex's watched threshold is
passed — and `processEvent()` consumes and `deletePendingWatchesByIds()` at that
moment. A notification from there arrives after the window it exists to open has
already shut.

**Enabling `play` is currently unsafe.** `processEvent()` does not branch on action.
With `play` enabled it forwards `media.play` to seenr, deletes the `pending_watches`
rows at play time, and calls `markWatched()` on co-watchers' Plex copies at 0%
progress — marking someone's copy watched the instant another person presses play.
Fixing that is a prerequisite, not a side quest.

**Once `play` is safe, no poller is needed.** The webhook itself is the
stream-started signal, so there is no background Tautulli activity poller.

## Architecture

### Trigger: branch in the webhook route, not inside `processEvent()`

```
server/api/webhook/tautulli.post.ts
  action ∈ {watched, scrobble}       → processEvent()          unchanged
  action == play                     → handlePlaybackStart()   new
  action ∈ {stop, pause, resume}     → processEvent()          unchanged
```

`processEvent()` is a ~200-line function with six early returns and is the one path
that must not break. A separate `server/utils/notify.ts` is independently testable
and leaves the scrobble path byte-identical.

Critically, notification logic **cannot** live behind `processEvent()`'s gates: it
returns before the metadata lookup for an unmapped user —

```
if (!triggerUsable && !pendingByKey.length)
  return { ok: false, skipped: true, reason: `No seenr mapping for user "..."` }
```

— and a housemate with no seenr mapping is exactly who this feature is for.
`processEvent()` already delivers for them when `pending` is non-empty, so
"Alice is watching, count it for Bob" works without Alice having an account.

**Only `play` changes behaviour.** `stop`/`pause`/`resume` keep routing to
`processEvent()` so no existing install's configuration changes meaning. `play`
stops scrobbling and starts notifying — a behaviour change, but from broken to
correct, and it goes in the changelog as such.

`handlePlaybackStart()` does: master toggle → username in `notify_users` → dedupe →
`getMetadata()` → library gate → build → send.

**Notify-only actions write no `events` rows.** That table is capped at 1000 and
trimmed on every insert, so a row per play would flush real scrobbles out roughly
twice as fast and fill the Dashboard with non-scrobbles.

**Dedupe is in-memory**, keyed `(username, rating_key)` with a 30-minute window.
Tautulli fires `play` on every play and some clients fire it more than once. A
restart may let one duplicate through, which is the right failure direction. It
needs a `resetNotifyDedupe()` export purely so module state does not leak between
spec files — the same reason `resetLibraryRefreshCooldown()` exists.

### Delivery

New dependency: **`web-push`**. Hand-rolling VAPID JWT signing plus `aes128gcm`
payload encryption (ECDH + HKDF) is not worth owning. Note this is the first piece
where a new runtime dependency is in scope; the previous piece's
no-new-dependencies rule was specific to it.

VAPID keys are generated once on first use and stored in `settings`:
`vapid_public`, `vapid_private`. **The private key must never cross the wire** —
kept off `SettingsRow` and off `settingsToWire`, exactly as `plex_client_id` is.

New table:

```sql
CREATE TABLE push_subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  label TEXT NOT NULL DEFAULT '',
  created INTEGER NOT NULL,
  last_ok INTEGER,
  fail_count INTEGER NOT NULL DEFAULT 0
)
```

`user_id` is carried from day one even though the bridge is single-account, so
nothing has to migrate if multi-account ever lands.

**A 404 or 410 from the push service means the subscription is dead — delete the
row.** That is the standard contract; without it dead endpoints accumulate forever.

### Which users trigger a notification

`settings.notify_users` — TEXT, JSON array of Tautulli usernames, default `''`.

**Empty means NOBODY, deliberately inverting the `settings.libraries` convention.**
That convention is safe because it only ever widens forwarding. This one interrupts
the operator's phone, so an upgrade must not start doing that for every account on
the server. Same reasoning as `shared_titles.plex_sync` defaulting to `0`.

The checklist is populated from `/api/tautulli/users` (which already exists and
returns `{ok, users: string[]}`), **not** from `mappings` — restricting it to mapped
users would cut off the unmapped-housemate case above.

`settings.notify_enabled` — INTEGER, default `0`. Master switch, off on upgrade.

### Endpoints

All authenticated. **Nothing is added to `PUBLIC_API_PATHS`.**

| Route | Purpose |
| --- | --- |
| `GET /api/push/key` | VAPID public key, generating the pair on first call |
| `POST /api/push/subscribe` | store `{endpoint, keys: {p256dh, auth}, label}` |
| `DELETE /api/push/subscribe` | remove by endpoint |
| `GET /api/push/devices` | list for the Settings UI |
| `DELETE /api/push/devices/[id]` | revoke one device |
| `POST /api/push/test` | send a test notification to all subscriptions |

### Service worker

Handlers are **added to the existing `public/sw.js`**, which is already registered.
It still gets no `fetch` handler.

- `push` → `showNotification()`
- `notificationclick` → focus an existing client if one is open, else `openWindow()`

`tag` is `${username}:${rating_key}` so a repeat replaces rather than stacks.

**The notification icon is `/icon-192.png`, not the poster art.** Poster art would
come from `/api/image`, which requires a session; icon fetches performed by the
browser for a notification do not reliably carry credentials, and the failure mode
is a silently iconless notification. Not worth it.

Content: title `${username} started ${showOrTitle}`, body the episode/film detail
plus a hint that tapping counts it for someone.

### Deep link

Notification data carries `/dashboard?watch=<rating_key>&user=<username>`.

`dashboard.vue` reads the query, matches it against the live `activity` sessions,
and opens the Watch-together dialog. `NowPlaying.vue` gains a `focus` prop
(`{rating_key, username} | null`) with a watcher that opens its own dialog — a prop
rather than `defineExpose`, matching how the rest of `app/` is written. The query is
cleared after opening so a refresh does not reopen it.

### iOS and platform floor

Design to the iOS floor: **tap-to-deep-link, no reliance on notification action
buttons**, which iOS ignores. Android action buttons are a possible later
enhancement, not part of this.

iOS Web Push requires the PWA be **installed to the Home Screen** (16.4+). Settings
must therefore detect and explain, rather than offering a button that cannot work:

- not a secure context → explain push needs HTTPS (the Cloudflare Tunnel)
- iOS and not standalone → "Add to Home Screen first", detected via
  `matchMedia('(display-mode: standalone)')` or `navigator.standalone`
- otherwise → the enable-notifications button

This is where the install onboarding the first piece deliberately deferred belongs.

### Webhook authentication

Currently `/api/webhook/tautulli` has no authentication and sits in
`PUBLIC_API_PATHS`. That is safe only while the bridge is LAN-only. Behind the
planned Cloudflare Tunnel, anyone who finds the hostname can POST forged scrobbles
into other people's seenr accounts.

Tautulli cannot hold a session cookie, but **its webhook agent supports custom
headers** — `syncSeenrWebhook` already writes `on_<action>_subject` as a JSON
headers object. So:

- `settings.webhook_secret` — TEXT, default `''`.
- `syncSeenrWebhook` generates it when absent and writes
  `X-Seenr-Bridge-Secret: <secret>` into the notifier's headers for every action.
- The webhook handler requires that header **only when a secret is set**, and
  returns 401 otherwise.

**Enforcement is coupled to the notifier being re-synced**, which is what makes this
safe to ship in a public image. A fresh install is authenticated from its first
sync. An existing install has no secret, so nothing changes until its owner clicks
"Sync to Tautulli" — and enforcement begins in the same action that delivers the
header, so there is no window where the endpoint 401s a correctly-configured
Tautulli. The alternative (generate on upgrade, enforce immediately) would silently
stop scrobbling for every existing install: the 401 happens before `processEvent()`,
so no event row is written, nothing shows on the Dashboard, and Tautulli surfaces
webhook failures poorly.

The path stays in `PUBLIC_API_PATHS` — the session middleware still must not gate
it — and the secret check lives in the handler. Two different kinds of caller,
two different mechanisms.

Settings shows a "re-sync to enable webhook authentication" hint while the secret
is empty.

## Testing

- **`tests/notify.spec.ts`** (new) — action gating (`play` notifies and does not
  scrobble; `watched` scrobbles and does not notify), `notify_users` membership,
  empty `notify_users` notifying nobody, the dedupe window and
  `resetNotifyDedupe()`, and the library gate. `web-push` is mocked; no network.
- **`tests/db.spec.ts`** — `push_subscriptions` insert/list/delete, dead-endpoint
  pruning, `notify_users` parsing (`''`, `null`, malformed JSON and non-array all
  collapsing to `[]`, mirroring `parseLibraries`), and that `vapid_private` and
  `webhook_secret` never appear in `settingsToWire`'s output.
- **`tests/auth.spec.ts`** — webhook secret enforcement: absent secret accepts an
  unauthenticated call, present secret rejects a call without the header and
  accepts one with it.
- The service worker's `push`/`notificationclick` handlers cannot be meaningfully
  unit-tested under plain Vitest and are verified manually.

## Verification and its limits

Testable here: the whole server side, plus that `/api/push/*` requires a session.

**Not testable from this machine, and it must not be claimed otherwise:** the actual
end-to-end push. It needs a secure context for the subscription, and on iOS a
Home-Screen install. That means the Cloudflare Tunnel has to be up. Desktop Chrome
over `localhost` is a secure context and is the cheapest first real test.

## Non-goals

- No Android notification action buttons.
- No server-side Tautulli activity poller.
- No multi-account support; recipients are the single admin account's devices.
- No notification for scrobble failures (a plausible later feature, out of scope).
- No offline caching — the service worker still has no `fetch` handler.

## Migration checklist

Per CLAUDE.md, a new settings column must be threaded through five places, not one:
the `CREATE TABLE`, an append-only `PRAGMA table_info` guard, `SettingsRow`,
`getSettings`'s explicit column list, and `saveSettings`'s UPDATE — plus
`settingsToWire` for anything that should reach the browser, and deliberately *not*
for `vapid_private` and `webhook_secret`.

New columns: `notify_enabled`, `notify_users`, `vapid_public`, `vapid_private`,
`webhook_secret`.
