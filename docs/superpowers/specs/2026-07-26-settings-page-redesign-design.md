# Redesigning the Settings page

Status: approved design, not yet implemented.
Branch at time of writing: `feat/nuxt-conversion`.

## Goal

`app/pages/settings.vue` works but reads as messy: fields don't line up, three different card
idioms share one page, and the same kind of control (a collapsible) appears at three different
nesting depths. This redesign makes the page one coherent system without dropping any feature.

Three concrete defects drove it:

- An invisible `&nbsp;` spacer div exists purely to push the "Add" button down to input level
  (`settings.vue:296`). It is a symptom: the grid is `sm:items-start`, and some cells carry `help`
  text while others don't, so rows come out ragged and the button has to be shimmed by hand.
- Numbered `SetupStep` cards, bare `UCard`s whose header is a ghost button, and a collapsible nested
  *inside* step 3 while two siblings sit at page level.
- The `Test a scrobble` panel: a solid rose "Send to seenr for real" button that is the loudest
  pixel on the page, a dense paragraph that re-names both buttons in bold directly above them, and
  `rating_key` as a bare number field.

## Constraints and decisions

- **No new dependencies.** Everything is Nuxt UI v4 components already in use plus Tailwind classes.
- **No feature is removed.** Every control on today's page survives, including the raw `rating_key`
  input.
- **Vertical rhythm matches the rest of the app**: `space-y-6`, as Dashboard uses. Settings uses
  `space-y-4` today.
- **`min-h-11` (44px) stays the floor** for every interactive control, as it is today.
- **Mobile is a first-class target**, not a fallback. Every layout below is specified at both
  `lg:`+ and ~390px.
- Approved via visual mockups in `.superpowers/brainstorm/` (gitignored). Six decisions were made;
  each is recorded below with its rejected alternatives, so the reasoning survives.

## Page structure

Three numbered steps collapse to **two**, mirroring the domain: the bridge only ever talks to
Tautulli (the source) and to seenr (per-user destinations).

```
Setup                        [Forwarding ●] ● connected · 2 users · webhook active

┌─ (1) Tautulli ──────────────────────────────────────────────┐
│  CONNECTION                                    ● connected  │
│  [ Tautulli URL          ]  [ API key          ]            │
│  URL e.g. http://tautulli:8181 · key from Tautulli →        │
│  Settings → Web Interface                                   │
│                          [ Test connection ]  [ Save ]      │
│  ─────────────────────────────────────────────────────────  │
│  EVENT WEBHOOK                                    ● active  │
│  One webhook in Tautulli covers every user.                 │
│  [✓ Watched] [Play] [Stop] [Pause] [Resume]                 │
│                              [ Sync to Tautulli ]           │
│  › Set it up manually instead                               │
└─────────────────────────────────────────────────────────────┘

┌─ (2) seenr users ───────────────────────────────────────────┐
│  alice    9%7C…f21c · TV + Movies              [Configure]  │
│  bob      9%7C…88ae · TV only                  [Configure]  │
│  ─────────────────────────────────────────────────────────  │
│  [ Plex username ]  [ seenr token        ]      [ ＋ Add ]   │
│  Token is the part after /scrobble/plex/ in your seenr URL. │
└─────────────────────────────────────────────────────────────┘

──────────────────────────── MORE ────────────────────────────
› Advanced                     forwarding · seenr URL · bridge URL
› Test a scrobble              run one item through the pipeline
```

### Card titles and hints

Set explicitly, since these are the page's only prose headings:

| | Title | Hint |
|---|---|---|
| 1 | `Tautulli` | the source — where playback happens and episode IDs come from |
| 2 | `seenr users` | each Plex user → their seenr token |

Sub-section labels inside step 1 are `Connection` and `Event webhook`. The page's own heading stays
`Setup`, and `TITLES` in `app/layouts/default.vue` keeps mapping `/settings` → `Settings` for the
mobile top bar.

### Why the merge is safe

`syncSeenrWebhook` cannot run before credentials are saved — it calls the Tautulli API with that key.
Splitting connection and webhook across two numbered steps hid a dependency that is now visible:
they are two jobs of one system, in one card, in causal order.

### The two-jobs-one-card problem

Merging gives the card two primary actions — *save credentials* and *sync the webhook*. Two solid
violet buttons in one card is ambiguous. Resolution: **two labelled sub-sections, each ending in its
own right-aligned action row above a seam**, each carrying its own live status pill. The button that
follows a section acts on that section.

Rejected: a single combined `Save & sync` button (fewest decisions and it fixes a real trap — today
you can save credentials, never sync, and nothing tells you — but the button does more than its
name says, and it needs the two API calls to report as one outcome); and sub-sections that
auto-collapse once healthy (a configured bridge's page becomes tiny, but open state would then
depend on live status, so a flapping connection could collapse a section mid-typing).

### Where the collapsibles live

`Set it up manually instead` stays **inside** the Tautulli card; `Advanced` and `Test a scrobble`
move to a page-level `More` group.

This looks like the nesting inconsistency the redesign set out to fix, so the distinction is
deliberate and must be visible in the styling: manual setup is *an alternative way to accomplish the
adjacent action*, so it renders as an **inline disclosure with no card chrome of its own**, inside
the card, directly under the Sync button it replaces. `Advanced` and `Test` are *page-level
concerns*, so they render as **full cards** under a `More` divider. Two visibly different kinds of
thing, rather than one control at three arbitrary depths.

## Alignment: fixing the cause, not the symptom

The ragged rows and the spacer div both come from per-field `help` text making some grid cells taller
than their siblings. The fix is structural:

- **Help text moves from per-field to one line under the field group.** No cell is taller than its
  neighbour, so the grid can align on `items-end` and the bare `Add` / `＋ Add` button sits level
  with the inputs with no shim. The `&nbsp;` spacer div is deleted, and nothing replaces it.
  - Accepted cost: each hint is decoupled from its specific input. Mitigated by naming the field in
    the hint ("Token is the part after …", "URL e.g. …").
- **The `must have a seenr token mapped above` hint under *username* in the test panel moves out of
  the row** — that lone help line is the visible cause of the misalignment in that panel.
- Grids become `sm:items-end`, replacing today's `sm:items-start` workaround and its two explanatory
  comments.

## Trigger selection

The five trigger checkboxes become **toggle chips**. Today the `recommended` badge is passed as
`#description` to the Watched `UCheckbox`, which makes that one row taller than its four siblings and
ragged in a flex row.

- The badge folds into the chip's **selected state**; "Watched is recommended" moves to the
  sub-section's group help line.
- Accessibility is not optional here: chips are `<button type="button">` with `aria-pressed`, not
  styled divs, and keep the `min-h-11` target. The existing `toggleTrigger(key, checked)` /
  `isTriggerSelected(key)` pair already models the array membership correctly and is reused as-is —
  only the rendering changes.

## Global forwarding switch

`settings.forward_enabled` is the master kill switch for all forwarding and is currently buried
inside the `Advanced` collapsible. It moves to the **page header**, beside the status line, as a
labelled `USwitch`.

- It is **removed from Advanced** — one value, one control, no drift.
- Because it no longer sits next to `saveAdvanced()`'s Save button, toggling it must **persist
  immediately**: `store.save({ forward_enabled })` on change, with a toast. `saveAdvanced()` drops
  `forward_enabled` from its payload and keeps `seenr_base_url` + `bridge_url`.

## Step 2: the ordering hint

With the webhook now in step 1, a first-run user configures forwarding *before* mapping anyone, so
early events land as `skipped`. Rather than reorder the steps (the causal dependency runs the other
way), step 2 carries a one-line hint that events arriving before a user is mapped are recorded as
skipped and visible on the Dashboard.

## Test a scrobble

### Buttons

- **Preview** becomes the solid violet primary. It is the safe, common action, and today it is the
  one styled as an afterthought (`variant="outline"`).
- **Send for real** drops from solid rose to `color="error" variant="subtle"` — rose text on a faint
  rose tint. Still unmistakably the destructive half, no longer the loudest pixel on the page. This
  uses a variant `app.config.ts` already defines; no new styling.

Rejected: one button plus an arming switch (impossible to mis-click, but one control would mean two
things and the button wouldn't say which); and both buttons outlined (quietest, but the panel would
have no primary action, reading as unfinished next to every other card).

### Copy

Today:

> Runs a `rating_key` through the same pipeline as a real Tautulli webhook — useful for checking id
> matching without waiting for playback.
>
> **Preview** only builds the payload — nothing is sent and nothing is recorded. **Send to seenr for
> real** actually forwards it to this user's seenr account and writes an event row.

Replacement:

> Sends one item down the same path a Tautulli webhook takes — good for checking ID matching without
> waiting for playback.
>
> Preview builds the payload only.
> Send forwards to `<selected user>` and records an event.

Two fixes beyond length: the second paragraph stops **re-naming the buttons in bold** (it sits
directly above them, so bolded labels read as two more controls), and it names the **actual selected
user** instead of "this user's seenr account".

### The item picker

`rating_key` as a bare number field becomes a picker sourced from the Tautulli library, with a
segmented control (`UFieldGroup` — **not** `UButtonGroup`, which no longer exists in Nuxt UI v4):

| Mode | Controls | Yields |
|---|---|---|
| **TV** | Show select → Season select → Episode select | the **episode's** own `rating_key` |
| **Movies** | Movie select | the movie's own `rating_key` |
| **Paste key** | the existing free-text input | whatever is typed |

**This is the whole reason the drill-down exists.** `getLibraryItems({ type: 'show' })` returns a
**show's** `rating_key` — precisely the wrong key, and the exact Tautulli defect this bridge was
built to work around ([Tautulli #2510](https://github.com/Tautulli/Tautulli/issues/2510)). A picker
that listed "The Bear" and fed that key to the test would always look broken, or worse, silently
check in the wrong thing. Movies are unaffected: their key is the item's own.

`Paste key` is retained deliberately, not as a leftover — debugging a specific key someone reported
is a main reason to open this panel, and removing the field would be a regression.

The selected item resolves to a visible `rating_key` below the row (`→ rating_key 25419`), so the
picker never hides what is actually being sent.

Rejected: sourcing the list from `get_history` recent plays. It is one API call, returns episode-level
keys by construction, and would also auto-fill the User field — genuinely attractive, and worth
revisiting as an extra tab later. It was rejected because it can only reach items someone has already
played, and library browse reaches everything.

## Server work

Only the picker needs backend support. Everything else is front-end.

### `server/utils/tautulli.ts`

Add `getChildren(url, apiKey, ratingKey)` wrapping Tautulli's `get_children_metadata`, used twice:
show → seasons, then season → episodes.

- Follows the existing `tautulliApi<T>()` helper and the file's **explicit relative imports** — this
  file must never use Nitro auto-imports, because all four spec files import `server/utils` modules
  directly.
- **Verify the response shape against a live Tautulli before relying on it.** The expectation is
  `response.data.children_list[]` with `rating_key`, `title`, `media_index`, `parent_media_index`,
  `media_type`, `thumb`. This is the one unverified assumption in this design; treat a mismatch as
  expected work, not a surprise.
- Check the new export name does not collide with an h3/Nitro auto-import before committing to it —
  `npm run typecheck` surfaces collisions as `WARN Duplicated imports`. `getChildren` is believed
  clear.

### `server/api/tautulli/children.get.ts`

New authed endpoint, `?rating_key=…`, mirroring `library.get.ts` exactly: read settings, return
`{ ok: false, items: [] }` when Tautulli isn't configured, catch and return `{ ok: false, error }`
rather than throwing. Being authed, it needs **no** change to `PUBLIC_API_PATHS`.

### `shared/types/index.ts`

Add the wire type for a child row. `LibraryItem` is not reused because its required `year` is
meaningless for an episode:

```ts
export interface LibraryChild {
  rating_key: string
  title: string
  index: string        // season or episode number
  media_type: string   // 'season' | 'episode'
  image: string
}
```

## Component decomposition

`settings.vue` is 540 lines today and this redesign would grow it. Three extractions keep it
manageable, and two of them remove existing duplication:

| Component | Why |
|---|---|
| `app/components/DisclosureCard.vue` | The collapsible-card idiom (ghost-button header, rotating chevron, `p-0` body, right-aligned summary) is **duplicated three times inline** in `settings.vue` today. Extract once, use for Advanced and Test. |
| `app/components/SetupSubsection.vue` | Uppercase label + optional status pill + slot + optional seam. Used twice inside step 1. New idiom, so it gets one definition. |
| `app/components/ItemPicker.vue` | The TV/Movies/Paste-key picker with its chained selects and loading states. Self-contained: `v-model` is a `rating_key` string, and it owns its own fetches. Non-trivial enough that inlining it would dominate the page file. |

`SetupStep.vue` needs no change beyond continuing to accept `n`, `title`, `hint`.

Trigger chips stay inline in `settings.vue` — small, and used once.

**Manual setup deliberately does not use `DisclosureCard`.** It is a bare `UCollapsible` inline
inside step 1's body — chevron, label, and a seam above its content, with no card background, ring,
or radius of its own. That is the styling difference that makes it read as part of the Sync action
rather than as a third page-level card. Its four `CopyField` rows are unchanged.

## Error handling

Unchanged in kind: every action already funnels through `apiErrorMessage(e, fallback)` into a toast,
and that stays. Additions:

- `ItemPicker` fetch failures degrade to the **Paste key** mode with an inline note, rather than
  leaving an empty select with no explanation. A failed picker must never block the panel, because
  the raw field can still do the job.
- Each sub-section's status pill reflects existing `status` store state; neither pill introduces a
  new polling path.

## Testing

There is no linter in this repo — `npm run typecheck` is the only static check and Vitest is the only
runner.

- `npm test` — the 38 existing tests must stay green. This redesign touches no `server/utils` logic
  that they cover except adding one new function to `tautulli.ts`.
- **No unit test for `getChildren`.** `tautulli.ts` has no test coverage today because every function
  in it makes a live network call, and this design does not introduce a mocking layer to change that.
  Stated plainly rather than implied: the picker's correctness rests on manual verification against a
  real Tautulli.
- `npm run typecheck` — must be clean, and watch for `WARN Duplicated imports`.
- **Grep `.nuxt/components.d.ts` for every component used for the first time**, `UFieldGroup`
  especially. A misspelled Nuxt UI component name passes both `typecheck` and `build`, then renders
  nothing — this exact trap already cost the Shared page an invisible segmented control.
- **Verify a production build, not just `nuxt dev`.** No new page routes are added, so
  `nitro.prerender.routes` needs no change — but confirm the built `/settings` HTML still contains
  `<script ... src="/_nuxt/`. An HTTP check cannot catch this failure: a blank SPA shell returns 200.
- Manual pass at ~390px and at `lg:`+ for both cards, both sub-sections, all three picker modes, and
  the button stacking order.

## Mobile specifics

- Field grids collapse to one column; the group-level help line sits under the group in both layouts.
- Action rows stack **primary-first** — `Save` above `Test connection`, `Preview` above
  `Send for real`. The bottom-most control is the easiest thumb reach, and today's order puts the
  secondary action there.
- Mapped-user rows stack: username and `Configure` on the first line, token + sync summary beneath.
- Trigger chips wrap; they are already sized for touch.
- The `More` divider and its two cards are unchanged in structure across breakpoints.

## Out of scope

- `settings.sync_movies` / `settings.sync_episodes` are vestigial — persisted and served, but the
  pipeline gates only on the per-mapping flags. Not touched here; deleting them is a separate change.
- The `Configure <user>` modal keeps its current layout.
- Dashboard and Shared pages are untouched.
- Adding a `get_history` "Recent plays" tab to the picker — a deliberate follow-up, not part of this
  work.
- `shared/version.ts` bump and README badge: release-time concerns, not part of the redesign.
