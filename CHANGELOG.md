# Changelog

Notable changes per release. Versions follow [semantic versioning](https://semver.org).

## 2.3.1

### Added

- **Sign in with Plex.** The login page now offers Plex sign-in to whoever **owns** the Plex server the bridge watches — the same test Tautulli uses for its own admin sign-in. There is nothing to link and nothing to configure: if you own the server, you are the operator. A user you have merely *shared* the server with is refused, since access is not ownership.
- On a **brand-new install** Plex sign-in also creates the account, named after your Plex username and with no password. Set one later from the account menu if you want a second way in, or never — password sign-in stays closed until you do, so a passwordless account is not a way in.
- Your password keeps working throughout, so a plex.tv outage can never lock you out. For the same reason the login page hides the Plex button when the bridge has no Tautulli connection yet: without it there is no server whose owner could be checked.

### Fixed

- A shared title only matched watches from the exact library copy it was created from. Two libraries can hold the same show or film under different `rating_key`s — e.g. House as both "House" in *TV Shows* and "Dr. House" in *Seriale* — so a share created from the copy you don't play from matched nothing: no fan-out to the co-watchers, no Plex marking, and no error to explain it. Shares now match on Plex's own id for the title, which is identical across library copies, with `rating_key` kept as a fallback. Existing shares have their id filled in automatically on the next visit to the Shared page; nothing needs re-adding.
- Dashboard rows now carry the same gold Plex badge as the Shared page, so a watch that reached Plex says so without hovering a recipient.

### Known limitation

- The retroactive "sync all previously watched episodes" option still searches history by the shared copy's own `rating_key`, so choosing it on a share created from a library you don't play from reports "No watched episodes found in Tautulli history" rather than finding them under the other copy.

## 2.3.0

### Added

- A shared title can now also be marked watched **in Plex** for its co-watching profiles, not just checked in to seenr. Tick "Also mark watched in Plex" when adding or editing a shared title. Whoever actually pressed play is skipped — their copy is already watched — and the retroactive "sync all previously watched episodes" option marks Plex too.
- Settings gained a Plex step. Sign in once as the server owner and the bridge finds each co-watcher's own Plex access by itself, including profiles you add later. It reports how many of your mapped users it can act for, so a gap is visible before it matters rather than as a silent no-op. Anyone it cannot find — typically a Plex Home profile, which Plex does not list — can be given a token by hand under Configure.
- The Shared page marks titles that write to Plex with a gold Plex badge, so it is visible from the list rather than only inside each title's dialog.
- Dashboard event rows show whether the Plex write landed alongside the seenr result. A delivery whose seenr check-in succeeded but whose Plex write failed is amber, not green.

### Changed

- The master switch is now labelled **Syncing** rather than Forwarding, because it gates the Plex writes as well — naming it after one of the two destinations understated what turning it off does. Behaviour is unchanged: off still means nothing is sent anywhere. Events recorded while it is off now read "Syncing is disabled in settings".

### Notes

- Watched state in Plex belongs to an account rather than to an item, so marking a co-watcher's copy requires that co-watcher's own access. Discovered tokens are held in memory only and never written to the database.
- Existing shared titles default to **off**: an upgrade writes to nobody's Plex until you opt a title in.
- A failed Plex write is recorded on the event row without marking the delivery failed. The Dashboard's failure count continues to mean "the seenr forward failed", which is what it has always meant.
- No new configuration is required. The Plex server address is derived from the Tautulli connection you already have.

## 2.2.3

### Changed

- The README's version badge reads the latest release from shields.io instead of carrying a hardcoded number, so it can no longer drift from what is actually released.

## 2.2.2

### Internal

- Releases are cut automatically from `shared/version.ts`: pushing a version bump to `main` builds the image, creates the tag and publishes the release. No change to the bridge itself.

## 2.2.1

### Added

- **An app icon.** The bridge had no favicon, so every tab showed the browser's blank default. It now carries seenr's tile with the Plex mark in the badge — the two services it sits between.

## 2.2.0

### Added

- **Library selection** (Settings → Tautulli). Pick which Tautulli libraries the bridge reads titles from and forwards playback for. Leaving everything ticked means **all**, so upgrading changes nothing and libraries you add in Plex later are included automatically.
- The **Shared** page and the edit modal now show which library each co-watched title came from. Two active libraries can hold the same title under different `rating_key`s and forwarding gates on the library, so a share pointing at the copy you don't play from would silently forward nothing.
- **Test connection** reports its verdict on the button itself — ✓ Connected or ✕ Failed — instead of a toast that has gone by the time you look.
- **Skeleton loading** on the Dashboard, Settings and Shared pages.

### Fixed

- **The title picker was reading a stale cache.** Tautulli's media-info table only rebuilds when asked, so the picker could show a fraction of a library — measured on a live server: 99 of 308 films — *and* offer `rating_key`s that Plex no longer resolves, which rendered a placeholder poster and would have scrobbled nothing. It now detects the staleness and refreshes, once per library.
- Adding a shared title defaults to **only new watches** rather than retroactively backfilling every episode already watched.
- Alignment and wording fixes across the list rows and modals.

### Changed

- The UI now uses stock Nuxt UI components throughout — badges, tabs, collapsibles, buttons, chips, separators, empty states — replacing hand-rolled markup and nine component-level theme overrides.

## 2.0.0

First published release.
