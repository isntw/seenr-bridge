<script setup lang="ts">
import type { BackfillResult, LibraryItem, Mapping, SharedTitle } from '../../shared/types'
import { apiErrorMessage } from '../../shared/errors'

// /api/tautulli/library answers with ok:false (+ error) instead of throwing, so a
// Tautulli problem can be shown inline while the rest of the page keeps working.
// It's an endpoint-local envelope, not part of the shared wire contract.
interface LibraryPage {
  ok: boolean
  items: LibraryItem[]
  total: number
  error?: string
}

type MediaType = 'show' | 'movie'

interface BackfillMessage {
  ok: boolean
  msg: string
}

// One view-ready row, so the template never has to index the lookup maps
// (noUncheckedIndexedAccess makes that awkward) or rebuild poster URLs inline.
interface Row {
  rating_key: string
  media_type: string
  title: string | null
  year: string | null
  image: string | null
  poster: string | null
  isShow: boolean
  profiles: number[]
  isShared: boolean
  result: BackfillMessage | null
  onlyNew: boolean
}

const PAGE_SIZE = 50

const MEDIA_TYPES: { value: MediaType; label: string }[] = [
  { value: 'show', label: 'TV Shows' },
  { value: 'movie', label: 'Movies' },
]

const { data: shared, refresh: refreshShared } = await useAsyncData<SharedTitle[]>(
  'shared',
  () => $fetch('/api/shared'),
  { default: (): SharedTitle[] => [] },
)

const { data: mappings } = await useAsyncData<Mapping[]>(
  'mappings',
  () => $fetch('/api/mappings'),
  { default: (): Mapping[] => [] },
)

const type = ref<MediaType>('show')
const search = ref('')
const query = ref('') // the applied search — only changes on submit
const items = ref<LibraryItem[]>([])
const total = ref(0)
const loading = ref(false)
const libError = ref<string | null>(null)
const sharedOnly = ref(false)

// Only one backfill runs at a time, so a single key is enough to track it.
const busyKey = ref<string | null>(null)
const results = ref(new Map<string, BackfillMessage>())
// Shows where "Only new ones" was picked. Per-title, client-side, not persisted.
const onlyNew = ref(new Set<string>())

const sharedMap = computed(() => {
  const m = new Map<string, number[]>()
  for (const s of shared.value) m.set(s.rating_key, s.profiles)
  return m
})

async function load(start: number) {
  loading.value = true
  libError.value = null
  try {
    const r = await $fetch<LibraryPage>('/api/tautulli/library', {
      query: { type: type.value, search: query.value, start, length: PAGE_SIZE },
    })
    if (!r.ok) libError.value = r.error || 'Could not load library from Tautulli.'
    items.value = start === 0 ? r.items : [...items.value, ...r.items]
    total.value = r.total
  } catch (e) {
    libError.value = apiErrorMessage(e, 'Could not load library from Tautulli.')
  } finally {
    loading.value = false
  }
}

// (Re)load the library when the type or the applied search changes, and when
// leaving the shared-only view. Shared-only reads from the stored titles instead.
watch([type, query, sharedOnly], () => {
  if (sharedOnly.value) return
  void load(0)
}, { immediate: true })

function applySearch() {
  query.value = search.value.trim()
}

const rows = computed<Row[]>(() => {
  const base = sharedOnly.value
    ? shared.value.map((s) => ({
        rating_key: s.rating_key,
        media_type: s.media_type,
        title: s.title,
        year: s.year,
        image: s.image,
      }))
    : items.value.map((i) => ({
        rating_key: i.rating_key,
        media_type: i.media_type,
        title: i.title,
        year: i.year,
        image: i.image,
      }))

  return base.map((r) => {
    const profiles = sharedMap.value.get(r.rating_key) ?? []
    return {
      ...r,
      poster: r.image ? `/api/image?path=${encodeURIComponent(r.image)}` : null,
      isShow: r.media_type === 'show',
      profiles,
      isShared: profiles.length > 0,
      result: results.value.get(r.rating_key) ?? null,
      onlyNew: onlyNew.value.has(r.rating_key),
    }
  })
})

function initials(name: string) {
  return name.slice(0, 2).toUpperCase()
}

// Optimistic: the chip flips immediately, the PUT follows. A failed PUT re-reads
// /api/shared so the UI can't stay out of step with the database.
async function toggleProfile(row: Row, mappingId: number) {
  const next = row.profiles.includes(mappingId)
    ? row.profiles.filter((id) => id !== mappingId)
    : [...row.profiles, mappingId]

  const existing = shared.value.find((s) => s.rating_key === row.rating_key)
  const others = shared.value.filter((s) => s.rating_key !== row.rating_key)
  // No profiles left means the title is no longer shared at all.
  shared.value = next.length === 0
    ? others
    : [...others, {
        rating_key: row.rating_key,
        media_type: row.media_type,
        title: row.title ?? existing?.title ?? null,
        year: row.year ?? existing?.year ?? null,
        image: row.image ?? existing?.image ?? null,
        profiles: next,
      }]

  try {
    await $fetch<{ ok: boolean; profiles: number[] }>('/api/shared', {
      method: 'PUT',
      body: {
        rating_key: row.rating_key,
        media_type: row.media_type,
        title: row.title ?? undefined,
        year: row.year ?? undefined,
        image: row.image ?? undefined,
        profiles: next,
      },
    })
  } catch {
    await refreshShared()
  }
}

function plural(n: number, word: string) {
  return `${n} ${word}${n === 1 ? '' : 's'}`
}

function backfillMessage(r: BackfillResult) {
  if (!r.ok && r.reason) return r.reason
  const failed = r.fail_count ? `, ${r.fail_count} failed` : ''
  if (r.media_type === 'movie') {
    return `marked watched for ${plural(r.profiles, 'profile')} (${r.ok_count} ok${failed})`
  }
  return `${plural(r.items, 'episode')} → ${plural(r.profiles, 'profile')} · ${r.ok_count} ok${failed}`
}

async function backfill(ratingKey: string) {
  busyKey.value = ratingKey
  results.value.delete(ratingKey)
  try {
    const r = await $fetch<BackfillResult>(
      `/api/shared/${encodeURIComponent(ratingKey)}/backfill`,
      { method: 'POST' },
    )
    results.value.set(ratingKey, { ok: r.ok, msg: backfillMessage(r) })
  } catch (e) {
    results.value.set(ratingKey, { ok: false, msg: apiErrorMessage(e, 'Sync failed.') })
  } finally {
    busyKey.value = null
  }
}

function setOnlyNew(ratingKey: string, value: boolean) {
  if (value) onlyNew.value.add(ratingKey)
  else onlyNew.value.delete(ratingKey)
}
</script>

<template>
  <div class="space-y-4">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h2 class="text-lg font-semibold text-highlighted">Shared / co-watched</h2>
        <p class="mt-0.5 text-sm text-muted">
          Pick titles you watch together. A watch from any assigned profile scrobbles to all of them.
        </p>
      </div>
      <UBadge
        v-if="mappings.length > 0 && shared.length > 0"
        color="primary"
        variant="subtle"
        :label="`${shared.length} shared`"
      />
    </div>

    <!-- Co-watching shares a watch between profiles, so it needs profiles first. -->
    <UCard v-if="!mappings.length" :ui="{ body: 'px-5 py-8 sm:px-5 sm:py-8' }">
      <p class="text-center text-sm text-muted">
        Add at least one user under
        <ULink to="/settings" class="text-default">Settings → Map users</ULink>
        first. Co-watching needs profiles to share to.
      </p>
    </UCard>

    <template v-else>
      <div class="flex flex-wrap items-center gap-3">
        <!-- UFieldGroup is v4's renamed UButtonGroup — it joins the two buttons
             into one segmented control. Note that an unknown component name here
             typechecks fine and simply renders nothing, so it has to be verified
             against .nuxt/components.d.ts rather than trusted. -->
        <UFieldGroup>
          <UButton
            v-for="t in MEDIA_TYPES"
            :key="t.value"
            :color="type === t.value ? 'primary' : 'neutral'"
            :variant="type === t.value ? 'solid' : 'outline'"
            :label="t.label"
            :disabled="sharedOnly"
            class="min-h-11"
            @click="type = t.value"
          />
        </UFieldGroup>

        <form v-if="!sharedOnly" class="flex flex-1 items-center gap-2" @submit.prevent="applySearch">
          <UInput
            v-model="search"
            :placeholder="`Search ${type === 'show' ? 'shows' : 'movies'}…`"
            class="min-w-0 flex-1"
          />
          <UButton type="submit" color="neutral" variant="subtle" label="Search" class="min-h-11" />
        </form>

        <!-- UCheckbox emits 'indeterminate' as well as booleans, so v-model on a
             plain boolean ref doesn't typecheck — same reason settings.vue takes
             the update event instead. -->
        <UCheckbox
          :model-value="sharedOnly"
          label="Shared only"
          class="ml-auto min-h-11 items-center"
          @update:model-value="(v) => { sharedOnly = v === true }"
        />
      </div>

      <UAlert
        v-if="libError && !sharedOnly"
        color="error"
        variant="subtle"
        :description="libError"
      />

      <div class="space-y-2">
        <UCard v-if="!rows.length && !loading" :ui="{ body: 'px-5 py-8 sm:px-5 sm:py-8' }">
          <p class="text-center text-sm text-muted">
            {{ sharedOnly
              ? 'Nothing shared yet. Turn off “Shared only” and pick titles to co-watch.'
              : 'No titles found.' }}
          </p>
        </UCard>

        <!-- Rows are `outline`, not the app-wide `subtle` default: the old row
             was bg-black/20 with a white/10 border, i.e. recessed to page level
             rather than raised like a card. Tinted violet once shared. -->
        <UCard
          v-for="row in rows"
          :key="row.rating_key"
          variant="outline"
          :ui="{ root: 'rounded-xl', body: 'p-3 sm:p-3' }"
          :class="row.isShared ? 'bg-primary-500/[0.06] ring-primary-500/30' : ''"
        >
          <div class="flex gap-3">
            <img
              v-if="row.poster"
              :src="row.poster"
              alt=""
              loading="lazy"
              class="h-[72px] w-12 shrink-0 rounded-md object-cover ring-1 ring-default"
            >
            <div v-else class="h-[72px] w-12 shrink-0 rounded-md bg-elevated ring-1 ring-default" />

            <div class="min-w-0 flex-1">
              <div class="flex flex-wrap items-center gap-2">
                <span class="min-w-0 truncate text-sm font-medium text-highlighted">{{ row.title }}</span>
                <span v-if="row.year" class="text-xs text-dimmed">{{ row.year }}</span>
                <UBadge
                  :color="row.isShow ? 'primary' : 'info'"
                  variant="subtle"
                  size="sm"
                  :label="row.isShow ? 'show' : 'movie'"
                />
              </div>

              <div class="mt-2 flex flex-wrap gap-1.5">
                <UButton
                  v-for="m in mappings"
                  :key="m.id"
                  :color="row.profiles.includes(m.id) ? 'primary' : 'neutral'"
                  :variant="row.profiles.includes(m.id) ? 'solid' : 'subtle'"
                  size="sm"
                  :title="m.username"
                  :label="m.username"
                  class="min-h-9 rounded-full"
                  @click="toggleProfile(row, m.id)"
                >
                  <template #leading>
                    <UAvatar
                      :text="initials(m.username)"
                      size="3xs"
                      :ui="{ root: 'bg-inverted/15', fallback: 'text-inherit text-[9px]' }"
                    />
                  </template>
                </UButton>
              </div>

              <!-- Retroactive sync: only meaningful once someone is assigned. -->
              <div v-if="row.isShared" class="mt-2.5 flex flex-wrap items-center gap-2">
                <template v-if="row.isShow">
                  <span v-if="row.onlyNew" class="text-xs text-muted">
                    Only new watches will sync.
                    <ULink class="text-primary" @click="setOnlyNew(row.rating_key, false)">change</ULink>
                  </span>
                  <template v-else>
                    <UButton
                      color="neutral"
                      variant="subtle"
                      label="Sync all previous episodes"
                      class="min-h-11"
                      :loading="busyKey === row.rating_key"
                      :disabled="busyKey !== null && busyKey !== row.rating_key"
                      @click="backfill(row.rating_key)"
                    />
                    <UButton
                      color="neutral"
                      variant="subtle"
                      label="Only new ones"
                      class="min-h-11"
                      @click="setOnlyNew(row.rating_key, true)"
                    />
                  </template>
                </template>
                <UButton
                  v-else
                  color="neutral"
                  variant="subtle"
                  label="Sync now"
                  class="min-h-11"
                  :loading="busyKey === row.rating_key"
                  :disabled="busyKey !== null && busyKey !== row.rating_key"
                  @click="backfill(row.rating_key)"
                />

                <UBadge
                  v-if="row.result"
                  :color="row.result.ok ? 'success' : 'error'"
                  variant="subtle"
                  :label="row.result.msg"
                />
              </div>
            </div>
          </div>
        </UCard>
      </div>

      <div v-if="!sharedOnly && items.length < total" class="pt-1 text-center">
        <UButton
          color="neutral"
          variant="subtle"
          class="min-h-11"
          :loading="loading"
          :label="`Load more (${items.length}/${total})`"
          @click="load(items.length)"
        />
      </div>

      <div v-if="loading && !items.length" class="py-6 text-center text-sm text-muted">
        Loading library…
      </div>
    </template>
  </div>
</template>
