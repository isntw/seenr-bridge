# Changelog

Notable changes per release. Versions follow [semantic versioning](https://semver.org).

## 2.6.6

### Changed

- **Artwork moved to the notification's large image, and the app icon stays put.**
  The small icon slot is square and the platform stretches whatever it is given, so
  a 2:3 poster arrived squashed no matter how carefully it was fetched — and
  Tautulli cannot crop, it only scales to fit. The art now goes in the wide row
  instead, where a large picture belongs and where 16:9 is the right shape: the
  episode's own still for an episode, Plex's backdrop for a film, since a film's
  only other art is its poster.

## 2.6.5

### Fixed

- **The poster in a notification was squashed.** Tautulli resizes art to exactly the
  box it is asked for, and 2.6.3 asked for a square — so every 2:3 poster came back
  stretched. Posters are now requested at 2:3 and episode stills at 16:9, the shapes
  they actually are. The box is part of the URL's signature, so it cannot be edited
  back into a square by anyone holding the link.
- **The notification worker now updates itself.** The app asks the running worker
  its version on launch and replaces it only when it differs, which also covers a
  worker too old to answer. Nothing to notice and nothing to press.

### Removed

- **The "Notification worker" row in Settings.** It existed to report a stale worker
  and offer an Update button; the app now handles that on its own, so it was
  showing plumbing rather than anything to act on.

## 2.6.4

### Fixed

- **Notifications kept looking like an older build after an upgrade.** `sw.js` was
  served with no `Cache-Control` at all, so a browser could answer the service
  worker's own update check from its cache and keep running the previous worker for
  hours. The worker is what draws the notification, so the poster and the Mute
  button were missing while the app itself reported the new version — the two are
  served by different things. It is now sent as `no-cache`, so every update check
  reaches the server.

### Added

- **Settings → Notifications shows the notification worker's version**, and offers
  an Update button when it lags behind the app. Until now nothing in the UI could
  tell a stale worker from a current one: the version on screen comes from the
  server, so the app read as up to date while notifications did not.

## 2.6.3

### Added

- **The poster is now the notification's icon.** A play notification carries the
  show's poster (the film's own for a movie) in place of the app icon, and for an
  episode the still as the wide image too. The art is served by a new endpoint that
  needs no session — a notification's images are fetched by the browser with no page
  open — but each URL is signed and expiring, so it is not an open image proxy.

### Fixed

- **"Send test notification" now sends a real one.** It used to send a bare title
  and body: no poster, no Mute button, nothing a real notification has. That is
  indistinguishable from a broken build, which is exactly how it was read. The test
  now rebuilds the notification for the last thing you watched, through the same
  code the webhook uses, so what arrives is what a real one looks like. It falls
  back to the plain message only when there is no history to build from.

## 2.6.2

### Added

- **Mute a show you don't watch.** A binge of a 100-episode sitcom used to mean 100
  notifications. Muting is a switch in the Watch together dialog, a button on the
  notification itself where the platform supports one, and a list under Settings →
  Notifications to undo it. A mute covers the show whoever plays it, and lasts
  until you turn it back on.

### Changed

- **One notification per show, not per episode.** Notifications were deduplicated
  by episode, and every episode is a new episode — so the 30-minute window never
  applied to a binge. They are now deduplicated by show over six hours, and each
  new episode pushes that window back, so a run of episodes stays quiet. The
  lock-screen entry is also replaced rather than stacked.
- **Clearer notification wording.** The title now carries what is playing
  ("Severance — S2·E4 · Woe's Hollow") and the body who started it ("Started by
  alice · Watch together →"). iOS already prints the app name above the title, so
  the username was taking space it did not need, and the action now uses the same
  name as the button it opens.

### Fixed

- **Tapping a notification no longer opens an empty dialog** for a title you had
  already shared. The dialog fills itself in from the shared titles and pending
  watches, but a notification opened it before those had loaded — so nobody
  appeared selected, and saving from that state removed everyone from the share.
  It now waits for its data.

## 2.6.1

### Fixed

- **The Android status-bar notification icon was a blank white square.** Android
  paints only the alpha channel of that icon and discards the colours, so the app
  icon — whose S is white paint on a solid shape — arrived as the shape alone. It
  now uses a dedicated icon whose transparency *is* the letter.
- **You no longer have to tick yourself** in the notification list. Your own
  playback always notifies you, which is the point when you want to count a film
  for whoever is sitting with you, and your account is no longer offered as
  something to choose.
- **The webhook now says when it is unauthenticated.** It previously showed a
  green "active" badge whenever a notifier existed, even with no secret set — the
  badge only ever checked that a notifier of the right name was there.

### Changed

- Notification settings read more quietly: one shape per row, with colour kept
  for the switch, a selected name, and a device that is actually failing. A
  device row now shows which one you are using, and when delivery is failing it
  says so in place of the delivery time — so a device that silently stops
  working is visible without digging through logs.

## 2.6.0

### Added

- **Installable on a phone.** The bridge now ships a web app manifest, so it can
  be added to an iPhone or Android home screen and launches standalone, without
  browser chrome. Requires an HTTPS origin — a plain-http LAN address cannot be
  installed.
- New app icon: a violet-to-fuchsia gradient mark matching the sidebar badge,
  including a maskable variant so Android does not crop the corners. The favicon
  is the same mark, replacing a 27KB embedded raster with real vector.
- A service worker, deliberately with no caching, so the app is installable and
  push notifications have somewhere to attach.
- **Push notifications when someone starts watching.** Tap one and you land on the
  Dashboard with that session's Watch-together dialog already open, so you can count
  the watch for a co-watcher while it is still playing — which previously only worked
  if you happened to have the Dashboard open. Pick whose playback notifies you in
  Settings; nobody is selected until you say so. It works for household members who
  have no seenr account of their own, since a watch can be counted for someone else
  regardless. Needs the **Play** trigger on the webhook, an HTTPS origin, and on
  iPhone or iPad the app added to the Home Screen first — Settings says which of
  those is missing rather than offering a button that cannot work.
- **The Tautulli webhook can now authenticate.** Syncing the notifier generates a
  secret and writes it into Tautulli's headers, after which the endpoint rejects
  anything without it. This matters if you expose the bridge publicly: until now
  anyone who found the URL could post forged scrobbles. Existing installs are
  unaffected until they re-sync, so upgrading cannot break your scrobbling.

### Fixed

- The layout now respects display cut-outs. Content no longer sits under the
  status bar or the home indicator when launched from the home screen.
- A stray fragment of a source comment no longer renders as text above the Now
  playing card on the Dashboard.
- **The `Play` webhook trigger was unsafe and is now the notification trigger.**
  Enabling it previously forwarded a `media.play` to seenr, consumed the queued
  Watch-together entries at play time instead of when the watch finished, and marked
  co-watchers' Plex copies watched at 0% progress. `Play` now only raises a
  notification and never scrobbles. `Watched` remains the trigger that scrobbles;
  `Stop`, `Pause` and `Resume` are unchanged.

## 2.5.0

### Added

- **Now playing on the Dashboard.** While anyone is streaming, a card at the top shows what it is, who it already counts for and how far in — with a play, pause or buffering icon taken from Tautulli's own session state, and a progress bar along the card's bottom edge. It appears only while something plays, and it costs nothing when the page is closed: the Dashboard asks Tautulli for live sessions on the refresh it already runs, and nothing polls in the background.
- **Watch together.** Two people sit down together unplanned: open the dialog from the card, tick who is watching with you, and the watch is counted for them when it finishes — at the same moment it counts for whoever pressed play. It works even when the person playing is not one of your mapped users at all, which a share could never cover.
- **For an episode you choose how far it goes** — just this episode, or the whole show from now on, which shares it so every future episode fans out too. A film always creates a share, since a film is watched once and the share is the version you can see and edit afterwards on the Shared page.
- **"Also mark watched in Plex" is asked per action**, in the same dialog, and applies to the one-off itself rather than being inherited from whatever the title's share happened to say. The card carries the gold Plex badge whenever a watch is going to write into someone's Plex.
- **The dialog is editable.** It opens showing the current arrangement — who it counts for, and the Plex answer — so unticking someone takes them back off, and clearing every box removes the title. Update stays disabled until something actually differs.

### Notes

- A one-off that never completes — the stream was abandoned — expires after 24 hours and sends nothing. One filed for a profile you then disable stays inert while it is disabled.
- Disabled profiles are not offered in the dialog, since nothing would ever be delivered to them, and a disabled profile already on a share is kept rather than dropped by a save from here.
- With a one-off pending, a watch by an **unmapped** user can now produce a Dashboard row — a metadata failure or a library skip for that watch is recorded under their Tautulli username. Previously such watches were dropped silently, so these are names that have not appeared on the Dashboard before.
- The animated state icon respects "reduce motion": it stops animating and the shape and colour carry the state on their own.

### Changed

- Rows on the Dashboard and the Shared page now have equal padding on all four sides. They inherited `px-3 py-2` from the button they are built on, so every poster sat further from the left border than from the top.

## 2.4.1

### Changed

- **A delivered watch now reads "synced", not "checked in".** The master switch is called Syncing and a declined watch says "Syncing is disabled in settings", so the success state is now the past tense of that same verb — `synced`, `synced · 2`, `1 of 2 synced`. "Checked in" also only ever described the seenr half, while Syncing gates the Plex write too.
- **Dashboard rows carry less.** The media type and the matched id have moved into the row's own panel: the poster already says whether it is a film, the matched id was only ever the tmdb one of the ids the panel lists in full, and as a badge the type took the same violet as the recipient badges beside it. The type now sits on the panel's detail line next to the rating_key.
- **The reason a watch did not sync is now one banner at the top of that panel**, rather than repeated under each recipient. A fan-out that hit a single disabled setting used to print the identical sentence once per person, each below a payload dump; recipients are named only when they actually disagree. The banner is neutral for a decline, red for a lost forward, and amber when every recipient synced but a Plex write failed — that last case previously showed red, which overstated it.
- **The Shared page rows are reorganised.** The kind and the library now read as one dimmed line — `movie · Movies` — instead of a coloured badge sitting above a separate line of text: as a badge, `show` took the same violet as the profile names directly underneath it and read like one of them. The gold Plex badge moves into its own column on the right, so it appears in the same place on every row rather than trailing titles of different lengths. That leaves two kinds of badge in a row, gold for Plex and violet for people, instead of three families across three lines.

### Fixed

- **A watch the bridge was told not to forward is no longer reported as a failure.** With Syncing switched off — or a library left unticked — every watch was filed as a red "failed" row with a red panel quoting the setting back at you, so a deliberately paused bridge looked broken and its failure count climbed with nothing to fix. Those watches now read **skipped** in neutral grey, and are counted apart from failures. Anything the bridge actually attempted and lost — a seenr error, an unreachable Tautulli — stays a failure, unchanged.
- Rows recorded before this release are reclassified on upgrade, so the history reads correctly too rather than only new watches. Only the exact messages the bridge itself wrote for those two cases are matched; an older row that cannot be identified stays a failure rather than being quietly cleared.

## 2.4.0

### Added

- **Sign in with Plex.** The login page now offers Plex sign-in to whoever **owns** the Plex server the bridge watches — the same test Tautulli uses for its own admin sign-in. There is nothing to link and nothing to configure: if you own the server, you are the operator. A user you have merely *shared* the server with is refused, since access is not ownership.
- On a **brand-new install** Plex sign-in also creates the account, named after your Plex username and with no password. Set one later from the account menu if you want a second way in, or never — password sign-in stays closed until you do, so a passwordless account is not a way in.
- Your password keeps working throughout, so a plex.tv outage can never lock you out. For the same reason the login page hides the Plex button when the bridge has no Tautulli connection yet: without it there is no server whose owner could be checked.

### Changed

- The Setup header now reports all three connections at a glance — Tautulli, its event webhook and Plex — as pills whose dot carries the state, alongside the mapped-user count. Plex was absent from that row before, so whether the bridge could write to Plex at all was only visible after scrolling down to step 3. An unlinked Plex reads grey rather than red, since that step is optional, and amber means linked but some mapped users have no access, so their watches would not land.

### Fixed

- Two mobile layouts on the Settings page. The Syncing switch now stays on the first line beside the heading, with the status pills on their own row underneath, instead of being pushed to the end of a crowded second line. And on the connected-Plex card the Reconnect and Disconnect buttons wrap to their own row rather than squeezing the account, server address and sign-in note into a third of the card's width.

## 2.3.1

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
