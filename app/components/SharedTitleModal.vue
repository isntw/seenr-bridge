<script setup lang="ts">
import type { LibraryItem, Mapping } from '../../shared/types'
import type { SharedRow, SharedTitlePayload } from '../utils/shared-row'
import { apiErrorMessage } from '../../shared/errors'

interface LibraryPage {
  ok: boolean
  items: LibraryItem[]
  total: number
  error?: string
}

type MediaType = 'show' | 'movie'

const open = defineModel<boolean>('open', { default: false })

const props = defineProps<{
  mode: 'add' | 'edit'
  mappings: Mapping[]
  sharedKeys?: string[]
  row?: SharedRow | null
  busy?: boolean
  plexConnected?: boolean
}>()

const emit = defineEmits<{
  submit: [payload: SharedTitlePayload]
  remove: [ratingKey: string]
}>()

const PAGE_SIZE = 50
const SEARCH_DEBOUNCE_MS = 300

const MEDIA_TYPES: { value: MediaType; label: string }[] = [
  { value: 'show', label: 'TV Shows' },
  { value: 'movie', label: 'Movies' },
]

const type = ref<MediaType>('show')
const search = ref('')
const items = ref<LibraryItem[]>([])
const total = ref(0)
const loading = ref(false)
const libError = ref<string | null>(null)

const picked = ref<LibraryItem | null>(null)
const profileIds = ref<number[]>([])
const plexSync = ref(false)

// Strings, not booleans: this decides whether a retroactive mass-scrobble fires, and
// a stringified `"false"` would be truthy.
type SyncChoice = 'new' | 'all'
const syncChoice = ref<SyncChoice>('new')

const isEdit = computed(() => props.mode === 'edit')

const subject = computed(() => {
  if (isEdit.value && props.row) {
    return {
      rating_key: props.row.rating_key,
      media_type: props.row.media_type,
      title: props.row.title,
      year: props.row.year,
      image: props.row.image,
    }
  }
  if (picked.value) {
    return {
      rating_key: picked.value.rating_key,
      media_type: picked.value.media_type,
      title: picked.value.title,
      year: picked.value.year,
      image: picked.value.image,
    }
  }
  return null
})

const subjectMeta = computed(() => {
  const s = subject.value
  if (!s) return ''
  const library = picked.value?.library_name || props.row?.library_name
  return [s.year, library || s.media_type].filter(Boolean).join(' · ')
})

const isShow = computed(() => (subject.value?.media_type ?? type.value) === 'show')

let seq = 0
let timer: ReturnType<typeof setTimeout> | undefined

async function load(start: number) {
  const mine = ++seq
  loading.value = true
  libError.value = null
  try {
    const r = await $fetch<LibraryPage>('/api/tautulli/library', {
      query: { type: type.value, search: search.value.trim(), start, length: PAGE_SIZE },
    })
    if (mine !== seq) return
    if (!r.ok) libError.value = r.error || 'Could not load the library from Tautulli.'
    items.value = start === 0 ? r.items : [...items.value, ...r.items]
    total.value = r.total
  } catch (e) {
    if (mine !== seq) return
    libError.value = apiErrorMessage(e, 'Could not load the library from Tautulli.')
  } finally {
    if (mine === seq) loading.value = false
  }
}

const syncOptions = computed(() => [
  {
    value: 'new' satisfies SyncChoice,
    label: isEdit.value ? 'Leave existing watches alone' : 'Only new watches from now on',
    description: isEdit.value
      ? 'Nothing retroactive — just save who it is shared with.'
      : 'Nothing retroactive — future watches only.',
  },
  {
    value: 'all' satisfies SyncChoice,
    label: isShow.value ? 'Sync all previously watched episodes' : 'Mark it watched for everyone now',
    description: isShow.value
      ? 'Every episode already finished by an assigned profile is scrobbled to the others now.'
      : 'Anyone who has already finished it is scrobbled to the others straight away.',
  },
])

const canSubmit = computed(() => !!subject.value && profileIds.value.length > 0 && !props.busy)

function isAlreadyShared(item: LibraryItem) {
  return (props.sharedKeys ?? []).includes(item.rating_key)
}

function pick(item: LibraryItem) {
  if (isAlreadyShared(item)) return
  picked.value = item
}

function reset() {
  clearTimeout(timer)
  picked.value = null
  search.value = ''
  libError.value = null
  items.value = []
  total.value = 0

  if (isEdit.value) {
    profileIds.value = [...(props.row?.profiles ?? [])]
    type.value = props.row?.media_type === 'movie' ? 'movie' : 'show'
  } else {
    profileIds.value = props.mappings.map((m) => m.id)
    type.value = 'show'
    void load(0)
  }

  plexSync.value = isEdit.value ? !!props.row?.plex_sync : false
  syncChoice.value = 'new'
}

watch(open, (isOpen) => {
  if (isOpen) reset()
  else clearTimeout(timer)
})

watch(search, () => {
  if (isEdit.value) return
  clearTimeout(timer)
  timer = setTimeout(() => void load(0), SEARCH_DEBOUNCE_MS)
})

watch(type, () => {
  if (isEdit.value) return
  clearTimeout(timer)
  picked.value = null
  void load(0)
})

onBeforeUnmount(() => clearTimeout(timer))

function toggleProfile(id: number, checked: boolean) {
  if (checked) {
    if (!profileIds.value.includes(id)) profileIds.value.push(id)
  } else {
    profileIds.value = profileIds.value.filter((x) => x !== id)
  }
}

function posterFor(image: string | null | undefined) {
  return image ? `/api/image?path=${encodeURIComponent(image)}` : null
}

function submit() {
  const s = subject.value
  if (!s || !profileIds.value.length) return
  emit('submit', {
    ...s,
    section_id: picked.value?.section_id,
    library_name: picked.value?.library_name,
    profiles: [...profileIds.value],
    syncPrevious: syncChoice.value === 'all',
    plex_sync: plexSync.value,
  })
}
</script>

<template>
  <UModal
    v-model:open="open"
    :title="isEdit ? `Edit ${row?.title ?? 'title'}` : 'Add a shared title'"
    description="A watch by any assigned profile scrobbles to all of them."
    :ui="{ content: 'max-w-xl' }"
  >
    <template #body>
      <div class="space-y-5">
        <section>
          <h3 class="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">
            {{ isEdit ? 'Title' : '1 · Title' }}
          </h3>

          <template v-if="!isEdit && !picked">
            <div class="space-y-2">
              <UTabs v-model="type" :items="MEDIA_TYPES" :content="false" aria-label="Media type" />
              <UInput
                v-model="search"
                :placeholder="`Search ${type === 'show' ? 'shows' : 'movies'}…`"
                :loading="loading"
                icon="i-lucide-search"
                class="w-full"
              />
            </div>

            <UAlert v-if="libError" color="error" variant="subtle" class="mt-2" :description="libError" />

            <div class="mt-2 max-h-56 overflow-y-auto rounded-lg ring-1 ring-default">
              <UEmpty
                v-if="!items.length && !loading"
                variant="naked"
                size="xs"
                icon="i-lucide-search-x"
                :title="search.trim() ? `Nothing matching “${search.trim()}”` : 'No titles in the selected libraries'"
              />
              <div v-else class="divide-y divide-muted">
                <UButton
                  v-for="i in items"
                  :key="i.rating_key"
                  block
                  color="neutral"
                  variant="ghost"
                  :disabled="isAlreadyShared(i)"
                  @click="pick(i)"
                >
                  <img
                    v-if="posterFor(i.image)"
                    :src="posterFor(i.image)!"
                    alt=""
                    loading="lazy"
                    class="h-9 w-6 shrink-0 rounded-sm object-cover ring-1 ring-default"
                  >
                  <div v-else class="h-9 w-6 shrink-0 rounded-sm bg-elevated ring-1 ring-default" />
                  <span class="min-w-0 flex-1 text-left">
                    <span class="block truncate text-sm text-default">{{ i.title }}</span>
                    <span v-if="i.library_name" class="block truncate text-xs text-dimmed">
                      {{ i.library_name }}
                    </span>
                  </span>
                  <span v-if="i.year" class="shrink-0 text-xs text-dimmed">{{ i.year }}</span>
                  <span v-if="isAlreadyShared(i)" class="shrink-0 text-xs text-dimmed">already shared</span>
                </UButton>
              </div>
            </div>
            <div v-if="items.length < total" class="mt-2 text-center">
              <UButton
                color="neutral"
                variant="subtle"
                size="sm"
                :loading="loading"
                :label="`Load more (${items.length}/${total})`"
                @click="load(items.length)"
              />
            </div>
          </template>

          <div
            v-else-if="subject"
            class="flex items-center gap-3 rounded-lg bg-primary-500/[0.08] p-2.5 ring-1 ring-primary-500/30"
          >
            <img
              v-if="posterFor(subject.image)"
              :src="posterFor(subject.image)!"
              alt=""
              class="h-14 w-10 shrink-0 rounded object-cover ring-1 ring-default"
            >
            <div v-else class="h-14 w-10 shrink-0 rounded bg-elevated ring-1 ring-default" />
            <div class="min-w-0 flex-1">
              <div class="truncate text-sm font-medium text-highlighted">{{ subject.title }}</div>
              <div class="truncate text-xs text-dimmed">{{ subjectMeta }}</div>
            </div>
            <UButton
              v-if="!isEdit"
              color="neutral"
              variant="ghost"
              icon="i-lucide-x"
              aria-label="Choose a different title"
              @click="picked = null"
            />
          </div>
        </section>

        <section :class="subject ? '' : 'pointer-events-none opacity-40'">
          <h3 class="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">
            {{ isEdit ? 'Shared with' : '2 · Share with' }}
          </h3>
          <div class="space-y-1">
            <UCheckbox
              v-for="m in props.mappings"
              :key="m.id"
              :label="m.username"
              :model-value="profileIds.includes(m.id)"
              @update:model-value="(v) => toggleProfile(m.id, v === true)"
            />
          </div>
          <UCheckbox
            v-model="plexSync"
            class="mt-3"
            label="Also mark watched in Plex"
            :disabled="!plexConnected"
            :description="
              plexConnected
                ? 'Each co-watcher\'s own Plex copy is marked watched too. The person who pressed play is skipped — theirs already is.'
                : 'Sign in with Plex under Settings first.'
            "
          />
          <p v-if="subject && profileIds.length === 1" class="mt-2 text-xs text-warning">
            Only one profile selected — co-watching needs at least two to be useful.
          </p>
          <p v-if="subject && !profileIds.length" class="mt-2 text-xs text-warning">
            Pick at least one profile.
            <template v-if="isEdit">To stop sharing entirely, use Remove.</template>
          </p>
        </section>

        <section :class="subject ? '' : 'pointer-events-none opacity-40'">
          <h3 class="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">
            {{ isEdit ? 'Watches that already happened' : '3 · Watches that already happened' }}
          </h3>
          <URadioGroup v-model="syncChoice" :items="syncOptions" />
        </section>
      </div>
    </template>

    <template #footer>
      <div class="flex w-full flex-wrap items-center gap-3">
        <UButton
          v-if="isEdit"
          color="error"
          variant="ghost"
          label="Remove"
          :disabled="props.busy"
          @click="row && emit('remove', row.rating_key)"
        />
        <span v-else class="text-xs text-dimmed">
          {{ profileIds.length }} of {{ props.mappings.length }} profiles selected
        </span>
        <div class="ml-auto flex gap-3">
          <UButton color="neutral" variant="subtle" label="Cancel" @click="open = false" />
          <UButton
            :label="isEdit ? 'Save' : 'Add title'"
            :disabled="!canSubmit"
            :loading="props.busy"
            @click="submit"
          />
        </div>
      </div>
    </template>
  </UModal>
</template>
