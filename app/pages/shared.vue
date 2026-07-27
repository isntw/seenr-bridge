<script setup lang="ts">
import type { BackfillResult, Mapping, PlexLinkStatus, SharedTitle } from '../../shared/types'
import type { SharedRow, SharedTitlePayload } from '../utils/shared-row'
import { apiErrorMessage } from '../../shared/errors'

const { data: shared, refresh: refreshShared, status: sharedStatus } = useAsyncData<SharedTitle[]>(
  'shared',
  () => $fetch('/api/shared'),
  { default: (): SharedTitle[] => [], lazy: true },
)

const { data: mappings, status: mappingsStatus } = useAsyncData<Mapping[]>(
  'mappings',
  () => $fetch('/api/mappings'),
  { default: (): Mapping[] => [], lazy: true },
)

const { data: plexLink } = useAsyncData<PlexLinkStatus>(
  'plex-link',
  () => $fetch('/api/plex/users'),
  { default: (): PlexLinkStatus => ({ connected: false, matched: [], unmatched: [] }), lazy: true },
)

const loading = isFirstLoad(sharedStatus, mappingsStatus)

const toast = useToast()

const modalOpen = ref(false)
const editing = ref<SharedRow | null>(null)
const busy = ref(false)

const mode = computed<'add' | 'edit'>(() => (editing.value ? 'edit' : 'add'))
const sharedKeys = computed(() => shared.value.map((s) => s.rating_key))

const rows = computed<SharedRow[]>(() =>
  [...shared.value]
    .sort((a, b) => (a.title || '').localeCompare(b.title || ''))
    .map((s) => ({
      rating_key: s.rating_key,
      media_type: s.media_type,
      title: s.title,
      year: s.year,
      image: s.image,
      poster: s.image ? `/api/image?path=${encodeURIComponent(s.image)}` : null,
      section_id: s.section_id,
      library_name: s.library_name,
      isShow: s.media_type === 'show',
      profiles: s.profiles,
      isShared: s.profiles.length > 0,
      plex_sync: s.plex_sync,
    })),
)

function openAdd() {
  editing.value = null
  modalOpen.value = true
}

function openEdit(row: SharedRow) {
  editing.value = row
  modalOpen.value = true
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

async function saveTitle(p: SharedTitlePayload) {
  const wasEdit = mode.value === 'edit'
  busy.value = true
  try {
    await $fetch('/api/shared', {
      method: 'PUT',
      body: {
        rating_key: p.rating_key,
        media_type: p.media_type,
        title: p.title ?? undefined,
        year: p.year ?? undefined,
        image: p.image ?? undefined,
        section_id: p.section_id,
        library_name: p.library_name,
        profiles: p.profiles,
        plex_sync: p.plex_sync,
      },
    })
  } catch (e) {
    toast.add({ title: apiErrorMessage(e, 'Could not save that title.'), color: 'error' })
    busy.value = false
    return
  }

  if (p.syncPrevious) {
    try {
      const r = await $fetch<BackfillResult>(
        `/api/shared/${encodeURIComponent(p.rating_key)}/backfill`,
        { method: 'POST' },
      )
      toast.add({
        title: `${p.title}: ${backfillMessage(r)}`,
        color: r.ok ? 'success' : 'warning',
      })
    } catch (e) {
      toast.add({
        title: `${p.title} was saved, but syncing previous watches failed: ${apiErrorMessage(e, 'unknown error')}`,
        color: 'warning',
      })
    }
  } else {
    toast.add({
      title: wasEdit ? `${p.title} updated.` : `${p.title} is now shared.`,
      color: 'success',
    })
  }

  await refreshShared()
  modalOpen.value = false
  editing.value = null
  busy.value = false
}

async function removeTitle(ratingKey: string) {
  const row = shared.value.find((s) => s.rating_key === ratingKey)
  busy.value = true
  try {
    await $fetch('/api/shared', {
      method: 'PUT',
      body: { rating_key: ratingKey, media_type: row?.media_type ?? 'show', profiles: [] },
    })
    toast.add({ title: `${row?.title ?? 'Title'} is no longer shared.`, color: 'success' })
    await refreshShared()
    modalOpen.value = false
    editing.value = null
  } catch (e) {
    toast.add({ title: apiErrorMessage(e, 'Could not remove that title.'), color: 'error' })
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="space-y-6">
    <div>
      <h2 class="text-lg font-semibold text-highlighted">Shared / co-watched</h2>
      <p class="mt-0.5 text-sm text-muted">
        Titles you watch together. A watch from any assigned profile scrobbles to all of them.
      </p>
    </div>

    <UCard v-if="loading" :ui="{ body: 'p-0 sm:p-0' }">
      <template #header>
        <div class="space-y-2">
          <USkeleton class="h-4 w-28" />
          <USkeleton class="h-3 w-40" />
        </div>
      </template>
      <ListRowsSkeleton :rows="3" />
    </UCard>

    <UCard v-else-if="!mappings.length">
      <UEmpty
        icon="i-lucide-users-round"
        title="No profiles yet"
        description="A watch can only be shared between profiles, so add the people first."
        :actions="[{ label: 'Add users in Settings', to: '/settings', icon: 'i-lucide-arrow-right', trailing: true }]"
      />
    </UCard>

    <UCard v-else :ui="{ body: 'p-0 sm:p-0' }">
      <template #header>
        <div class="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 class="text-sm font-semibold tracking-wide text-highlighted">Shared titles</h3>
            <p class="mt-0.5 text-xs text-muted">
              {{ plural(shared.length, 'title') }} · {{ plural(mappings.length, 'profile') }}
            </p>
          </div>
          <UButton icon="i-lucide-plus" label="Add title" @click="openAdd" />
        </div>
      </template>

      <div v-if="!rows.length" class="px-4 py-12 text-center text-sm text-muted">
        Nothing shared yet. Use <strong class="text-default">Add title</strong> to pick something you
        watch together.
      </div>

      <div v-else class="divide-y divide-muted">
        <SharedTitleRow
          v-for="row in rows"
          :key="row.rating_key"
          :row="row"
          :mappings="mappings"
          @edit="openEdit(row)"
        />
      </div>
    </UCard>

    <SharedTitleModal
      v-model:open="modalOpen"
      :mode="mode"
      :mappings="mappings"
      :shared-keys="sharedKeys"
      :row="editing"
      :busy="busy"
      :plex-connected="plexLink.connected"
      @submit="saveTitle"
      @remove="removeTitle"
    />
  </div>
</template>
