# API reference

Every route lives under `/api/`. Everything requires a session cookie unless
marked **public** — see `PUBLIC_API_PATHS` in `server/utils/auth.ts` for the
authoritative list.

Only the first three are things you'd normally call yourself: Tautulli posts to
the webhook, and health/version are useful for Docker healthchecks and monitoring.
The rest is what the web UI talks to.

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/webhook/tautulli` | **public** — Tautulli posts playback events here |
| GET | `/api/health`, `/api/version` | **public** — health + version |
| — | `/api/auth/status`, `/login`, `/register`, `/logout` | **public** — auth flow |
| POST | `/api/auth/change-password` | change your password |
| GET/PUT | `/api/settings` | connection + advanced config |
| POST | `/api/settings/test-tautulli` | probe a URL + API key without saving |
| GET | `/api/status` | readiness — Tautulli, webhook, users |
| GET/POST | `/api/mappings` · DELETE `/api/mappings/:id` | per-user token + sync config |
| GET/PUT | `/api/shared` | co-watched titles and their profiles |
| POST | `/api/shared/:rating_key/backfill` | replay already-watched items to co-watchers |
| GET | `/api/tautulli/users` | Plex usernames for the mapping picker |
| GET | `/api/tautulli/library` | browse shows/movies (`?type=&search=&start=&length=`) |
| GET | `/api/tautulli/children` | seasons or episodes of a `rating_key` |
| GET | `/api/tautulli/activity` | live Tautulli sessions |
| POST | `/api/tautulli/sync-webhook` | create/update the Tautulli webhook |
| GET | `/api/events` | recent scrobbles (`?limit=`) |
| GET | `/api/stats` | dashboard counts |
| GET | `/api/image` | poster art, proxied via Tautulli |
| POST | `/api/pending` | record a one-off watch for multiple profiles |
| POST | `/api/test` | build (`dryRun`) or send a test scrobble |

Anything under `/api/` that doesn't match a route returns a JSON 404 rather than
the SPA shell — unauthenticated callers get a 401 first, since the auth middleware
runs before routing and so never reveals which routes exist.

## The webhook

The one endpoint you point something else at. Tautulli's notifier is created for
you by **Sync to Tautulli** on the Settings page; this is what it sets up.

```
POST /api/webhook/tautulli
Content-Type: application/json

{"action": "{action}", "rating_key": "{rating_key}", "username": "{username}"}
```

It replies **202 immediately** and processes afterwards, so a failure never shows
up as an HTTP error — it lands as a row on the Dashboard instead. Debug forwarding
problems there, not by reading response codes.

## Live activity and one-off watches

### `GET /api/tautulli/activity`

Live Tautulli sessions, as `ActivitySession[]`. `[]` when nothing is playing, when
Tautulli is not configured, and when Tautulli cannot be reached — the Dashboard
treats all three the same, by not rendering the Now playing card.

### `POST /api/pending`

Body: `{ rating_key: string, guid?: string, mapping_ids: number[] }`.
Records a one-off: when that item's `watched` event arrives, it is also counted for
those profiles, then the record is deleted. Rows expire after 24h. Returns
`{ added: number }`; adding the same profile twice adds nothing.
