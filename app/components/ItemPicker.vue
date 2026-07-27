<script setup lang="ts">
import type { LibraryItem, LibraryChild } from '../../shared/types'
import { apiErrorMessage } from '../../shared/errors'

// Resolves to the EPISODE's own rating_key. getLibraryItems returns a SHOW's key,
// which is the wrong thing to scrobble and the Tautulli defect this bridge exists
// to work around — hence the season/episode drill-down instead of a flat list.
const model = defineModel<string>({ default: '' })

type Mode = 'tv' | 'movie' | 'key'
type Option = { label: string; value: string }

const LIBRARY_LIMIT = 200

const mode = ref<Mode>('tv')
const MODES: { value: Mode; label: string }[] = [
  { value: 'tv', label: 'TV' },
  { value: 'movie', label: 'Movies' },
  { value: 'key', label: 'Paste key' },
]

const shows = ref<LibraryItem[]>([])
const movies = ref<LibraryItem[]>([])
const showsTotal = ref(0)
const moviesTotal = ref(0)
const seasons = ref<LibraryChild[]>([])
const episodes = ref<LibraryChild[]>([])

const show = ref<Option | undefined>()
const season = ref<Option | undefined>()
const episode = ref<Option | undefined>()
const movie = ref<Option | undefined>()

const busy = ref(false)
const failed = ref('')
const failedScope = ref<'library' | 'deep'>('library')

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

const shown = computed(() => (mode.value === 'tv' ? shows.value.length : movies.value.length))
const total = computed(() => (mode.value === 'tv' ? showsTotal.value : moviesTotal.value))
const truncated = computed(() => mode.value !== 'key' && total.value > shown.value)
const emptyLibrary = computed(
  () => mode.value !== 'key' && !busy.value && !failed.value && shown.value === 0,
)

const noChildren = computed(() => {
  if (mode.value !== 'tv' || busy.value || failed.value) return false
  if (season.value && !episodes.value.length) return 'episodes'
  if (show.value && !seasons.value.length) return 'seasons'
  return false
})

async function library(type: 'show' | 'movie'): Promise<{ items: LibraryItem[]; total: number }> {
  const r = await $fetch<{ ok: boolean; items: LibraryItem[]; total: number; error?: string }>(
    '/api/tautulli/library',
    { query: { type, length: LIBRARY_LIMIT } },
  )
  if (!r.ok) throw new Error(r.error || NOT_CONFIGURED)
  return { items: r.items, total: r.total ?? r.items.length }
}

async function children(ratingKey: string): Promise<LibraryChild[]> {
  const r = await $fetch<{ ok: boolean; items: LibraryChild[]; error?: string }>('/api/tautulli/children', {
    query: { rating_key: ratingKey },
  })
  if (!r.ok) throw new Error(r.error || NOT_CONFIGURED)
  return r.items
}

const NOT_CONFIGURED = 'Tautulli isn’t configured yet — add its URL and API key in step 1.'

async function guard(fn: () => Promise<void>, scope: 'library' | 'deep', isStale?: () => boolean) {
  busy.value = true
  failed.value = ''
  try {
    await fn()
  } catch (e) {
    if (isStale?.()) return
    failed.value = apiErrorMessage(e, e instanceof Error ? e.message : 'Tautulli lookup failed.')
    failedScope.value = scope
    if (scope === 'library') mode.value = 'key'
  } finally {
    busy.value = false
  }
}

function loadShows() {
  guard(async () => {
    const page = await library('show')
    shows.value = page.items
    showsTotal.value = page.total
  }, 'library')
}

function loadMovies() {
  guard(async () => {
    const page = await library('movie')
    movies.value = page.items
    moviesTotal.value = page.total
  }, 'library')
}

function pick(m: Mode) {
  if (m === mode.value) return
  mode.value = m
  failed.value = ''
  if (m === 'tv') model.value = episode.value?.value ?? ''
  else if (m === 'movie') model.value = movie.value?.value ?? ''
  else model.value = ''
  if (m === 'movie') {
    if (!movies.value.length) loadMovies()
  } else if (m === 'tv') {
    if (!shows.value.length) loadShows()
    else if (season.value && !episodes.value.length) loadEpisodes(season.value)
    else if (show.value && !seasons.value.length) loadSeasons(show.value)
  }
}

function loadSeasons(s: Option) {
  guard(async () => {
    const rows = await children(s.value)
    if (show.value !== s) return
    seasons.value = rows.filter((c) => c.media_type === 'season')
  }, 'deep', () => show.value !== s)
}

function loadEpisodes(s: Option) {
  guard(async () => {
    const rows = await children(s.value)
    if (season.value !== s) return
    episodes.value = rows.filter((c) => c.media_type === 'episode')
  }, 'deep', () => season.value !== s)
}

onMounted(loadShows)

watch(show, (s) => {
  season.value = undefined
  episode.value = undefined
  seasons.value = []
  episodes.value = []
  model.value = ''
  if (s) loadSeasons(s)
})

watch(season, (s) => {
  episode.value = undefined
  episodes.value = []
  model.value = ''
  if (s) loadEpisodes(s)
})

watch(episode, (e) => { model.value = e ? e.value : '' })
watch(movie, (m) => { model.value = m ? m.value : '' })
</script>

<template>
  <div class="space-y-3">
    <!-- Not v-model: guard() also sets `mode` programmatically on a failed load, and
         this event fires only on user input — so pick()'s reset cannot wipe the
         error message that fallback just set. -->
    <UTabs
      :model-value="mode"
      :items="MODES"
      :content="false"
      aria-label="Item source"
      @update:model-value="(v) => pick(v as Mode)"
    />

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

    <p v-if="failed" class="text-xs text-warning" role="status">
      {{ failed }}{{ failedScope === 'library' ? ' — paste a rating_key instead.' : '' }}
    </p>
    <p v-else-if="noChildren" class="text-xs text-warning" role="status">
      Tautulli returned no {{ noChildren }} for that selection.
    </p>
    <UEmpty
      v-else-if="emptyLibrary"
      role="status"
      variant="naked"
      size="xs"
      icon="i-lucide-library-big"
      :title="`Tautulli reports no ${mode === 'tv' ? 'TV' : 'movie'} libraries`"
      :actions="[
        {
          label: mode === 'tv' ? 'Try movies' : 'Try TV',
          color: 'neutral',
          variant: 'subtle',
          onClick: () => pick(mode === 'tv' ? 'movie' : 'tv'),
        },
        { label: 'Paste a rating_key', color: 'neutral', variant: 'subtle', onClick: () => pick('key') },
      ]"
    />
    <p v-else-if="truncated" class="text-xs text-warning" role="status">
      Showing the first {{ shown }} of {{ total }} titles alphabetically — if yours isn't listed,
      paste its rating_key.
    </p>

    <p v-if="model" class="text-xs text-dimmed">
      Resolves to <code class="text-primary-300">rating_key {{ model }}</code>
    </p>
  </div>
</template>
