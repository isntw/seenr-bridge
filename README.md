# Seenr Bridge

A small self-hosted service that makes **Tautulli → [seenr](https://seenr.app)** scrobbling work correctly for **TV episodes and movies**, for **every Plex user** — with a web UI to set it up and watch it work.

![version](https://img.shields.io/badge/version-1.0.0-8b5cf6)

## Why it exists

seenr identifies an episode by its **own** TMDb/TVDb/IMDB id. But Tautulli's webhook template can only emit the **show's** id for an episode ([Tautulli #2510](https://github.com/Tautulli/Tautulli/issues/2510) — an open, unresolved feature request). So a raw Tautulli webhook sends the *series* id, seenr resolves it as an *episode* id, and you get checked in on the **wrong show**.

Plex's own webhooks send the right episode ids — but they only fire for the **server owner**, not shared users. Tautulli sees everyone's playback, so the bridge keeps Tautulli as the source and fixes the missing piece:

> It receives each Tautulli event, looks the item's **real ids** up by `rating_key` via the Tautulli API, builds a proper Plex `media.scrobble` payload, and forwards it to the right user's seenr token — ID-based and title-independent, for all users.

```
Plex ──play──▶ Tautulli ──webhook {rating_key, user, action}──▶ Seenr Bridge
                                                                    │  get_metadata(rating_key) → real ids
                                                                    ▼
                                              POST payload=<plex media.scrobble> ──▶ seenr.app/.../<user token>
```

## Features

- **Correct episode + movie check-ins** by real external id (fixes the wrong-show bug).
- **One webhook covers every user** — the bridge routes to the right seenr account by username.
- **Per-user settings** — each user has their own seenr token, an on/off switch, and a choice of what to sync (TV episodes / movies).
- **One-click Tautulli setup** — a "Sync to Tautulli" button creates/updates the webhook via Tautulli's API (or copy-paste it manually).
- **Live dashboard** — recent scrobbles with poster art, the matched id, per-event status, and library stats (total / episodes / movies / users).
- **Login-protected** — first run creates your account; after that it's login-only.

## Requirements

- Docker + Docker Compose
- A running [Tautulli](https://tautulli.com) instance (with an API key) monitoring your Plex server
- A [seenr](https://seenr.app) account and each user's Plex scrobble token

## Install

**Quickest — no clone, just the pre-built image:**

```bash
mkdir seenr-bridge && cd seenr-bridge
curl -O https://raw.githubusercontent.com/isntw/seenr-bridge/main/docker-compose.yml
docker compose up -d
```

…or paste this into a `docker-compose.yml` and run `docker compose up -d`:

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

**Build from source instead:**

```bash
git clone https://github.com/isntw/seenr-bridge.git
cd seenr-bridge
docker compose -f docker-compose.build.yml up -d --build
```

Then open **http://<host>:8687**.

> The bridge must be reachable from your Tautulli container/host, since Tautulli posts webhooks to it.

**Updating:** `docker compose pull && docker compose up -d`.

## First run

1. On first visit you'll be asked to **create an account** (username + password, 8+ chars). After that the app is login-only — registration closes.
2. You land on the **Dashboard**. Go to **Settings** to wire things up.

## Setup (Settings page)

A guided, three-step flow:

**1. Connect Tautulli** — enter your Tautulli URL (e.g. `http://tautulli:8181`) and API key (Tautulli → Settings → Web Interface → API key). Click **Test connection**, then **Save**.

**2. Map users to seenr** — add one row per user: their Plex **username** and their seenr **token** (the part after `/scrobble/plex/` in that user's seenr webhook URL). Click a user's **Configure** to set what they sync (TV episodes / movies) or pause them.

**3. Send Tautulli's events here** — pick which **triggers** to enable (**Watched** is the important one; Play/Stop/Pause/Resume are optional "now playing" events) and click **Sync to Tautulli**. That creates a single `Seenr Bridge` webhook notifier in Tautulli, pointed back at the bridge, with no per-user conditions.

> Prefer to do it by hand? Expand **"Set it up manually instead"** for the exact URL, headers, and JSON body to paste into a Tautulli Webhook agent.

That's it — play something past the watched threshold and it shows up on the Dashboard and in seenr.

## Advanced settings

Under **Settings → Advanced**:

- **Forward to seenr** — master on/off switch for all forwarding.
- **seenr base URL** — the endpoint each user's token is appended to (default `https://seenr.app/api/v1/scrobble/plex`, correct for seenr.app).
- **Bridge public URL** — the URL Tautulli uses to reach the bridge. Blank = auto-detected from your browser address; set it only if the bridge sits behind a reverse proxy/domain.

Account settings (change password, log out) live in the **account menu**, top-right.

## How matching works

- **Episodes** → the payload carries the **episode's own** `tmdb`/`tvdb`/`imdb` ids (looked up via the Tautulli API) plus show title and season/episode. seenr matches by id.
- **Movies** → the movie's own ids.

## Security

- The whole UI and API require login, **except** `/api/webhook/tautulli` (Tautulli can't authenticate) and `/api/health` + `/api/version`.
- Passwords are hashed with scrypt. Sessions are httpOnly cookies.
- Because the webhook endpoint is unauthenticated, keep the bridge on a trusted network. If you expose it publicly, put it behind a reverse proxy with its own protection.

## Data & backup

All state (settings, users, mappings, event history) lives in **`./data/seenr-bridge.db`** (SQLite), mounted into the container. Back up that file to preserve everything. Event history is capped at the most recent **1,000** entries.

## API reference

| Method | Path | Auth | Purpose |
|---|---|:---:|---|
| POST | `/api/webhook/tautulli` | public | Tautulli posts playback events here |
| GET | `/api/health`, `/api/version` | public | health + version |
| POST | `/api/auth/register`, `/login`, `/logout`, `/change-password` | mixed | authentication |
| GET/PUT | `/api/settings` | ✓ | connection + advanced config |
| GET | `/api/status` | ✓ | readiness (Tautulli, webhook, users) |
| GET/POST/DELETE | `/api/mappings` | ✓ | per-user token + sync config |
| POST | `/api/tautulli/sync-webhook` | ✓ | create/update the Tautulli webhook |
| GET | `/api/events` | ✓ | recent scrobbles (`?limit=`) |
| GET | `/api/stats` | ✓ | dashboard counts |
| POST | `/api/test` | ✓ | build (`dryRun`) or send a test scrobble |

## Development

Runs both halves with hot-reload, no image rebuilds:

```bash
docker compose -f docker-compose.dev.yml up -d
# UI (Vite HMR):  http://<host>:5173
# API (tsx watch): http://<host>:8687
```

Or without Docker:

```bash
cd server && npm install && npm run dev   # :8687
cd client && npm install && npm run dev   # :5173 (proxies /api)
```

## Versioning

The version is defined once in `server/src/version.ts`, served at `/api/version`, and shown in the sidebar + login screen. Bump it there on release.

## Stack

React + Vite + TypeScript (client) · Express + better-sqlite3 + TypeScript (server) · Docker.
