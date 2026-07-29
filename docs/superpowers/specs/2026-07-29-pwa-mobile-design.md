# PWA shell and mobile polish

Date: 2026-07-29
Status: approved, ready to plan

## Goal

Make the bridge behave like an installed app on a phone: launchable from the home
screen, correct colours in the system chrome, no content hidden under the notch,
and no layout breaking at 390px.

This is the **first of two** pieces. Push notifications on stream start are a
separate, later piece — see "Deliberately out of scope" and "Follow-up".

## Non-goals

- **No offline support.** This is a live dashboard against a LAN service. A cached
  scrobble list is worse than an error, because it looks current and is not.
- **No `@vite-pwa/nuxt`.** See "Service worker" for why.
- **No in-app install button.** Browser-native "Add to Home Screen" covers this piece.
- **No push notifications.** Second piece.
- **No auth changes.** The bridge stays single-account.

## Design

### Manifest

New `public/manifest.webmanifest`:

| Field | Value | Why |
| --- | --- | --- |
| `name` | `Seenr Bridge` | |
| `short_name` | `Seenr Bridge` | Short enough already; no truncation needed. |
| `start_url` | `/dashboard` | **Not `/`.** `app/pages/index.vue` calls `navigateTo('/dashboard', { replace: true })`, so starting at `/` costs a redirect on every cold launch. `/dashboard` is already in `nitro.prerender.routes`. |
| `scope` | `/` | |
| `display` | `standalone` | |
| `background_color` | `#0a0e16` | Matches the `html, body` rule in `app/assets/css/main.css`, so the splash does not flash a different colour. |
| `theme_color` | `#0a0e16` | Same, for the Android toolbar. |
| `icons` | 192, 512, 512-maskable | |

### Head configuration

In `nuxt.config.ts` under `app.head`:

- `link` → `manifest.webmanifest`
- `meta` `theme-color` = `#0a0e16`
- `meta` `mobile-web-app-capable` = `yes` and `apple-mobile-web-app-capable` = `yes`
- `meta` `apple-mobile-web-app-status-bar-style` = `black-translucent`
- `link` `apple-touch-icon` → 180px PNG. iOS does not reliably take home-screen
  icons from the manifest; this link is what it actually uses.
- `meta` `viewport` = `width=device-width, initial-scale=1, viewport-fit=cover`

The viewport override is **load-bearing, not cosmetic**. Nuxt's default viewport
has no `viewport-fit`, and without `viewport-fit=cover` every `env(safe-area-inset-*)`
resolves to `0px` — so the safe-area work below silently does nothing.

### Icons

A new vector mark, matching the one already rendered in `app/layouts/default.vue`:
a rounded square with a violet→fuchsia gradient (`#8b5cf6` → `#c026d3`, to
bottom-right) and a white bold `S`. Those are Tailwind `violet-500` and
`fuchsia-600`, i.e. `from-primary-500 to-secondary-600` under the theme in
`app/app.config.ts`, and `#8b5cf6` is already the README badge colour.

Artefacts:

- `public/favicon.svg` — **replaced.** Today it is 27KB of base64 PNG wrapped in
  SVG (a 180×180 raster). The new one is real vector, a fraction of the size, and
  keeps the tab and the home screen visually identical.
- `public/icon-192.png`, `public/icon-512.png` — manifest icons, `purpose: any`.
- `public/icon-maskable-512.png` — `purpose: maskable`. Separate file because a
  maskable icon needs the mark inset inside the ~80% safe circle; reusing the
  standard icon gets the corners cropped by Android's mask.
- `public/apple-touch-icon.png` — 180×180.

**Rendering, and its one open question.** No SVG rasteriser is installed
(`magick`, `convert`, `rsvg-convert`, `inkscape` all absent; `sharp` is not a
dependency and will not be added for this). Available: macOS `sips` and `qlmanage`. The plan is to render with
`qlmanage -t -s <size>`.
Whichever is used, the PNGs are committed as build artefacts — there is no
generation step in the build, and no new runtime or dev dependency.

### Safe areas

The visible failure if this is skipped: `black-translucent` deliberately puts page
content *underneath* the iOS status bar, so the `sticky top-0` header in
`app/layouts/default.vue` renders its title under the clock.

Insets are **added to** the existing padding, never replacing it, so the layout is
unchanged on devices with no inset (where `env()` resolves to `0px`):

- Header (currently `py-3`): `padding-top: calc(0.75rem + env(safe-area-inset-top))`.
- `<main>` (currently `py-6 sm:py-8`): add `env(safe-area-inset-bottom)` to the
  bottom padding at both breakpoints.
- `USlideover` drawer content: add `env(safe-area-inset-left)` to its left padding.

Implemented as CSS in `app/assets/css/main.css` plus class changes in the layout,
following the existing convention in that file (note its comment about unlayered
declarations outbidding `@layer theme` — Nuxt UI's own padding lives in a layer,
so an unlayered rule is needed to win against the slideover's own padding).

`black-translucent` is a deliberate choice over the simpler `default`: the header
is already `bg-default/80 backdrop-blur`, so letting content blur up behind the
status bar is the intended look. The cost is that getting the top inset wrong is
visible rather than harmless, which is why it is called out in verification.

### Service worker

New `public/sw.js`, registered from a client-only Nuxt plugin. It has **no `fetch`
handler** and no caching whatsoever.

Two reasons it exists in this piece rather than the next:

1. It guarantees Android installability regardless of which Chrome version's
   install criteria apply.
2. It is the file the push and `notificationclick` handlers attach to later, so
   the second piece adds handlers to a registered worker instead of introducing
   one.

Having no `fetch` handler is the point, not an omission. A worker that cannot
intercept requests cannot serve a stale build — which matters more than usual
here, because this repo prerenders one `index.html` per route and its SPA shell
handling is already fragile (see the `_virtual_spa-template.mjs` note in
CLAUDE.md).

### Mobile layout audit

The nav and layout are already responsive: `lg:hidden` hamburger driving a
`USlideover`, sticky mobile top bar with the `TITLES` map, `grid-cols-2 sm:grid-cols-4`
stat tiles.

A static scan of `settings.vue`, `ItemPicker.vue`, `SharedTitleModal.vue`,
`EventRow.vue` and `shared.vue` found no fixed pixel widths, no `whitespace-nowrap`,
no `overflow-x`, and no grids wider than 4 columns. So there is no known list of
breakages to fix up front.

The audit is therefore empirical: load each route at 390×844 in a browser, confirm
`document.scrollingElement.scrollWidth <= clientWidth` (no horizontal scroll), and
check tap targets and dialog heights on the four heavy components. Fixes are
whatever that surfaces. `settings.vue` is 39KB and the most likely to need work.

## Verification

Unit tests do not apply — a static manifest, head config, and committed PNGs have
nothing meaningful to assert in Vitest. Verification is therefore explicit:

1. `npm test` and `npm run typecheck` still pass (nothing here should touch them).
2. `npm run build` then grep the served HTML for `<script ... src="/_nuxt/`.
   **Required, not optional:** this change edits `app.head`, and per CLAUDE.md a
   broken shell returns HTTP 200 with a blank page, so an HTTP check cannot catch it.
3. `/manifest.webmanifest` and every icon path return 200 from the built server.
4. a browser at 390×844: no horizontal scroll on `/dashboard`, `/shared`,
   `/settings`, `/login`.
5. Manual, on a real device — the only way to confirm the parts that matter:
   Android install prompt appears; iOS Add to Home Screen launches standalone with
   the header clear of the status bar.

Step 5 needs the Cloudflare Tunnel (or any HTTPS origin) to be up, because
installability requires a secure context. It is the one item that cannot be
verified from this machine over `http://serverip:8687`.

## Release

Per repo convention, one version bump at the end of the work: `shared/version.ts`
to `2.6.0` with a matching `## 2.6.0` section in `CHANGELOG.md`. The PR check
fails without both.

## Follow-up: push notifications

Designed but not built here. Recorded so the decisions are not re-litigated:

- **Trigger:** enable Tautulli's `play` trigger; the webhook route branches on
  action — `watched`/`scrobble` → `processEvent()` unchanged, `play`/`stop`/`pause`/`resume`
  → a new `server/utils/notify.ts`. A separate unit, not a mode flag threaded
  through `processEvent()`, because that function has six early returns and is the
  one path that must not break.
- **Why the branch is mandatory:** enabling `play` today would forward `media.play`
  to seenr, `deletePendingWatchesByIds()` at play time (destroying the watch-together
  window the notification exists to open), and `markWatched()` co-watchers' Plex at
  0% progress.
- **Why not the `watched` webhook:** it fires after the pending-watch window has
  already closed, so the notification would always arrive too late to act on.
- **Why no server-side activity poller:** the `play` trigger makes it unnecessary.
- **Notify-only actions must not write `events` rows** — that table is capped at
  1000 and trimmed on every insert, so play rows would flush real scrobbles out
  roughly twice as fast.
- **Recipients:** the single admin account, per-device push subscriptions. The
  `push_subscriptions` table carries `user_id` from day one so nothing has to
  migrate if multi-account ever lands.
- **Trigger users:** `settings.notify_users`, a JSON array of Tautulli usernames,
  following the `settings.libraries` precedent — except **empty means nobody**, not
  everybody, so enabling the feature does not immediately notify about every
  account on the server. Sourced from Tautulli's user list, not from `mappings`,
  because a housemate with no seenr mapping is still worth notifying about:
  `processEvent()` already delivers for them when `pending` is non-empty.
- **Platform floor is iOS:** requires Home Screen install, and ignores notification
  action buttons — so tapping deep-links into the Watch-together dialog rather than
  offering inline buttons. Android action buttons are a possible later enhancement.
- **One new runtime dependency:** `web-push`. Hand-rolling VAPID JWT signing plus
  `aes128gcm` payload encryption (ECDH + HKDF) is not worth owning.
- **VAPID private key must never cross the wire**, same treatment as
  `settings.plex_client_id`.
- **Dead subscriptions:** a 404/410 from the push service means delete the row.

## Security note, tied to the Cloudflare Tunnel

Not part of this piece, but it becomes real the moment the tunnel goes up, and it
would be negligent to leave unwritten.

`/api/webhook/tautulli` is unauthenticated by design — safe only while the bridge
is LAN-only, which is what the README currently assumes. Behind a public hostname,
anyone who finds the domain can POST forged scrobbles into other people's seenr
accounts.

Tautulli runs on the same host, so it can keep posting to the LAN address: the
webhook never needs to be publicly reachable. The tunnel should expose the UI and
block `/api/webhook/*` (Cloudflare WAF rule, or Access on the hostname). Worth
deciding whether to also add an optional `settings.webhook_secret` as
defence-in-depth.
