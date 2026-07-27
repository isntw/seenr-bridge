# Mark co-watched titles as watched in Plex

**Date:** 2026-07-27
**Status:** approved, not yet implemented

## Problem

The bridge already fans a watch out to every profile assigned to a shared title, so
seenr shows the episode as seen for all co-watchers. Plex does not: only the account
that actually pressed play has it marked watched. The co-watcher's Plex keeps offering
the episode in Continue Watching / On Deck, and their unwatched counts are wrong.

Goal: when a title flagged as shared is watched, also mark it watched **in Plex** for
the co-watching profiles.

## Investigation

### Plex webhooks cannot do this

Webhooks are outbound only. Plex's own documentation defines them as "one or more URLs
to be hit by the Plex Media Server when certain things happen" — there is no inbound
webhook that writes state. Two incidental findings while confirming this:

- Webhooks are "tied to a specific user", and a server "receive[s] webhooks for the user
  who is signed into the server, as well as webhooks for shared users". This is a mild
  correction to the premise recorded in `CLAUDE.md` ("Plex's own webhooks ... only fire
  for the server owner"). It changes nothing here — they still cannot write — but the
  `CLAUDE.md` sentence should be softened if it is ever revisited.
- Webhooks require Plex Pass on the server's admin account.

### The write path that does exist

```
GET <pms>/:/scrobble?key=<ratingKey>&identifier=com.plexapp.plugins.library
    X-Plex-Token: <token of the account whose state should change>
```

`/:/unscrobble` reverses it; `/:/progress?...&time=<ms>` sets a partial offset. Neither
is used here. The param shape is corroborated by python-plexapi's `updateProgress`,
which builds `/:/progress?key=…&identifier=com.plexapp.plugins.library&time=…&state=…`
verbatim, and by a second independent implementation using `key` + `identifier` against
`/:/scrobble`.

### Why per-user tokens are unavoidable

Watched state in Plex is not a property of the item; it is a row belonging to an
account, and the token on the request is the only thing that selects which account. The
same `/:/scrobble` call differing only in `X-Plex-Token` writes two different people's
state. There is no admin impersonation parameter — searched for specifically
(`X-Plex-Account-ID`, an `accountID` param) with no result.

Corroboration from three directions:

- Plex's own cross-server watch-state sync is an account-level setting, "associated with
  a Plex GUID, not any particular Plex Media Server", and the server owner cannot enable
  or disable it on a user's behalf.
- Tautulli has server-wide admin via its API key and still exposes **no** mark-watched
  command. It holds each user's server token internally; it used to return it as
  `server_token` from `get_users` and removed that in v2.10.1, so we cannot borrow its copy.
- The only tools that change watched state for all users without tokens do it by writing
  PMS's SQLite directly (`metadata_item_settings`, keyed by `account_id`).

The direct-database route is **rejected**: it needs filesystem access to Plex's data
directory (the bridge is a separate container, plausibly a separate host), Plex holds
viewstate in memory so writes are overwritten or need a restart, and editing a live Plex
database is a known corruption path. The bridge is a pure HTTP client and stays one.

### Obtaining the per-user tokens

```
1. owner signs in via Plex OAuth              → owner token
2. GET plex.tv/api/servers/<machineId>/shared_servers?X-Plex-Token=<owner>
                                              → <SharedServer username= userID= accessToken=>
                                                 one entry per user the server is shared with
3. GET <pms>/:/scrobble?…  X-Plex-Token=<that user's accessToken>
                                              → that user's copy is watched
```

Step 2 is exactly what python-plexapi's `MyPlexUser.get_token(machineIdentifier)` does:
it queries `https://plex.tv/api/servers/{machineId}/shared_servers` and returns the
`accessToken` attribute of the entry whose `userID` matches. Two community sources give
the same instruction for retrieving a shared user's token.

Managed/home users may not appear there. For those, `POST
plex.tv/api/home/users/<id>/switch` with the owner token returns that profile's token
(python-plexapi's `switchHomeUser`; needs the profile's PIN if one is set).

### No new server address to configure

Tautulli's `get_server_info` returns `pms_identifier` (the machineIdentifier),
`pms_url`, `pms_ip`, `pms_port` and `pms_ssl`. The bridge derives both the PMS address
and the machine identifier from the Tautulli connection it already has, and asks the
operator for no additional URL.

### Feedback loop: expected to be a non-issue

`/:/scrobble` creates no playback session, and Tautulli's `watched` trigger fires off
sessions it is monitoring, so the bridge should not hear its own writes back as new
webhooks. This is an assumption, and it is verified in step 0 below rather than trusted.

## Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Token acquisition | Owner token, per-user tokens auto-discovered | One secret, no per-profile setup, covers profiles added later |
| Owner token entry | Plex OAuth PIN login ("Sign in with Plex") | No hunting for `X-Plex-Token` in XML; confirms which account is connected |
| Discovery misses | Manual per-mapping token field | Home profiles and odd setups still work without blocking the feature |
| Toggle granularity | Per shared title | Only some co-watched titles should touch Plex |
| Trigger user | Skipped | They pressed play; Plex already knows |
| Backfill path | Included | Retroactively sharing an already-watched show is the most valuable case |
| Un-sharing | Never un-watches | `/:/unscrobble` is out of scope permanently |
| Discovered tokens | In memory only, never persisted | Other people's Plex credentials stay out of the database file |

## Step 0 — verification spike

The feature rests on two facts that documentation cannot settle. Before any schema or
UI work, a throwaway script must confirm both against the live server:

1. `shared_servers` returns an `accessToken` for the actual co-watching users — and
   whether those users are shared accounts or home profiles (deciding whether the
   `home/users/<id>/switch` path is needed at all).
2. A borrowed `accessToken` authorizes `/:/scrobble` on the PMS, i.e. the co-watcher's
   copy actually flips to watched.

While there, confirm no Tautulli `watched` webhook arrives as a result of step 2.

If step 0 fails, the feature is reconsidered rather than worked around. Nothing below is
worth building on an unverified mechanism.

## Architecture

### New module: `server/utils/plex.ts`

Framework-agnostic, **explicit relative imports only** — never Nitro auto-imports — so
the spec files can import it directly (the standing `server/utils` rule).

| Export | Responsibility |
|---|---|
| `getPlexServer(tautulliUrl, apiKey)` | `{ url, machineId }` from Tautulli's `get_server_info` |
| `getSharedTokens(machineId, ownerToken)` | `Map<username, accessToken>` parsed from `shared_servers` |
| `resolvePlexToken(username, settings, mapping)` | Manual override → discovery cache → plex.tv lookup |
| `markWatched(plexUrl, token, ratingKey)` | The `/:/scrobble` call; returns an HTTP status |
| `startPinLogin(clientId)` / `pollPinLogin(clientId, id)` | The OAuth PIN pair |
| `resetPlexTokenCache()` | Test seam, mirroring `resetLibraryRefreshCooldown()` |

Before adding these, check each name against h3/Nitro auto-imports — `npm run typecheck`
surfaces collisions as `WARN Duplicated imports`. This is why `getSessionByToken` and
`setSessionCookie` are named as they are.

`shared_servers` returns **XML**, not JSON — unlike every other call in this codebase.
Parse the `accessToken` and `username` attributes without adding an XML dependency.

Discovered tokens live in a module-level `Map` with a TTL, the same shape as
`lastRefreshAt` in `tautulli.ts`. A restart costs one plex.tv call.

### The OAuth PIN flow

```
POST https://plex.tv/api/v2/pins?strong=true    X-Plex-Client-Identifier, X-Plex-Product
     → { id, code, authToken: null }
user visits https://app.plex.tv/auth#?clientID=<clientId>&code=<code>
GET  https://plex.tv/api/v2/pins/<id>           X-Plex-Client-Identifier (same value)
     → { authToken: "…" } once approved
```

The client identifier used to create the PIN **must** match the one used to poll it, so
it is generated once (`crypto.randomUUID()`) and persisted in settings.

Confidence note: the scrobble and `shared_servers` mechanics above are well corroborated;
this PIN parameter set is researched less deeply and should be confirmed against a live
call early in implementation.

### Pipeline integration

The write goes inside `deliverToMapping()`, after the existing `enabled` /
`sync_movies` / `sync_episodes` gates — so a profile that does not sync episodes does not
get their Plex touched either, without a new condition.

The seenr forward and the Plex write are **independent**: both are attempted, both are
recorded, neither failing skips the other.

Whether to write is decided by the *caller*, not by `deliverToMapping()` inspecting the
share itself — it already takes `record` as a caller-supplied flag and this follows that
shape, keeping the function ignorant of why it was called:

- `processEvent()` passes `markPlex: share.plex_sync && rcpt.id !== trigger.id`. The
  trigger is excluded here because they pressed play; Plex already knows.
- `backfillSharedTitle()` passes `markPlex: share.plex_sync` for every profile. There is
  no trigger user in a backfill — nobody just watched anything — so nobody is excluded.

Both need `plex_sync` on the share row, which `getSharedRecipients()` does not currently
return; either it or the callers must read it.

Volume: a 60-episode show × 2 co-watchers is 120 sequential Plex calls on backfill. The
existing backfill is already sequential per item × profile; this follows suit rather than
introducing concurrency.

### Schema

Four columns plus the client identifier, all via the existing append-only
`PRAGMA table_info` guards at the bottom of `db.ts`:

| Table | Column | Purpose |
|---|---|---|
| `settings` | `plex_token TEXT NOT NULL DEFAULT ''` | owner token from the login |
| `settings` | `plex_client_id TEXT NOT NULL DEFAULT ''` | stable X-Plex-Client-Identifier |
| `mappings` | `plex_token TEXT NOT NULL DEFAULT ''` | manual override for discovery misses |
| `shared_titles` | `plex_sync INTEGER NOT NULL DEFAULT 0` | the per-title toggle |
| `events` | `plex_status INTEGER` | outcome, mirroring `seenr_status` |

`plex_sync` defaults to **0**, deliberately inverting the "empty means all" convention
`settings.libraries` uses. That convention is safe because it only ever widens
forwarding; this one writes into other people's Plex libraries, so an upgrade must not
start doing that to titles shared months ago.

Each column must be threaded through: the `CREATE TABLE`, the `ALTER TABLE` guard, the
row interface, and — for settings — `getSettings`'s explicit column list and
`saveSettings`'s UPDATE. `plex_sync` is a plain assignment in `setSharedTitle` (not
`COALESCE` like the library columns) because both the add flow and the edit modal carry
the checkbox state.

### Wire contract (`shared/types/index.ts`)

`Settings.plex_token`, `Mapping.plex_token`, `SharedTitle.plex_sync: boolean`,
`ScrobbleEvent.plex_status: number | null`. The `0`/`1` → boolean conversion for
`plex_sync` goes in `sharedTitleToWire`, alongside the existing ones — not scattered
elsewhere.

Note `plex_token` values cross the wire to the settings and mappings pages the same way
`tautulli_apikey` and `seenr_token` already do. That is the established pattern here and
the endpoints are authenticated; it is called out only so the choice is conscious.

### API endpoints

All authenticated (nothing added to `PUBLIC_API_PATHS`):

- `POST /api/plex/pin` — start the login, returns `{ id, code, url }`
- `GET /api/plex/pin/[id].get.ts` — poll; on success saves the token to settings
- `GET /api/plex/users` — the matched/unmatched report for the Settings panel

`server/api/settings/index.put.ts` and `mappings/index.post.ts` must accept the new
fields, and `shared/index.put.ts` must accept `plex_sync`, or the columns are written
nowhere.

### UI

- **Settings** — a Plex section: `Sign in with Plex`, then "Signed in as *x* — 3 of 3
  mapped users matched", so a missing token is visible now rather than silently failing
  at 2am. Unmatched users get a paste field.
- **Share modal** (`SharedTitleModal.vue`) — `☐ Also mark watched in Plex` beside the
  profile checkboxes, disabled with a reason when no Plex token is configured.
- **Dashboard** (`EventRow.vue`) — a small Plex badge beside the seenr status.

Use stock Nuxt UI components, and grep `.nuxt/components.d.ts` for any component used
here for the first time — a misspelled name passes both `typecheck` and `build`, then
renders nothing.

### Failure semantics

`ok` keeps meaning **the seenr forward succeeded**. A Plex write failing must not flip
it, or the Dashboard's failure count stops describing the bridge's actual job. Plex
outcomes land in `plex_status`, and a Plex error is appended to `error`.

The webhook still returns `202` before any of this runs — `processEvent()` remains
detached via `event.waitUntil` with a swallowed `.catch()`, so Plex problems are
diagnosed through `/api/events`, never through response codes.

## Tests

- **`tests/plex.spec.ts`** (new) — stubs `global.fetch` via `vi.stubGlobal` the way
  `tautulli.spec.ts` does: `shared_servers` XML parsing, `resolvePlexToken` precedence
  (override → cache → lookup), `markWatched` URL construction, cache TTL via the reset seam.
- **`tests/pipeline.spec.ts`** — the trigger is skipped; `plex_sync = 0` writes nothing;
  a failing Plex write leaves `ok = 1`; a profile with `sync_episodes = 0` gets no Plex call.
- **`tests/db.spec.ts`** — the new columns migrate and round-trip through the `*ToWire()`
  boundary.

No network calls in any spec.

## Out of scope

- Un-watching when a share is removed (`/:/unscrobble`).
- Partial progress / view offsets (`/:/progress`).
- Marking watched for non-shared titles — the watcher's own Plex is already correct.
- Writing PMS's SQLite directly.
- Syncing watched state *from* Plex back into the bridge or seenr.

## Risks

| Risk | Mitigation |
|---|---|
| `shared_servers` returns no token for these users | Step 0 catches it; home-user switch path, then manual override |
| A borrowed token is rejected for writes | Step 0 catches it before anything is built |
| A Plex write loops back as a Tautulli webhook | Verified in step 0; no session is created, so not expected |
| Owner token revoked later | Settings panel shows the matched-user count; failures recorded per event |
| Backfill call volume | Sequential, matching existing backfill behaviour |
