# Seenr Bridge

A tiny self-hosted service that makes **Tautulli → seenr** scrobbling work correctly for **TV episodes** (and movies), for **all users**.

## Why it exists

seenr identifies episodes by their **own** TMDb/TVDb/IMDB id. But Tautulli's webhook template can only emit the **show's** id for an episode ([Tautulli #2510](https://github.com/Tautulli/Tautulli/issues/2510) — open feature request). The result: an episode webhook carries the *series* id, seenr resolves it as an *episode* id, and you get checked in on the **wrong show**.

Plex's native webhooks send the right episode ids — but only fire for the **server owner**, not shared users. Tautulli sees everyone, so we keep Tautulli as the source and fix the missing piece here.

**The bridge** receives each Tautulli event, looks up the item's real ids by `rating_key` via the Tautulli API, builds a proper Plex `media.scrobble` payload with the **episode's own ids**, and forwards it to the right user's seenr token. ID-based, title-independent, both users.

```
Plex ──play──▶ Tautulli ──webhook {rating_key, user, action}──▶ Seenr Bridge
                                                                    │  get_metadata(rating_key) → real episode ids
                                                                    ▼
                                                        POST payload=<plex media.scrobble> ──▶ seenr.app/.../<user token>
```

## Quick start

```bash
docker compose up -d --build
```

Open **http://<host>:8687** and go to **Settings**:

1. **Connection** — set your Tautulli URL + API key (Tautulli → Settings → Web Interface → API key). Leave the seenr base URL as-is. Click *Test Tautulli connection*.
2. **User → seenr mappings** — add one row per user: their Plex **username** and their seenr **token** (the part after `/scrobble/plex/` in their seenr webhook URL).
3. **Test a scrobble** — enter a `rating_key` + username, hit *Preview payload* (builds it, doesn't send) or *Send to seenr*.

## Configure Tautulli

Create **one** Webhook notification agent pointing at the bridge (it handles every user; the bridge routes by username):

- **Webhook URL:** `http://<bridge-host>:8687/api/webhook/tautulli`
- **Method:** POST
- **Triggers:** Watched (add Play/Stop/Pause/Resume if you also want progress events)
- **JSON Headers:** `{"Content-Type": "application/json"}`
- **JSON Data** (same for each enabled trigger):

```json
{"action": "{action}", "rating_key": "{rating_key}", "username": "{username}"}
```

That's it — no `<movie>`/`<episode>` tricks, no per-user notifiers. The bridge does the id lookup Tautulli can't.

## How matching works

- **Episodes:** payload carries the episode's own `Guid` ids (`tmdb://…`, `tvdb://…`, `imdb://…`) plus `grandparentTitle` + season/episode → seenr matches by id.
- **Movies:** the movie's own ids (same as Tautulli would send correctly anyway).

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/webhook/tautulli` | Tautulli posts here |
| GET/PUT | `/api/settings` | connection config |
| GET/POST/DELETE | `/api/mappings` | user → token mappings |
| GET | `/api/events` | recent scrobbles |
| POST | `/api/test` | build/send a test scrobble |

## Data

State lives in `./data/seenr-bridge.db` (SQLite), mounted into the container. Back that file up to keep settings + history.

## Development

```bash
# terminal 1
cd server && npm install && npm run dev      # http://localhost:8687
# terminal 2
cd client && npm install && npm run dev      # http://localhost:5173 (proxies /api)
```
