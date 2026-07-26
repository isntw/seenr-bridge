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
