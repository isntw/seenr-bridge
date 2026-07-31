<script setup lang="ts">
import type {
  ActivitySession, Mapping, NotifyMute, PendingWatchEntry, SharedTitle,
} from '../../shared/types'
import { apiErrorMessage } from '../../shared/errors'

const props = defineProps<{
  sessions: ActivitySession[]
  mappings: Mapping[]
  shares: SharedTitle[]
  pending: PendingWatchEntry[]
  mutes: NotifyMute[]
  focus?: { rating_key: string; username: string } | null
  /** False until shares, pending and mutes have landed — see focusTarget(). */
  ready?: boolean
}>()
const emit = defineEmits<{ changed: []; focused: [] }>()

const toast = useToast()

const target = ref<ActivitySession | null>(null)
const open = ref(false)
const busy = ref(false)
const picked = ref<number[]>([])
const scope = ref<'once' | 'always'>('once')
const plexSync = ref(false)
const notifyOn = ref(true)

const enabledMappings = computed(() => props.mappings.filter((m) => m.enabled))

function label(s: ActivitySession) {
  return s.media_type === 'episode' && s.show_title ? s.show_title : s.title
}

function stateWord(s: ActivitySession) {
  const state = (s.state || '').toLowerCase()
  if (state === 'playing') return 'watching'
  return state || 'unknown'
}

function what(s: ActivitySession) {
  return s.media_type === 'episode'
    ? `S${s.season || '?'}·E${s.episode || '?'}${s.title ? ` · ${s.title}` : ''}`
    : s.year
}

const isEpisode = (s: ActivitySession) => s.media_type === 'episode'

function shareSubject(s: ActivitySession) {
  const episode = isEpisode(s)
  return {
    rating_key: episode ? s.show_rating_key || s.rating_key : s.rating_key,
    media_type: episode ? 'show' : 'movie',
    title: episode ? s.show_title : s.title,
  }
}

function shareFor(s: ActivitySession) {
  return props.shares.find((t) => t.rating_key === shareSubject(s).rating_key)
}

function countedFor(s: ActivitySession): string[] {
  const names = new Set<string>()
  const share = shareFor(s)
  if (share) {
    for (const id of share.profiles) {
      const m = props.mappings.find((x) => x.id === id)
      if (m) names.add(m.username)
    }
  }
  for (const p of props.pending) if (p.rating_key === s.rating_key) names.add(p.username)
  return [...names].sort((a, b) => a.localeCompare(b))
}

function pendingFor(s: ActivitySession) {
  return props.pending.filter((p) => p.rating_key === s.rating_key)
}

function countedIds(s: ActivitySession): number[] {
  const ids = new Set<number>(shareFor(s)?.profiles ?? [])
  for (const p of pendingFor(s)) ids.add(p.mapping_id)
  return [...ids]
}

function plexBound(s: ActivitySession) {
  return !!shareFor(s)?.plex_sync || pendingFor(s).some((p) => p.plex_sync)
}

// Same key the share uses, so a mute and a share cannot disagree about what
// "this show" means.
function mutedFor(s: ActivitySession) {
  return props.mutes.some((m) => m.subject_key === shareSubject(s).rating_key)
}

function openDialog(s: ActivitySession) {
  target.value = s
  picked.value = countedIds(s)
  scope.value = 'once'
  plexSync.value = plexBound(s)
  notifyOn.value = !mutedFor(s)
  open.value = true
}

function toggle(id: number, on: boolean) {
  picked.value = on ? [...picked.value, id] : picked.value.filter((x) => x !== id)
}

watch(
  [() => props.focus, () => props.sessions, () => props.ready],
  () => {
    const match = focusTarget(props.focus, props.sessions, props.ready ?? false, open.value)
    if (!match) return
    openDialog(match)
    emit('focused')
  },
  { immediate: true },
)

const scopeOptions = [
  {
    value: 'once',
    label: 'Just this episode',
    description: 'Counted when this finishes. Nothing is saved and the Shared page is untouched.',
  },
  {
    value: 'always',
    label: 'The whole show, from now on',
    description: 'Shares the show, so every future episode fans out to them too.',
  },
]

function wantsShare(s: ActivitySession) {
  return !isEpisode(s) || scope.value === 'always'
}

const dirty = computed(() => {
  const s = target.value
  if (!s) return false
  const before = new Set(countedIds(s))
  const now = new Set(picked.value)
  if (before.size !== now.size) return true
  for (const id of now) if (!before.has(id)) return true
  if (plexSync.value !== plexBound(s)) return true
  if (notifyOn.value === mutedFor(s)) return true
  if (wantsShare(s) && !shareFor(s) && now.size) return true
  return false
})

async function save() {
  const s = target.value
  if (!s) return
  busy.value = true
  try {
    // Captured before the first await: props refresh under us afterwards.
    const mutedChanged = notifyOn.value === mutedFor(s)
    const wasCounted = new Set(countedIds(s))
    const onlyMute =
      mutedChanged &&
      wasCounted.size === picked.value.length &&
      picked.value.every((id) => wasCounted.has(id)) &&
      plexSync.value === plexBound(s)

    const share = shareFor(s)
    const members = share?.profiles ?? []
    const offered = new Set(enabledMappings.value.map((m) => m.id))
    const keptUnoffered = members.filter((id) => !offered.has(id))

    const droppedPending = pendingFor(s)
      .map((p) => p.mapping_id)
      .filter((id) => !picked.value.includes(id))
    if (droppedPending.length) {
      await $fetch('/api/pending', {
        method: 'DELETE',
        body: { rating_key: s.rating_key, mapping_ids: droppedPending },
      })
    }

    const nextMembers = wantsShare(s)
      ? [...new Set([...picked.value, ...keptUnoffered])]
      : [...new Set([...members.filter((id) => picked.value.includes(id)), ...keptUnoffered])]
    const membershipChanged =
      nextMembers.length !== members.length || nextMembers.some((id) => !members.includes(id))
    const plexChanged = !!share?.plex_sync !== plexSync.value
    if ((share && (membershipChanged || plexChanged)) || (!share && wantsShare(s) && nextMembers.length)) {
      const subject = shareSubject(s)
      await $fetch('/api/shared', {
        method: 'PUT',
        body: {
          rating_key: subject.rating_key,
          media_type: subject.media_type,
          title: subject.title,
          year: s.year,
          image: s.image,
          section_id: share?.section_id || s.section_id,
          library_name: share?.library_name || s.library_name,
          profiles: nextMembers,
          plex_sync: plexSync.value,
        },
      })
    }

    const covered = new Set(nextMembers)
    const toQueue = picked.value.filter((id) => !covered.has(id))
    if (!wantsShare(s) && toQueue.length) {
      await $fetch('/api/pending', {
        method: 'POST',
        body: {
          rating_key: s.rating_key,
          guid: s.guid || undefined,
          mapping_ids: toQueue,
          plex_sync: plexSync.value,
        },
      })
    }

    if (mutedChanged) {
      const subject = shareSubject(s)
      await (notifyOn.value
        ? $fetch('/api/notify/mutes', {
            method: 'DELETE',
            body: { subject_key: subject.rating_key },
          })
        : $fetch('/api/notify/mutes', {
            method: 'POST',
            body: {
              subject_key: subject.rating_key,
              title: subject.title || s.title,
              media_type: subject.media_type,
            },
          }))
    }

    toast.add({
      title: onlyMute
        ? notifyOn.value
          ? `Notifications for ${label(s)} are back on.`
          : `Muted ${label(s)}.`
        : !picked.value.length
          ? 'Removed.'
          : wantsShare(s)
            ? 'Saved. Future watches fan out to them too.'
            : `Counted for ${toQueue.length === 1 ? '1 profile' : `${toQueue.length} profiles`} when this finishes.`,
      color: 'success',
    })
    open.value = false
    emit('changed')
  } catch (e) {
    toast.add({ title: apiErrorMessage(e, 'Could not save that.'), color: 'error' })
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <UCard v-if="sessions.length" class="overflow-hidden" :ui="{ body: 'p-0 sm:p-0' }">
    <div>
      <div v-for="s in sessions" :key="s.session_key">
        <div class="flex items-stretch gap-3 p-3">
          <img
            v-if="s.image"
            :src="`/api/image?path=${encodeURIComponent(s.image)}`"
            alt=""
            loading="lazy"
            class="h-[72px] w-12 shrink-0 rounded-md object-cover ring-1 ring-default"
          >
          <div v-else class="h-[72px] w-12 shrink-0 rounded-md bg-elevated ring-1 ring-default" />

          <div class="flex min-w-0 flex-1 flex-col justify-between">
            <div class="min-w-0">
              <div class="flex min-w-0 items-center gap-1.5">
                <span class="truncate text-sm font-medium text-highlighted">{{ label(s) }}</span>
                <LiveState :state="s.state" />
                <span class="shrink-0 text-xs text-dimmed">{{ stateWord(s) }}</span>
              </div>
              <div v-if="what(s)" class="mt-0.5 truncate text-xs text-muted">{{ what(s) }}</div>
            </div>
            <div v-if="countedFor(s).length" class="flex flex-wrap items-center gap-1.5">
              <UBadge
                v-for="n in countedFor(s)"
                :key="n"
                color="primary"
                variant="subtle"
                size="sm"
                :label="n"
              />
              <PlexBadge
                v-if="plexBound(s)"
                title="Will also be marked watched in each of their own Plex libraries"
              />
            </div>
          </div>

          <UButton
            color="neutral"
            variant="subtle"
            icon="i-lucide-user-plus"
            class="shrink-0 self-start"
            title="Watch together"
            aria-label="Watch together"
            @click="openDialog(s)"
          />
        </div>

        <div class="h-[3px] bg-elevated" :title="`${s.progress_percent}% watched`">
          <div
            class="h-full bg-primary transition-[width] duration-700 ease-linear"
            :style="{ width: `${Math.min(Math.max(s.progress_percent, 0), 100)}%` }"
          />
        </div>
      </div>
    </div>

    <UModal
      v-model:open="open"
      title="Watch together"
      :description="target ? label(target) : ''"
    >
      <template #body>
        <div v-if="target" class="space-y-4">
          <section>
            <h3 class="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">Title</h3>
            <div class="flex items-center gap-3 rounded-lg bg-primary-500/[0.08] p-2.5 ring-1 ring-primary-500/30">
              <img
                v-if="target.image"
                :src="`/api/image?path=${encodeURIComponent(target.image)}`"
                alt=""
                class="h-14 w-10 shrink-0 rounded object-cover ring-1 ring-default"
              >
              <div v-else class="h-14 w-10 shrink-0 rounded bg-elevated ring-1 ring-default" />
              <div class="min-w-0 flex-1">
                <div class="truncate text-sm font-medium text-highlighted">{{ label(target) }}</div>
                <div class="truncate text-xs text-dimmed">
                  {{ [what(target), target.library_name].filter(Boolean).join(' · ') }}
                </div>
              </div>
            </div>
          </section>

          <section>
            <h3 class="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">
              Count this for
            </h3>
            <div class="space-y-1">
              <UCheckbox
                v-for="m in enabledMappings"
                :key="m.id"
                :label="m.username"
                :model-value="picked.includes(m.id)"
                @update:model-value="(v) => toggle(m.id, v === true)"
              />
            </div>
            <p v-if="!enabledMappings.length" class="text-xs text-warning">
              No enabled profiles to count this for. Add one under Settings → seenr users.
            </p>
            <p v-else-if="!picked.length" class="mt-2 text-xs text-warning">
              Nothing selected — saving now clears this title.
            </p>
          </section>

          <section>
            <h3 class="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">Plex</h3>
            <USwitch v-model="plexSync" label="Mark watched in Plex too" />
          </section>

          <section>
            <h3 class="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">
              Notifications
            </h3>
            <USwitch
              v-model="notifyOn"
              :label="isEpisode(target) ? 'Notify when this show starts' : 'Notify when this plays'"
            />
            <p v-if="!notifyOn" class="mt-2 text-xs text-dimmed">
              Silent until you turn this back on, here or in Settings — whoever plays it.
            </p>
          </section>

          <section v-if="isEpisode(target)">
            <h3 class="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">
              How far this goes
            </h3>
            <URadioGroup v-model="scope" :items="scopeOptions" />
          </section>
        </div>
      </template>

      <template #footer>
        <div class="flex w-full flex-wrap items-center gap-3">
          <span class="text-xs text-dimmed">
            {{ picked.length }} of {{ enabledMappings.length }} profiles selected
          </span>
          <div class="ml-auto flex gap-3">
            <UButton color="neutral" variant="subtle" label="Cancel" @click="open = false" />
            <UButton :disabled="!dirty" :loading="busy" label="Update" @click="save()" />
          </div>
        </div>
      </template>
    </UModal>
  </UCard>
</template>
