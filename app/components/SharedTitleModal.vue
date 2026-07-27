<script setup lang="ts">
import type { LibraryItem, Mapping } from '../../shared/types'
import type { SharedRow, SharedTitlePayload } from '../utils/shared-row'
import { apiErrorMessage } from '../../shared/errors'

// One modal, two modes. `add` needs a title picker; `edit` already has its title
// and gains a Remove action. Everything else — the profile checklist, the
// retroactive-sync choice, the footer — is identical, which is why this isn't two
// components: the shared surface is most of it.
//
// /api/tautulli/library answers ok:false (+ error) instead of throwing, so a
// Tautulli problem shows inline while the modal stays usable. Endpoint-local
// envelope, not part of the shared wire contract.
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
  /** rating_keys already co-watched. In `add` these are dimmed and unselectable
   *  so Add can never quietly mean edit. Unused in `edit`. */
  sharedKeys?: string[]
  /** The row being edited. Required when mode is 'edit'. */
  row?: SharedRow | null
  busy?: boolean
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

// String values, not booleans, even though the payload carries a boolean. This
// radio decides whether a retroactive mass-scrobble fires, and a value that came
// back stringified would make `"false"` truthy — silently backfilling when the
// user asked for "new watches only". Neither Nuxt UI nor reka-ui coerces today,
// but the failure mode is bad enough that it shouldn't depend on that.
type SyncChoice = 'new' | 'all'
const syncChoice = ref<SyncChoice>('new')

const isEdit = computed(() => props.mode === 'edit')

// In edit mode the title is fixed and comes from the row; in add mode it's
// whatever the picker has selected. Both collapse to one shape so the template
// and the payload don't branch.
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

// Falls back to the selected tab, not just the picked title. Before anything is
// picked `subject` is null, and reading only from it made the backfill option show
// the movie wording ("Mark it watched for everyone now") while the TV Shows tab
// was active.
const isShow = computed(() => (subject.value?.media_type ?? type.value) === 'show')

// Every request carries a sequence number and drops itself if a newer one has
// started. Debounced typing keeps several searches in flight, and without this
// the slowest reply wins and the list stops matching the box.
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
    // Start from what the title already has, so Save with no changes is a no-op.
    profileIds.value = [...(props.row?.profiles ?? [])]
    type.value = props.row?.media_type === 'movie' ? 'movie' : 'show'
  } else {
    // Co-watching means "we watch this together", so everyone is the useful
    // default and unticking is the exception.
    profileIds.value = props.mappings.map((m) => m.id)
    type.value = 'show'
    void load(0)
  }

  // Always 'new', in both modes. A retroactive backfill can scrobble hundreds of
  // episodes to every assigned profile and there is no undo, so it has to be a
  // choice the operator makes deliberately rather than the default they get for
  // pressing Add.
  syncChoice.value = 'new'
}

// Nothing is fetched until the modal opens, and never in edit mode — the row
// already carries its title, year and art.
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

function initials(name: string) {
  return name.slice(0, 2).toUpperCase()
}

function posterFor(image: string | null | undefined) {
  return image ? `/api/image?path=${encodeURIComponent(image)}` : null
}

function submit() {
  const s = subject.value
  if (!s || !profileIds.value.length) return
  emit('submit', { ...s, profiles: [...profileIds.value], syncPrevious: syncChoice.value === 'all' })
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
        <!-- 1 · title — picker when adding, fixed summary when editing --------- -->
        <section>
          <h3 class="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">
            {{ isEdit ? 'Title' : '1 · Title' }}
          </h3>

          <template v-if="!isEdit && !picked">
            <div class="flex flex-col gap-2 sm:flex-row sm:items-center">
              <UFieldGroup role="group" aria-label="Media type">
                <UButton
                  v-for="t in MEDIA_TYPES"
                  :key="t.value"
                  :color="type === t.value ? 'primary' : 'neutral'"
                  :variant="type === t.value ? 'solid' : 'outline'"
                  :aria-pressed="type === t.value"
                  :label="t.label"
                  @click="type = t.value"
                />
              </UFieldGroup>
              <UInput
                v-model="search"
                :placeholder="`Search ${type === 'show' ? 'shows' : 'movies'}…`"
                :loading="loading"
                icon="i-lucide-search"
                class="min-w-0 flex-1"
              />
            </div>

            <UAlert v-if="libError" color="error" variant="subtle" class="mt-2" :description="libError" />

            <div class="mt-2 max-h-56 overflow-y-auto rounded-lg ring-1 ring-default">
              <p v-if="!items.length && !loading" class="px-3 py-6 text-center text-sm text-muted">
                No titles found.
              </p>
              <div v-else class="divide-y divide-muted">
                <button
                  v-for="i in items"
                  :key="i.rating_key"
                  type="button"
                  :disabled="isAlreadyShared(i)"
                  class="flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors enabled:hover:bg-elevated/50 disabled:opacity-45"
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
                  <span class="min-w-0 flex-1">
                    <span class="block truncate text-sm text-default">{{ i.title }}</span>
                    <span v-if="i.library_name" class="block truncate text-xs text-dimmed">
                      {{ i.library_name }}
                    </span>
                  </span>
                  <span v-if="i.year" class="shrink-0 text-xs text-dimmed">{{ i.year }}</span>
                  <span v-if="isAlreadyShared(i)" class="shrink-0 text-xs text-dimmed">already shared</span>
                </button>
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
              <div class="truncate text-xs text-dimmed">
                {{ subject.year }} · {{ subject.media_type }}<template v-if="picked?.library_name">
                  · {{ picked.library_name }}</template>
              </div>
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

        <!-- 2 · profiles ---------------------------------------------------- -->
        <section :class="subject ? '' : 'pointer-events-none opacity-40'">
          <h3 class="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">
            {{ isEdit ? 'Shared with' : '2 · Share with' }}
          </h3>
          <div class="space-y-1">
            <UCheckbox
              v-for="m in props.mappings"
              :key="m.id"
              :model-value="profileIds.includes(m.id)"
              @update:model-value="(v) => toggleProfile(m.id, v === true)"
            >
              <template #label>
                <span class="flex items-center gap-2">
                  <UAvatar
                    :text="initials(m.username)"
                    size="2xs"
                    :ui="{ root: 'bg-inverted/15', fallback: 'text-inherit text-[9px]' }"
                  />
                  <span class="text-sm">{{ m.username }}</span>
                </span>
              </template>
            </UCheckbox>
          </div>
          <p v-if="subject && profileIds.length === 1" class="mt-2 text-xs text-warning">
            Only one profile selected — co-watching needs at least two to be useful.
          </p>
          <p v-if="subject && !profileIds.length" class="mt-2 text-xs text-warning">
            Pick at least one profile.
            <template v-if="isEdit">To stop sharing entirely, use Remove.</template>
          </p>
        </section>

        <!-- 3 · backfill ---------------------------------------------------- -->
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
