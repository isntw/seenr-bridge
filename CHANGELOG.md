# Changelog

Notable changes per release. Versions follow [semantic versioning](https://semver.org).

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
