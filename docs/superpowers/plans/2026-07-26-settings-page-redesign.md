# Settings Page Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild `app/pages/settings.vue` as two numbered steps with aligned field grids, a calmer Test panel, and a library-browse item picker that resolves to episode-level `rating_key`s.

**Architecture:** Front-end-heavy. One new server util (`getChildren`) plus one new authed endpoint back the picker; everything else is Vue. Three components are extracted from `settings.vue` — two of them de-duplicate markup that exists three times today. The alignment fix is structural: help text moves from per-field to group-level, which lets grids align on `items-end` and deletes the `&nbsp;` spacer shim outright.

**Tech Stack:** Nuxt 4 (SPA, `ssr: false`), Nuxt UI v4, Pinia, Nitro, Vitest, better-sqlite3.

**Spec:** `docs/superpowers/specs/2026-07-26-settings-page-redesign-design.md`

## Global Constraints

- **No new dependencies.** Nuxt UI v4 components already in the project plus Tailwind classes only.
- **No feature is removed**, including the raw `rating_key` text input (it becomes the "Paste key" mode).
- **`min-h-11` (44px) is the floor** for every interactive control, matching the current page.
- **Page rhythm is `space-y-6`**, replacing today's `space-y-4`, to match `app/pages/dashboard.vue`.
- **`server/utils/*` must use explicit relative imports, never Nitro auto-imports.** `server/api/*` deliberately DOES use auto-imports (`defineEventHandler`, `getQuery`, `createError` are global there). Mixing styles inside `server/utils/` breaks the spec suite, which imports those modules directly.
- **Before using any Nuxt UI component for the first time, grep `.nuxt/components.d.ts` for it.** A misspelled component name passes both `typecheck` and `build`, then renders nothing. Verified present for this work: `UFieldGroup`, `UCollapsible`, `USwitch`, `USelectMenu`, `UFormField`. **`UButtonGroup` does not exist in v4 — use `UFieldGroup`.**
- **There is no linter.** `npm run typecheck` is the only static check; Vitest is the only runner.
- **Every commit message ends with this trailer**, exactly:
  `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`
- **`/settings` is already in `nitro.prerender.routes`** (`nuxt.config.ts:39`) and no new page routes are added, so that config needs no change.
- **New endpoints under `/api/` are authed by default.** `/api/tautulli/children` must NOT be added to `PUBLIC_API_PATHS`.

### Note on test coverage, read before Task 1

The spec stated there would be no unit test for `getChildren`. **This plan adds one anyway** — a deliberate improvement, not a deviation to reverse. Reasons: the `children_list` response shape is the spec's single flagged unverified assumption, a parse test pins it exactly, and `tests/pipeline.spec.ts` already establishes mocking in this suite. The test stubs `global.fetch`; it does not reach a real Tautulli.

The Vue tasks (3–7) have **no automated tests**, because this repo has no component test harness — the four existing spec files test `server/utils` and pure functions only, using plain Vitest rather than Nuxt's test utils. Do **not** introduce `@nuxt/test-utils` to satisfy a TDD instinct; that is a separate decision with its own dependency cost. Those tasks verify via `npm run typecheck`, a component-name grep, and a described manual pass. This is stated plainly so the gap is visible rather than implied.

---

### Task 1: `getChildren` util and `LibraryChild` wire type

**Files:**
- Modify: `shared/types/index.ts` (append after `LibraryItem`, currently ends line 113)
- Modify: `server/utils/tautulli.ts` (add interfaces near the other row interfaces ~line 56; add the exported function after `getLibraryItems`, which ends line 215)
- Create: `tests/tautulli.spec.ts`

**Interfaces:**
- Consumes: the existing private `tautulliApi<T>(url, apiKey, cmd, params)` helper in `server/utils/tautulli.ts:86`.
- Produces:
  - `LibraryChild` — `{ rating_key: string; title: string; index: string; media_type: string; image: string }`
  - `getChildren(url: string, apiKey: string, ratingKey: string): Promise<LibraryChild[]>`

`LibraryItem` is deliberately not reused: its required `year` is meaningless for an episode.

- [ ] **Step 1: Add the wire type**

Append to `shared/types/index.ts`, after the `LibraryItem` interface:

```ts
// One level below a title: a show's seasons, or a season's episodes. `index` is
// the season or episode number. Unlike LibraryItem there is no `year` — it is
// meaningless for an episode, and rating_key here is the child's OWN key, which
// is the whole point of drilling down.
export interface LibraryChild {
  rating_key: string
  title: string
  index: string
  media_type: string // 'season' | 'episode'
  image: string
}
```

- [ ] **Step 2: Write the failing test**

Create `tests/tautulli.spec.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { getChildren } from '../server/utils/tautulli'

const fetchMock = vi.fn()

// Tautulli wraps every reply in the same envelope; only `data` varies by command.
function ok(data: unknown) {
  return { ok: true, json: async () => ({ response: { result: 'success', data } }) } as unknown as Response
}

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('getChildren', () => {
  it('maps children_list rows onto LibraryChild', async () => {
    fetchMock.mockResolvedValue(
      ok({
        children_count: '2',
        children_list: [
          {
            rating_key: 301,
            title: 'Season 1',
            media_index: 1,
            media_type: 'season',
            thumb: '/library/metadata/301/thumb/1',
          },
          { rating_key: 302, title: 'Season 2', media_index: 2, media_type: 'season' },
        ],
      }),
    )

    const out = await getChildren('http://tautulli:8181', 'key', '300')

    expect(out).toEqual([
      {
        rating_key: '301',
        title: 'Season 1',
        index: '1',
        media_type: 'season',
        image: '/library/metadata/301/thumb/1',
      },
      { rating_key: '302', title: 'Season 2', index: '2', media_type: 'season', image: '' },
    ])
  })

  it('coerces numeric rating_key and media_index to strings', async () => {
    fetchMock.mockResolvedValue(
      ok({ children_list: [{ rating_key: 25419, title: 'Children', media_index: 5, media_type: 'episode' }] }),
    )

    const [ep] = await getChildren('http://tautulli:8181', 'key', '3010')

    expect(ep).toEqual({
      rating_key: '25419',
      title: 'Children',
      index: '5',
      media_type: 'episode',
      image: '',
    })
  })

  it('returns [] when children_list is absent', async () => {
    fetchMock.mockResolvedValue(ok({ children_count: '0' }))
    await expect(getChildren('http://tautulli:8181', 'key', '300')).resolves.toEqual([])
  })

  it('drops rows with no usable rating_key', async () => {
    fetchMock.mockResolvedValue(
      ok({ children_list: [{ rating_key: '', title: 'ghost' }, { rating_key: '7', title: 'real' }] }),
    )

    const out = await getChildren('http://tautulli:8181', 'key', '300')

    expect(out.map((c) => c.rating_key)).toEqual(['7'])
  })

  it('throws with Tautulli’s message when the API reports failure', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ response: { result: 'error', message: 'Invalid rating_key' } }),
    } as unknown as Response)

    await expect(getChildren('http://tautulli:8181', 'key', 'nope')).rejects.toThrow('Invalid rating_key')
  })

  it('sends the rating_key as get_children_metadata', async () => {
    fetchMock.mockResolvedValue(ok({ children_list: [] }))

    await getChildren('http://tautulli:8181/', 'k3y', '300')

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('http://tautulli:8181/api/v2')
    expect(String(init.body)).toContain('cmd=get_children_metadata')
    expect(String(init.body)).toContain('rating_key=300')
  })
})
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npm test -- tests/tautulli.spec.ts`
Expected: FAIL — `getChildren` is not exported from `server/utils/tautulli`.

- [ ] **Step 4: Implement `getChildren`**

Add these interfaces to `server/utils/tautulli.ts`, alongside the other row interfaces (after `TautulliHistoryData`, ~line 66):

```ts
// get_children_metadata returns a show's seasons or a season's episodes through
// the same command — the level is decided purely by the rating_key passed in.
interface TautulliChildRow {
  rating_key: string | number
  title?: string
  media_index?: string | number | null
  media_type?: string
  thumb?: string
}

interface TautulliChildrenData {
  children_count?: string | number
  children_list?: TautulliChildRow[]
}
```

Add the import for the new type to the existing type import on line 4:

```ts
import type { TautulliMetadata, LibraryItem, LibraryChild } from '../../shared/types'
```

Then append the function after `getLibraryItems`:

```ts
// One level below a title. Called twice by the test-scrobble picker: show →
// seasons, then season → episodes. The episode's own rating_key is what the
// caller needs — a show's key is exactly the wrong thing to scrobble, which is
// the Tautulli defect this whole bridge exists to work around.
export async function getChildren(url: string, apiKey: string, ratingKey: string): Promise<LibraryChild[]> {
  const data = await tautulliApi<TautulliChildrenData>(url, apiKey, 'get_children_metadata', {
    rating_key: ratingKey,
  })
  const rows = Array.isArray(data?.children_list) ? data.children_list : []
  return rows
    .filter((r) => r.rating_key != null && String(r.rating_key) !== '')
    .map((r) => ({
      rating_key: String(r.rating_key),
      title: r.title || '',
      index: r.media_index != null ? String(r.media_index) : '',
      media_type: r.media_type || '',
      image: r.thumb || '',
    }))
}
```

Note: the util does not filter by `media_type`. Callers filter, so one function serves both levels.

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm test -- tests/tautulli.spec.ts`
Expected: PASS, 6 tests.

- [ ] **Step 6: Run the full suite and typecheck**

Run: `npm test`
Expected: PASS — 55 tests across 5 files (49 existing + 6 new). The baseline was measured at
`2e775fb`: 49 tests across 4 files. (`CLAUDE.md` claims 38 — it is stale; trust the measured number.)

Run: `npm run typecheck`
Expected: clean. Specifically confirm there is **no** `WARN Duplicated imports` mentioning `getChildren` — that would mean the name collides with an h3/Nitro auto-import and needs renaming.

- [ ] **Step 7: Commit**

```bash
git add shared/types/index.ts server/utils/tautulli.ts tests/tautulli.spec.ts
git commit -m "feat: add getChildren for season and episode drill-down" -m "Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: `/api/tautulli/children` endpoint

**Files:**
- Create: `server/api/tautulli/children.get.ts`

**Interfaces:**
- Consumes: `getChildren` and `LibraryChild` from Task 1; `getSettings` from `server/utils/db`.
- Produces: `GET /api/tautulli/children?rating_key=<key>` → `{ ok: boolean; items: LibraryChild[]; error?: string }`

This mirrors `server/api/tautulli/library.get.ts` exactly — same settings guard, same never-throw contract. Task 7's `ItemPicker` depends on this response shape.

There is **no automated test for this file.** It uses Nitro auto-imports (`defineEventHandler`, `getQuery`), which plain Vitest cannot resolve — that is the documented asymmetry in `CLAUDE.md`, not an oversight. Verification is typecheck plus a manual request.

- [ ] **Step 1: Create the endpoint**

Create `server/api/tautulli/children.get.ts`:

```ts
import { getSettings } from '../../utils/db'
import { getChildren } from '../../utils/tautulli'
import type { LibraryChild } from '../../../shared/types'

export default defineEventHandler(async (event) => {
  const s = getSettings()
  if (!s.tautulli_url || !s.tautulli_apikey) return { ok: false, items: [] as LibraryChild[] }

  const q = getQuery(event)
  const ratingKey = typeof q.rating_key === 'string' ? q.rating_key.trim() : ''
  if (!ratingKey) return { ok: false, items: [] as LibraryChild[], error: 'rating_key is required' }

  try {
    return { ok: true, items: await getChildren(s.tautulli_url, s.tautulli_apikey, ratingKey) }
  } catch (e: unknown) {
    return { ok: false, items: [] as LibraryChild[], error: e instanceof Error ? e.message : String(e) }
  }
})
```

Returning `{ ok: false }` rather than throwing is deliberate and matches `library.get.ts`: the picker degrades to Paste-key mode on failure, and a thrown 500 would give it nothing to degrade with.

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: clean.

- [ ] **Step 3: Verify the route resolves and is authed**

Run: `npm run dev`, then in a second shell:

```bash
curl -s -o /dev/null -w '%{http_code}\n' 'http://localhost:8687/api/tautulli/children?rating_key=1'
```

Expected: `401`. An authed endpoint rejecting an unauthenticated caller is the correct result, and it also proves the route exists — a missing route would 404 via `server/api/[...].ts`.

- [ ] **Step 4: Verify the happy path against a real Tautulli**

Log into the UI in a browser so the session cookie is set, then visit:

`http://localhost:8687/api/tautulli/children?rating_key=<a real show rating_key>`

Expected: `{"ok":true,"items":[...]}` with one entry per season, each having a non-empty `rating_key`, an `index`, and `media_type: "season"`.

**This is the plan's one unverified assumption.** If `items` comes back empty while the show plainly has seasons, the response field names differ from `children_list` / `media_index` / `media_type`. Inspect the raw Tautulli reply and adjust `TautulliChildRow` plus the mapping in Task 1, then update the fixtures in `tests/tautulli.spec.ts` to match reality. Treat this as expected work, not a surprise.

- [ ] **Step 5: Commit**

```bash
git add server/api/tautulli/children.get.ts
git commit -m "feat: add /api/tautulli/children endpoint" -m "Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Extract `DisclosureCard` (pure refactor)

**Files:**
- Create: `app/components/DisclosureCard.vue`
- Modify: `app/pages/settings.vue` — replace the Advanced block (lines 351–386) and the Test-a-scrobble block (lines 388–503) wrappers

**Interfaces:**
- Produces: `<DisclosureCard v-model:open="…" title="…" summary="…">` with a default slot for the body. Tasks 4, 6 and 7 rely on this component existing.

The collapsible-card markup — `UCard` with `p-0` body, ghost-button header, rotating chevron, right-aligned `sm:`-only summary — is **duplicated three times** in `settings.vue` today. This task extracts it and converts the two page-level uses, changing **no behaviour and no visual output**. Doing it before the structural work keeps Task 4's diff readable.

The third copy (manual setup, lines 325–348) is intentionally left alone — Task 4 replaces it with a chrome-less inline disclosure, which is a different thing on purpose.

- [ ] **Step 1: Create the component**

Create `app/components/DisclosureCard.vue`, transcribing the existing markup:

```vue
<script setup lang="ts">
// The page-level collapsible idiom: a card whose header IS the toggle. Extracted
// from three inline copies in settings.vue. Manual setup deliberately does not
// use this — it renders chrome-less inside step 1 so it reads as part of the
// adjacent Sync action rather than as another page-level section.
const open = defineModel<boolean>('open', { default: false })

defineProps<{ title: string; summary?: string }>()
</script>

<template>
  <UCard :ui="{ body: 'p-0 sm:p-0' }">
    <UCollapsible v-model:open="open">
      <UButton color="neutral" variant="ghost" class="w-full min-h-11 gap-2.5 px-5 py-3.5">
        <UIcon
          name="i-lucide-chevron-right"
          class="size-4 shrink-0 text-muted transition-transform"
          :class="open ? 'rotate-90' : ''"
        />
        <span class="text-sm font-semibold text-highlighted">{{ title }}</span>
        <span v-if="summary" class="ml-auto hidden text-xs text-dimmed sm:block">{{ summary }}</span>
      </UButton>
      <template #content>
        <div class="space-y-4 border-t border-default p-5">
          <slot />
        </div>
      </template>
    </UCollapsible>
  </UCard>
</template>
```

- [ ] **Step 2: Confirm the component is registered**

Run: `npm run dev` once so Nuxt regenerates its component manifest, then:

```bash
grep -c "DisclosureCard" .nuxt/components.d.ts
```

Expected: `1` or more. A `0` here means auto-import did not pick the file up, and every usage below would silently render nothing.

- [ ] **Step 3: Convert the Advanced block**

In `app/pages/settings.vue`, replace the whole `UCard`/`UCollapsible` wrapper for Advanced (lines 351–386) with:

```vue
    <DisclosureCard v-model:open="advanced" title="Advanced" summary="forwarding · seenr URL · bridge URL">
      <div class="flex items-center justify-between gap-3">
        <div class="min-w-0">
          <div class="text-sm font-medium">Forward to seenr</div>
          <p class="text-xs text-muted">Master switch for all forwarding.</p>
        </div>
        <USwitch v-model="store.settings.forward_enabled" />
      </div>
      <UFormField label="seenr base URL" help="each user's token is appended to this">
        <UInput v-model="store.settings.seenr_base_url" class="w-full" />
      </UFormField>
      <UFormField label="Bridge public URL" help="blank = auto-detect; set only behind a reverse proxy">
        <UInput v-model="store.settings.bridge_url" placeholder="https://bridge.example.com" class="w-full" />
      </UFormField>
      <UButton label="Save" class="min-h-11" @click="saveAdvanced" />
    </DisclosureCard>
```

The `space-y-4 border-t border-default p-5` wrapper div is gone because `DisclosureCard` supplies it. Task 6 removes the forwarding switch from this block.

- [ ] **Step 4: Convert the Test-a-scrobble block**

This one is a wrapper swap around a large body, so work outside-in rather than retyping the children.

Delete these four opening lines — the `UCard` (388), `UCollapsible` (389), the header `UButton` with its `UIcon`, title span and summary span (390–400), the `<template #content>` (401), and the `<div class="space-y-4 border-t border-default p-5">` (402) — and replace all of them with one line:

```vue
    <DisclosureCard v-model:open="testPanel" title="Test a scrobble" summary="send a rating_key through the pipeline">
```

Then delete the four matching closing lines at the bottom — `</div>`, `</template>`, `</UCollapsible>`, `</UCard>` (500–503) — and replace them with:

```vue
    </DisclosureCard>
```

Everything between stays **byte-identical**: the intro `<p class="text-xs text-muted">` (403–406) through the closing `</div>` of the `v-if="testResult"` block (499). The `space-y-4 border-t border-default p-5` wrapper is deleted because `DisclosureCard` supplies exactly those classes around its slot — that equivalence is why this is a no-op visually. Task 7 rewrites the contents.

The body is now indented one level too deep. Leave it — re-indenting here would bury Task 7's real diff in whitespace noise.

- [ ] **Step 5: Typecheck and verify no visual change**

Run: `npm run typecheck`
Expected: clean.

With `npm run dev` running, open `http://localhost:8687/settings` and confirm: both Advanced and Test a scrobble still expand and collapse, the chevron still rotates 90°, the summary text still appears at `sm`+ and hides below it, and the panels look **identical to before this task**. This is a refactor; any visible difference is a bug.

- [ ] **Step 6: Commit**

```bash
git add app/components/DisclosureCard.vue app/pages/settings.vue
git commit -m "refactor: extract DisclosureCard from three inline copies" -m "Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Merge steps 1 and 3 into one Tautulli card

**Files:**
- Create: `app/components/SetupSubsection.vue`
- Modify: `app/pages/settings.vue` — replace the step-1 `SetupStep` (lines 219–232) and the step-3 `SetupStep` (lines 302–349) with a single card; adjust `<script setup>`

**Interfaces:**
- Consumes: `SetupStep` (unchanged, still takes `n`, `title`, `hint`); `status` store (`status.tautulli`, `status.webhook`).
- Produces: `<SetupSubsection label="…" :status="…" status-text="…" :seam="true|false">` with a default slot.

This is the structural heart of the redesign. The merged card has two labelled sub-sections, each ending in its **own right-aligned action row above a seam**, each with its own status pill — that is what keeps two primary buttons in one card unambiguous.

- [ ] **Step 1: Create `SetupSubsection`**

Create `app/components/SetupSubsection.vue`:

```vue
<script setup lang="ts">
// A labelled job inside a SetupStep card. Step 1 holds two: Connection and
// Event webhook. Each carries its own status pill and ends in its own action
// row, which is what stops two primary buttons in one card from reading as
// ambiguous.
defineProps<{
  label: string
  status?: 'ok' | 'bad' | 'pending' | null
  statusText?: string
  seam?: boolean
}>()
</script>

<template>
  <div :class="seam ? 'border-t border-default pt-5' : ''">
    <div class="mb-3 flex flex-wrap items-center gap-2">
      <h3 class="text-xs font-semibold uppercase tracking-wider text-muted">{{ label }}</h3>
      <UBadge
        v-if="status && statusText"
        :color="status === 'ok' ? 'success' : status === 'bad' ? 'error' : 'neutral'"
        variant="subtle"
        size="sm"
        :label="statusText"
      />
    </div>
    <div class="space-y-4">
      <slot />
    </div>
  </div>
</template>
```

- [ ] **Step 2: Confirm registration**

```bash
grep -c "SetupSubsection" .nuxt/components.d.ts
```

Expected: `1` or more.

- [ ] **Step 3: Add the derived status and trigger-chip helpers to `<script setup>`**

In `app/pages/settings.vue`, add after the existing `syncSummary` function:

```ts
// Sub-section pills read the same polled status the header and sidebar use — no
// extra request path is introduced.
const connStatus = computed<'ok' | 'bad' | 'pending'>(() =>
  status.tautulli === null ? 'pending' : status.tautulli.ok ? 'ok' : 'bad',
)
const connStatusText = computed(() =>
  status.tautulli === null ? 'checking…' : status.tautulli.ok ? 'connected' : 'unreachable',
)
const hookStatus = computed<'ok' | 'bad'>(() => (status.webhook ? 'ok' : 'bad'))
const hookStatusText = computed(() => (status.webhook ? 'active' : 'not set up'))
```

Keep `TRIGGERS`, `selectedTriggers`, `isTriggerSelected` and `toggleTrigger` exactly as they are — the array-membership model is already correct and only the rendering changes. Update the comment above `toggleTrigger` since `UCheckbox` is no longer involved:

```ts
// Chips are aria-pressed buttons rather than checkboxes, so each derives its own
// pressed state from the array and toggles membership. A shared v-model across
// siblings would fight itself.
```

- [ ] **Step 4: Replace both `SetupStep` blocks with the merged card**

Delete the step-1 block (lines 219–232) and the step-3 block (lines 302–349) and put this single card where step 1 was:

```vue
    <SetupStep :n="1" title="Tautulli" hint="the source — where playback happens and episode IDs come from">
      <SetupSubsection label="Connection" :status="connStatus" :status-text="connStatusText">
        <div class="grid gap-4 sm:grid-cols-2 sm:items-end">
          <UFormField label="Tautulli URL">
            <UInput v-model="store.settings.tautulli_url" placeholder="http://tautulli:8181" class="w-full" />
          </UFormField>
          <UFormField label="API key">
            <UInput v-model="store.settings.tautulli_apikey" type="password" placeholder="xxxxxxxx" class="w-full" />
          </UFormField>
        </div>
        <!-- Group-level, not per-field: a `help` on one UFormField and not its
             sibling makes that grid cell taller and the row ragged. Keeping the
             hints here is what lets the grid align on items-end. -->
        <p class="text-xs text-dimmed">
          URL e.g. <code class="text-default">http://tautulli:8181</code> · key from Tautulli →
          Settings → Web Interface → API key
        </p>
        <div class="flex flex-col gap-3 border-t border-default pt-4 sm:flex-row sm:justify-end">
          <!-- Mobile stacks primary-first: the bottom-most control is the easiest
               thumb reach, so `order` puts Save there below sm. -->
          <UButton
            color="neutral"
            variant="subtle"
            label="Test connection"
            class="min-h-11 justify-center order-2 sm:order-1"
            @click="testConnection"
          />
          <UButton
            :loading="saving"
            label="Save"
            class="min-h-11 justify-center order-1 sm:order-2"
            @click="saveConnection"
          />
        </div>
      </SetupSubsection>

      <SetupSubsection label="Event webhook" :status="hookStatus" :status-text="hookStatusText" seam>
        <p class="text-xs text-dimmed">
          One webhook in Tautulli covers every user. <strong class="text-default">Watched</strong> is
          the recommended trigger.
        </p>
        <div class="flex flex-wrap gap-2">
          <!-- Chips, not checkboxes: the `recommended` badge used to be passed as
               #description to the Watched checkbox, which made that one row
               taller than its four siblings. The badge now folds into the
               selected state and the recommendation moved to the line above. -->
          <button
            v-for="t in TRIGGERS"
            :key="t.key"
            type="button"
            :aria-pressed="isTriggerSelected(t.key)"
            class="min-h-11 rounded-lg px-3.5 text-sm ring-1 transition-colors"
            :class="isTriggerSelected(t.key)
              ? 'bg-primary-600/20 text-primary-200 ring-primary-400/40'
              : 'bg-default text-muted ring-default hover:text-default'"
            @click="toggleTrigger(t.key, !isTriggerSelected(t.key))"
          >
            {{ t.label }}
          </button>
        </div>
        <div class="flex border-t border-default pt-4 sm:justify-end">
          <UButton
            :loading="syncing"
            label="Sync to Tautulli"
            class="min-h-11 w-full justify-center sm:w-auto"
            @click="runSync"
          />
        </div>

        <!-- Chrome-less on purpose. This is an alternative to the Sync button
             directly above it, not a third page-level section, so it gets no
             card background, ring or radius — unlike Advanced and Test, which
             use DisclosureCard. -->
        <UCollapsible v-model:open="manual" class="border-t border-default pt-2">
          <UButton color="neutral" variant="ghost" class="w-full min-h-11 justify-start gap-2.5 px-0">
            <UIcon
              name="i-lucide-chevron-right"
              class="size-4 shrink-0 text-muted transition-transform"
              :class="manual ? 'rotate-90' : ''"
            />
            <span class="text-sm font-medium text-highlighted">Set it up manually instead</span>
          </UButton>
          <template #content>
            <div class="space-y-4 pt-2">
              <CopyField label="Webhook URL" :value="webhookUrl" />
              <CopyField label="Method" value="POST" />
              <CopyField label="Headers" :value="'{&quot;Content-Type&quot;: &quot;application/json&quot;}'" />
              <CopyField
                label="JSON body"
                :value="'{&quot;action&quot;: &quot;{action}&quot;, &quot;rating_key&quot;: &quot;{rating_key}&quot;, &quot;username&quot;: &quot;{username}&quot;}'"
                hint="Paste into a Tautulli Webhook agent for each trigger you enable."
              />
            </div>
          </template>
        </UCollapsible>
      </SetupSubsection>
    </SetupStep>
```

- [ ] **Step 5: Renumber step 2 and switch the page rhythm**

The users card is now step 2 of 2 rather than 2 of 3 — its `:n="2"` is already correct, but update its title and hint to match the spec:

```vue
    <SetupStep :n="2" title="seenr users" hint="each Plex user → their seenr token">
```

Change the root wrapper on line 196 from `space-y-4` to `space-y-6`:

```vue
  <div v-if="store.settings" class="space-y-6">
```

- [ ] **Step 6: Add the `More` divider above the two page-level cards**

The two numbered steps are the setup path; Advanced and Test are page-level concerns. A labelled rule separates them, and it is what makes the chrome-less manual disclosure inside step 1 read as a different kind of thing rather than an inconsistency.

Insert this immediately before the Advanced `DisclosureCard`, after step 2's closing `</SetupStep>`:

```vue
    <div class="flex items-center gap-3 pt-2">
      <hr class="flex-1 border-muted" />
      <span class="text-xs uppercase tracking-wider text-dimmed">More</span>
      <hr class="flex-1 border-muted" />
    </div>
```

Because the page root is `space-y-6`, the divider and the two cards below it inherit the same rhythm at every breakpoint — no responsive variant is needed.

- [ ] **Step 7: Typecheck**

Run: `npm run typecheck`
Expected: clean. `UCheckbox` is no longer used on this page; that is fine, it needs no import either way.

- [ ] **Step 8: Manual verification**

With `npm run dev`, at `http://localhost:8687/settings`:

- Step 1 is one card titled **Tautulli** containing **CONNECTION** and **EVENT WEBHOOK**, each with a status pill.
- Both fields' inputs sit on the **same baseline** — the hint line is below the pair, not under one field.
- Clicking a trigger chip toggles it; `Watched` starts pressed. Tab reaches every chip and Space toggles it.
- **Sync to Tautulli still works** — click it and confirm the toast, then check Tautulli's notifier list shows `Seenr Bridge` with exactly the selected triggers enabled.
- **Set it up manually instead** expands inline with no card outline of its own, visibly a child of the webhook section.
- Narrow the window below 640px: fields stack, `Save` appears **above** `Test connection`, `Sync to Tautulli` goes full-width.
- A **MORE** rule sits between step 2 and the Advanced card.

- [ ] **Step 9: Commit**

```bash
git add app/components/SetupSubsection.vue app/pages/settings.vue
git commit -m "feat: merge Tautulli connection and webhook into one step" -m "Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Rebuild step 2 and delete the spacer shim

**Files:**
- Modify: `app/pages/settings.vue` — the step-2 `SetupStep` body (originally lines 234–300, now renumbered/retitled by Task 4)

**Interfaces:**
- Consumes: `store.mappings`, `availableUsers`, `syncSummary(m)`, `addMapping()`, `newUser`, `newToken` — all already present, none change signature.

Two fixes: mapped users become a `divide-y` list matching `app/pages/dashboard.vue`'s event list, and the add-user row aligns on `items-end` so the `&nbsp;` spacer div is **deleted with nothing replacing it**.

- [ ] **Step 1: Replace the step-2 body**

Replace everything between the `<SetupStep :n="2" …>` open tag and its close tag with:

```vue
      <p v-if="!store.mappings.length" class="text-sm text-muted">No users yet. Add one below.</p>

      <!-- divide-muted, not divide-default: matches the Dashboard event list,
           where the row rule is white/5 while the card outline is white/10. -->
      <div v-else class="-mx-4 divide-y divide-muted border-y border-muted sm:-mx-6">
        <div
          v-for="m in store.mappings"
          :key="m.id"
          class="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:gap-3 sm:px-6"
        >
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-2 text-sm font-medium text-highlighted">
              <span class="truncate">{{ m.username }}</span>
              <UBadge v-if="!m.enabled" color="neutral" variant="subtle" size="sm" label="paused" />
            </div>
            <div class="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-dimmed">
              <span class="font-mono">{{ m.seenr_token.slice(0, 8) }}…{{ m.seenr_token.slice(-6) }}</span>
              <span>·</span>
              <span>{{ syncSummary(m) }}</span>
            </div>
          </div>
          <UButton
            color="neutral"
            variant="subtle"
            label="Configure"
            class="min-h-11 self-start sm:self-auto"
            @click="edit = { ...m }"
          />
        </div>
      </div>

      <!-- items-end, and no help text inside the grid. Both fields are now the
           same height, so the bare Add button lines up with the inputs on its
           own. The invisible &nbsp; spacer div that used to shim it is gone. -->
      <div class="mt-4 grid gap-3 sm:grid-cols-[1fr_2fr_auto] sm:items-end">
        <UFormField label="Plex username">
          <!-- Free text stays allowed so manual entry works when Tautulli is
               unreachable. The generated "Create …" option calls preventDefault()
               internally and only emits `create` — it does not update v-model —
               so the typed value is applied here explicitly. -->
          <USelectMenu
            v-model="newUser"
            :items="availableUsers"
            create-item
            placeholder="Select or type…"
            class="w-full"
            @create="(item) => { newUser = item }"
          />
        </UFormField>
        <UFormField label="seenr token">
          <UInput v-model="newToken" placeholder="9%7CyourSeenrToken" class="w-full" />
        </UFormField>
        <UButton label="Add" icon="i-lucide-plus" class="min-h-11 w-full justify-center sm:w-auto" @click="addMapping" />
      </div>
      <p class="mt-2 text-xs text-dimmed">
        Token is the part after <code class="text-default">/scrobble/plex/</code> in your seenr URL.
        Events for a user with no token yet are recorded as
        <code class="text-default">skipped</code> and shown on the Dashboard.
      </p>
```

The trailing sentence is the ordering hint from the spec: with the webhook now in step 1, a first-run user configures forwarding before mapping anyone.

- [ ] **Step 2: Confirm the spacer is really gone**

```bash
grep -n "aria-hidden\|&nbsp;" app/pages/settings.vue
```

Expected: **no matches.** A match means the shim survived and the alignment is still being faked.

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: clean.

- [ ] **Step 4: Manual verification**

At `http://localhost:8687/settings`, in step 2:

- Mapped users render as a full-bleed list with hairline rules between rows, edge-to-edge with the card like the Dashboard's event list.
- The **Add** button's vertical centre lines up with the two inputs beside it. Confirm by eye at a wide window, then temporarily add a long `help` prop to one field to prove the row no longer depends on equal heights — and remove it again.
- Adding a user still works: pick or type a username, paste a token, click Add, see the toast and the new row.
- With zero mappings the "No users yet." line shows and no empty rule appears.
- Below 640px: fields stack, Add goes full-width, each user row puts `Configure` under the username.

- [ ] **Step 5: Commit**

```bash
git add app/pages/settings.vue
git commit -m "feat: rebuild the users step and drop the alignment shim" -m "Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Promote the forwarding switch to the page header

**Files:**
- Modify: `app/pages/settings.vue` — the header block (lines 199–217) and the Advanced `DisclosureCard` from Task 3; add one function to `<script setup>`

**Interfaces:**
- Consumes: `store.save(patch)` from `app/stores/settings.ts:18`, `store.settings.forward_enabled`.
- Produces: `toggleForwarding(v: boolean)`.

`forward_enabled` is the master kill switch for all forwarding and is currently buried in Advanced. Moving it to the header means it no longer sits beside `saveAdvanced()`'s Save button, so **it must persist on change** — otherwise flipping it would silently do nothing.

- [ ] **Step 1: Add the immediate-persist handler**

Add to `<script setup>` in `app/pages/settings.vue`, next to `saveAdvanced`:

```ts
// The switch left Advanced, so it no longer has a Save button next to it and
// must persist on change. On failure the optimistic UI value is rolled back so
// the switch never lies about what the server holds.
async function toggleForwarding(v: boolean) {
  store.settings!.forward_enabled = v
  try {
    await store.save({ forward_enabled: v })
    toast.add({ title: v ? 'Forwarding enabled.' : 'Forwarding paused.', color: 'success' })
  } catch (e) {
    store.settings!.forward_enabled = !v
    toast.add({ title: apiErrorMessage(e, 'Could not change forwarding.'), color: 'error' })
  }
}
```

- [ ] **Step 2: Drop `forward_enabled` from `saveAdvanced`**

Replace the body of `saveAdvanced` so it owns only the two URL fields — one value, one control, no drift:

```ts
async function saveAdvanced() {
  await store.save({
    seenr_base_url: store.settings!.seenr_base_url,
    bridge_url: store.settings!.bridge_url,
  })
  toast.add({ title: 'Saved.', color: 'success' })
}
```

- [ ] **Step 3: Put the switch in the header**

Replace the header block (lines 199–217) with:

```vue
    <!-- "Setup" on the left; the master forwarding switch and the live status
         line on the right. Everything wraps rather than overflowing. -->
    <div class="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
      <h2 class="text-lg font-semibold text-highlighted">Setup</h2>
      <div class="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
        <span class="flex items-center gap-1.5">
          <span
            class="size-1.5 rounded-full"
            :class="status.tautulli === null ? 'bg-neutral-500' : status.tautulli.ok ? 'bg-success' : 'bg-error'"
          />
          <span class="text-muted">
            {{ status.tautulli === null ? 'checking…' : status.tautulli.ok ? 'Tautulli connected' : 'Tautulli offline' }}
          </span>
        </span>
        <span class="text-dimmed">{{ status.users }} {{ status.users === 1 ? 'user' : 'users' }}</span>
        <span class="flex items-center gap-1.5">
          <span class="size-1.5 rounded-full" :class="status.webhook ? 'bg-success' : 'bg-error'" />
          <span class="text-muted">{{ status.webhook ? 'webhook active' : 'no webhook' }}</span>
        </span>
        <!-- The master kill switch, promoted out of Advanced. min-h-11 on the
             label keeps the whole hit area at the touch floor. -->
        <label class="flex min-h-11 items-center gap-2">
          <USwitch
            :model-value="store.settings.forward_enabled"
            @update:model-value="(v) => toggleForwarding(v === true)"
          />
          <span class="font-medium text-default">Forwarding</span>
        </label>
      </div>
    </div>
```

- [ ] **Step 4: Remove the switch from Advanced**

In the Advanced `DisclosureCard`, delete the whole forwarding block — the `flex items-center justify-between` div containing "Forward to seenr", its "Master switch for all forwarding." paragraph, and its `USwitch`. Advanced keeps only the two `UFormField`s and its Save button, and its `summary` prop becomes:

```vue
    <DisclosureCard v-model:open="advanced" title="Advanced" summary="seenr URL · bridge URL">
```

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: clean.

- [ ] **Step 6: Verify persistence, not just the toggle**

At `http://localhost:8687/settings`:

- Flip **Forwarding** off. Expect a "Forwarding paused." toast.
- **Reload the page.** The switch must still be off — this is the step that catches a missing `store.save`.
- Confirm Advanced no longer contains a forwarding switch, and that its Save still persists both URL fields across a reload.
- Roll-back check: stop the dev server, flip the switch in the still-open tab, and confirm an error toast appears **and the switch returns to its previous position** rather than showing a state the server never accepted.

- [ ] **Step 7: Commit**

```bash
git add app/pages/settings.vue
git commit -m "feat: promote the forwarding switch to the page header" -m "Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: `ItemPicker` and the Test-a-scrobble restyle

**Files:**
- Create: `app/components/ItemPicker.vue`
- Modify: `app/pages/settings.vue` — the Test `DisclosureCard` body; remove `testRatingKey`'s bare input

**Interfaces:**
- Consumes: `GET /api/tautulli/children` (Task 2), the existing `GET /api/tautulli/library?type=show|movie`, `LibraryItem`, `LibraryChild`.
- Produces: `<ItemPicker v-model="testRatingKey" />` — `v-model` is a `rating_key` string, `''` when nothing is chosen. The component owns its own fetches, matching how `runTest` already calls `/api/test` directly for page-local scratch state rather than routing through a store.

- [ ] **Step 1: Create `ItemPicker`**

Create `app/components/ItemPicker.vue`:

```vue
<script setup lang="ts">
import type { LibraryItem, LibraryChild } from '../../shared/types'

// v-model is the resolved rating_key. For TV that is the EPISODE's own key —
// getLibraryItems returns a SHOW's key, which is precisely the wrong thing to
// scrobble and the exact Tautulli defect this bridge works around. Hence the
// season/episode drill-down rather than a flat title list.
const model = defineModel<string>({ default: '' })

type Mode = 'tv' | 'movie' | 'key'
type Option = { label: string; value: string }

const mode = ref<Mode>('tv')
const MODES: { value: Mode; label: string }[] = [
  { value: 'tv', label: 'TV' },
  { value: 'movie', label: 'Movies' },
  { value: 'key', label: 'Paste key' },
]

const shows = ref<LibraryItem[]>([])
const movies = ref<LibraryItem[]>([])
const seasons = ref<LibraryChild[]>([])
const episodes = ref<LibraryChild[]>([])

const show = ref<Option | undefined>()
const season = ref<Option | undefined>()
const episode = ref<Option | undefined>()
const movie = ref<Option | undefined>()

const busy = ref(false)
const failed = ref('')

function titleOf(i: LibraryItem): string {
  return i.year ? `${i.title} (${i.year})` : i.title
}

const showOptions = computed<Option[]>(() => shows.value.map((s) => ({ label: titleOf(s), value: s.rating_key })))
const movieOptions = computed<Option[]>(() => movies.value.map((m) => ({ label: titleOf(m), value: m.rating_key })))
const seasonOptions = computed<Option[]>(() =>
  seasons.value.map((s) => ({ label: s.title || `Season ${s.index}`, value: s.rating_key })),
)
const episodeOptions = computed<Option[]>(() =>
  episodes.value.map((e) => ({ label: e.index ? `${e.index} · ${e.title}` : e.title, value: e.rating_key })),
)

async function library(type: 'show' | 'movie'): Promise<LibraryItem[]> {
  const r = await $fetch<{ ok: boolean; items: LibraryItem[]; error?: string }>('/api/tautulli/library', {
    query: { type, length: 200 },
  })
  if (!r.ok) throw new Error(r.error || 'Tautulli library unavailable')
  return r.items
}

async function children(ratingKey: string): Promise<LibraryChild[]> {
  const r = await $fetch<{ ok: boolean; items: LibraryChild[]; error?: string }>('/api/tautulli/children', {
    query: { rating_key: ratingKey },
  })
  if (!r.ok) throw new Error(r.error || 'Tautulli lookup failed')
  return r.items
}

// A picker failure must never block the panel — fall back to Paste key so the
// raw rating_key field can still do the job.
async function guard(fn: () => Promise<void>) {
  busy.value = true
  try {
    await fn()
    failed.value = ''
  } catch (e) {
    failed.value = e instanceof Error ? e.message : String(e)
    mode.value = 'key'
  } finally {
    busy.value = false
  }
}

function pick(m: Mode) {
  mode.value = m
  model.value = ''
  if (m === 'tv' && !shows.value.length) guard(async () => { shows.value = await library('show') })
  if (m === 'movie' && !movies.value.length) guard(async () => { movies.value = await library('movie') })
}

onMounted(() => guard(async () => { shows.value = await library('show') }))

watch(show, (s) => {
  season.value = undefined
  episode.value = undefined
  seasons.value = []
  episodes.value = []
  model.value = ''
  if (s) guard(async () => {
    seasons.value = (await children(s.value)).filter((c) => c.media_type === 'season')
  })
})

watch(season, (s) => {
  episode.value = undefined
  episodes.value = []
  model.value = ''
  if (s) guard(async () => {
    episodes.value = (await children(s.value)).filter((c) => c.media_type === 'episode')
  })
})

watch(episode, (e) => { if (e) model.value = e.value })
watch(movie, (m) => { if (m) model.value = m.value })
</script>

<template>
  <div class="space-y-3">
    <!-- UFieldGroup, NOT UButtonGroup — the latter was renamed in Nuxt UI v4 and
         the old name silently renders nothing. -->
    <UFieldGroup>
      <UButton
        v-for="m in MODES"
        :key="m.value"
        :color="mode === m.value ? 'primary' : 'neutral'"
        :variant="mode === m.value ? 'subtle' : 'outline'"
        :label="m.label"
        class="min-h-11"
        @click="pick(m.value)"
      />
    </UFieldGroup>

    <div v-if="mode === 'tv'" class="grid gap-3 sm:grid-cols-3 sm:items-end">
      <UFormField label="Show">
        <USelectMenu v-model="show" :items="showOptions" :loading="busy" placeholder="Select a show…" class="w-full" />
      </UFormField>
      <UFormField label="Season">
        <USelectMenu
          v-model="season"
          :items="seasonOptions"
          :disabled="!show"
          :loading="busy && !!show && !seasons.length"
          placeholder="Season…"
          class="w-full"
        />
      </UFormField>
      <UFormField label="Episode">
        <USelectMenu
          v-model="episode"
          :items="episodeOptions"
          :disabled="!season"
          :loading="busy && !!season && !episodes.length"
          placeholder="Episode…"
          class="w-full"
        />
      </UFormField>
    </div>

    <div v-else-if="mode === 'movie'" class="sm:max-w-md">
      <UFormField label="Movie">
        <USelectMenu v-model="movie" :items="movieOptions" :loading="busy" placeholder="Select a movie…" class="w-full" />
      </UFormField>
    </div>

    <div v-else class="sm:max-w-xs">
      <UFormField label="rating_key">
        <UInput v-model="model" placeholder="25419" class="w-full" />
      </UFormField>
    </div>

    <p v-if="failed" class="text-xs text-warning">
      Couldn't reach the Tautulli library ({{ failed }}) — paste a rating_key instead.
    </p>
    <p v-else-if="model" class="text-xs text-dimmed">
      Resolves to <code class="text-primary-300">rating_key {{ model }}</code>
    </p>
  </div>
</template>
```

- [ ] **Step 2: Confirm registration and the component name**

```bash
grep -c "ItemPicker" .nuxt/components.d.ts
grep -c "UFieldGroup" .nuxt/components.d.ts
```

Expected: both `1` or more. If `UFieldGroup` is `0`, stop — the segmented control would render nothing.

- [ ] **Step 3: Rewrite the Test panel body**

Replace the contents of the Test `DisclosureCard` (everything from the intro `<p>` down to and including the Preview/Send button group; leave the `v-if="testResult"` block untouched) with:

```vue
      <p class="text-xs text-muted">
        Sends one item down the same path a Tautulli webhook takes — good for checking ID matching
        without waiting for playback.
      </p>

      <ItemPicker v-model="testRatingKey" />

      <div class="grid gap-3 sm:grid-cols-2 sm:items-end">
        <UFormField label="User">
          <USelectMenu
            v-model="testUsername"
            :items="mappedUsernames"
            create-item
            placeholder="Select or type…"
            class="w-full"
            @create="(item) => { testUsername = item }"
          />
        </UFormField>
        <UFormField label="Action">
          <USelectMenu v-model="testAction" :items="TEST_ACTIONS" class="w-full" />
        </UFormField>
      </div>
      <!-- Out of the grid on purpose: as a `help` on the User field this line
           made that cell taller than its siblings and the row ragged. -->
      <p class="text-xs text-dimmed">The user must have a seenr token mapped in step 2.</p>

      <div class="flex flex-col gap-3 border-t border-default pt-4 sm:flex-row sm:items-center">
        <!-- Preview is the solid primary: it is the safe, common action, and was
             previously styled as the afterthought. Send drops from solid rose to
             `subtle` — still unmistakably the destructive half, no longer the
             loudest pixel on the page. -->
        <UButton
          icon="i-lucide-eye"
          label="Preview"
          class="min-h-11 justify-center"
          :loading="previewBusy"
          :disabled="sendBusy"
          @click="runTest(true)"
        />
        <UButton
          color="error"
          variant="subtle"
          icon="i-lucide-send"
          label="Send for real"
          class="min-h-11 justify-center"
          :loading="sendBusy"
          :disabled="previewBusy"
          @click="runTest(false)"
        />
        <p class="text-xs text-dimmed sm:ml-auto sm:text-right">
          Preview builds the payload only.<br class="hidden sm:block" />
          Send forwards to <strong class="text-default">{{ testUsername || 'the selected user' }}</strong>
          and records an event.
        </p>
      </div>
```

The copy no longer re-names the buttons in bold — they sit directly above it, so bolded labels read as two more controls — and it names the actual selected user instead of "this user's seenr account".

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: clean. `testRatingKey` keeps its existing `ref('')` declaration and is now driven by `ItemPicker`; `runTest`'s guard on `testRatingKey.value.trim()` still applies unchanged.

- [ ] **Step 5: Manual verification — the episode key is the whole point**

At `http://localhost:8687/settings`, expand **Test a scrobble**:

- The mode control shows **TV / Movies / Paste key**, with TV active and shows loaded.
- Pick a show → Season populates. Pick a season → Episode populates. Pick an episode → the line below reads `Resolves to rating_key <n>`.
- **Verify that `<n>` is the episode's key, not the show's.** Click **Preview** and confirm the returned payload's title is the *episode*, and that `ids` are episode-level. A show-level key here means the drill-down filtering is wrong and the test would check in the wrong thing — the exact bug this bridge exists to prevent.
- Switch to **Movies**, pick one, Preview, confirm the movie resolves.
- Switch to **Paste key**, type a known `rating_key`, Preview, confirm it still works — this is the no-regression check.
- **Send for real** renders as tinted rose, not solid, and Preview is the solid violet button. Send still forwards and writes an event row visible on the Dashboard.
- Set Tautulli's URL to something unreachable and reopen the panel: it must fall back to **Paste key** with the warning line, not hang or blank out.
- Below 640px: the three TV selects stack, buttons stack, and the explanatory line sits below them.

- [ ] **Step 6: Commit**

```bash
git add app/components/ItemPicker.vue app/pages/settings.vue
git commit -m "feat: add library item picker and calm the test panel" -m "Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Full verification pass

**Files:**
- Modify: `app/pages/settings.vue` only if a defect is found

No new behaviour. This task exists because two of this repo's failure modes are **invisible to every check above**, and both only appear in a production build.

- [ ] **Step 1: Full test suite and typecheck**

Run: `npm test`
Expected: PASS, 55 tests across 5 files.

Run: `npm run typecheck`
Expected: clean, and **no `WARN Duplicated imports`**.

- [ ] **Step 2: Confirm no misspelled components slipped through**

```bash
for c in DisclosureCard SetupSubsection ItemPicker UFieldGroup UCollapsible USwitch USelectMenu UFormField; do
  printf '%s: %s\n' "$c" "$(grep -c "$c" .nuxt/components.d.ts)"
done
```

Expected: every count ≥ 1. A `0` means that component renders nothing at runtime while passing both typecheck and build.

- [ ] **Step 3: Production build, and prove the bundle is actually served**

```bash
npm run build
grep -o 'src="/_nuxt/[^"]*"' .output/public/settings/index.html | head -3
```

Expected: at least one `src="/_nuxt/…"` module script.

If that grep is empty the page ships **blank** — with `ssr: false`, Nuxt 4.5.0's SPA shell template compiles to an empty string, so a route without a real prerendered `index.html` gets no entry script. **An HTTP check cannot catch this: the blank shell returns 200.** `/settings` is already in `nitro.prerender.routes`, so this should pass; it is verified because the failure is silent.

- [ ] **Step 4: Run the built output and click through it**

```bash
npm start
```

At `http://localhost:8687/settings`, confirm against the production build: both steps render, the forwarding switch persists across a reload, all three picker modes work, Preview and Send both function, and the Configure modal still saves and removes a mapping.

- [ ] **Step 5: Responsive sweep**

At ~390px and at ≥1024px, walk both cards, both sub-sections, the `More` group, all three picker modes, and both stacked action rows. Confirm no horizontal scrollbar appears on the page body at either width.

- [ ] **Step 6: Commit any fixes**

If Steps 1–5 surfaced nothing, there is nothing to commit — say so rather than inventing a change. Otherwise:

```bash
git add -A
git commit -m "fix: <the specific defect found during verification>" -m "Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Notes for the implementer

- **`settings.vue` line numbers drift.** They are given as they stand before Task 3. After each task, re-locate blocks by their surrounding markup rather than trusting the original numbers.
- **Do not touch `settings.sync_movies` / `settings.sync_episodes`.** They are vestigial — persisted and served, but the pipeline gates only on the per-mapping flags. Removing them is a separate change.
- **The `Configure <user>` modal is out of scope** and must keep working; it is the one part of the page no task rewrites.
- **`shared/version.ts` and the README badge are release concerns**, not part of this work.
- If `get_children_metadata` turns out to disagree with `TautulliChildRow` (see Task 2, Step 4), fix the util and the test fixtures together — the fixtures exist to pin the real shape, so leaving them describing a shape Tautulli does not return would be worse than having no test.
