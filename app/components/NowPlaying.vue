<script setup lang="ts">
import type { ActivitySession, Mapping, SharedTitle } from '../../shared/types'
import { apiErrorMessage } from '../../shared/errors'

const props = defineProps<{ sessions: ActivitySession[]; mappings: Mapping[] }>()
const emit = defineEmits<{ changed: [] }>()

const toast = useToast()
// Tracked per action, not one shared `busy`: countThis and shareShow both act on the
// same session, and a single flag would light up both buttons whichever was clicked.
const busyCount = ref<string | null>(null)
const busyShare = ref<string | null>(null)
// Which session's profile picker is open, and what is ticked in it.
const picking = ref<string | null>(null)
const picked = ref<number[]>([])

// A pending row for a disabled profile is inert — getPendingWatches only resolves
// enabled mappings — and a share assigned to one would never actually fan out, so
// disabled profiles are not offered here at all.
const enabledMappings = computed(() => props.mappings.filter((m) => m.enabled))

function label(s: ActivitySession) {
  return s.media_type === 'episode' && s.show_title ? s.show_title : s.title
}

function sub(s: ActivitySession) {
  if (s.media_type === 'episode')
    return `S${s.season || '?'}·E${s.episode || '?'}${s.title ? `  ·  ${s.title}` : ''}`
  return s.year
}

function openPicker(s: ActivitySession) {
  picking.value = s.session_key
  // Nobody is pre-ticked: this action sends somebody else's watch history somewhere,
  // so it must be an explicit choice every time.
  picked.value = []
}

function toggle(id: number, on: boolean) {
  picked.value = on ? [...picked.value, id] : picked.value.filter((x) => x !== id)
}

async function countThis(s: ActivitySession) {
  busyCount.value = s.session_key
  try {
    const { added } = await $fetch<{ added: number }>('/api/pending', {
      method: 'POST',
      body: { rating_key: s.rating_key, guid: s.guid || undefined, mapping_ids: picked.value },
    })
    // Says when it will happen, not that it has: the watch has not finished yet.
    toast.add({
      title: added
        ? `Will be counted for ${added === 1 ? '1 profile' : `${added} profiles`} when this finishes.`
        : 'Already queued for those profiles.',
      color: 'success',
    })
    picking.value = null
    emit('changed')
  } catch (e) {
    toast.add({ title: apiErrorMessage(e, 'Could not queue that.'), color: 'error' })
  } finally {
    busyCount.value = null
  }
}

// An episode's share subject is its SHOW (matches every episode via grandparent);
// a movie shares itself.
function shareSubject(s: ActivitySession) {
  const isEpisode = s.media_type === 'episode'
  return {
    rating_key: isEpisode ? s.show_rating_key || s.rating_key : s.rating_key,
    media_type: isEpisode ? 'show' : 'movie',
    title: isEpisode ? s.show_title : s.title,
  }
}

// PUT /api/shared passes `profiles` straight through as the title's new profile list,
// and treats an absent/false `plex_sync` as OFF — so a naive save from this card would
// silently drop existing co-watchers and switch off a Plex setting the operator had
// turned on. Fetching the current row first and merging is what keeps this action
// additive instead of destructive:
//   - profiles: the union of the row's existing profiles and the newly picked ids
//   - plex_sync: whatever the row already had (false when there is no row yet —
//     never invented as true)
//   - section_id / library_name: the row's own when it has them, else the session's
async function shareShow(s: ActivitySession) {
  busyShare.value = s.session_key
  try {
    const subject = shareSubject(s)
    const existing = await $fetch<SharedTitle[]>('/api/shared')
    const current = existing.find((t) => t.rating_key === subject.rating_key)

    const profiles = current ? [...new Set([...current.profiles, ...picked.value])] : [...picked.value]

    await $fetch('/api/shared', {
      method: 'PUT',
      body: {
        rating_key: subject.rating_key,
        media_type: subject.media_type,
        title: subject.title,
        year: s.year,
        image: s.image,
        section_id: current?.section_id || s.section_id,
        library_name: current?.library_name || s.library_name,
        profiles,
        plex_sync: current?.plex_sync ?? false,
      },
    })
    toast.add({ title: 'Shared. Future watches fan out too.', color: 'success' })
    picking.value = null
    emit('changed')
  } catch (e) {
    toast.add({ title: apiErrorMessage(e, 'Could not share that.'), color: 'error' })
  } finally {
    busyShare.value = null
  }
}
</script>

<template>
  <UCard v-if="sessions.length">
    <template #header>
      <div class="flex items-center gap-2">
        <h2 class="text-sm font-semibold text-highlighted">Now playing</h2>
        <LiveDot :state="sessions.some((s) => s.state === 'playing') ? 'playing' : 'paused'" />
      </div>
    </template>

    <div class="divide-y divide-default">
      <div v-for="s in sessions" :key="s.session_key" class="flex items-start gap-3 py-3 first:pt-0">
        <img
          v-if="s.image"
          :src="`/api/image?path=${encodeURIComponent(s.image)}`"
          alt=""
          loading="lazy"
          class="h-[72px] w-12 shrink-0 rounded-md object-cover ring-1 ring-default"
        >
        <div v-else class="h-[72px] w-12 shrink-0 rounded-md bg-elevated ring-1 ring-default" />

        <div class="min-w-0 flex-1">
          <div class="truncate text-sm font-medium text-highlighted">{{ label(s) }}</div>
          <div class="mt-0.5 truncate text-xs text-muted">{{ sub(s) }}</div>
          <div class="mt-1 flex items-center gap-1.5 text-xs text-dimmed">
            <LiveDot :state="s.state" />
            {{ s.username }} · {{ s.state }} · {{ s.progress_percent }}%
          </div>
          <UProgress :model-value="s.progress_percent" :max="100" size="sm" class="mt-2" />

          <div v-if="picking === s.session_key" class="mt-3 space-y-1">
            <UCheckbox
              v-for="m in enabledMappings"
              :key="m.id"
              :label="m.username"
              :model-value="picked.includes(m.id)"
              @update:model-value="(v) => toggle(m.id, v === true)"
            />
            <div class="flex flex-wrap gap-2 pt-1">
              <UButton
                size="xs"
                :disabled="!picked.length"
                :loading="busyCount === s.session_key"
                label="Count for these"
                @click="countThis(s)"
              />
              <UButton
                size="xs"
                color="neutral"
                variant="subtle"
                icon="i-lucide-users"
                :disabled="!picked.length"
                :loading="busyShare === s.session_key"
                :label="s.media_type === 'episode' ? 'Share this show' : 'Share this movie'"
                @click="shareShow(s)"
              />
              <UButton size="xs" color="neutral" variant="ghost" label="Cancel" @click="picking = null" />
            </div>
          </div>
          <div v-else class="mt-2 flex flex-wrap gap-2">
            <UButton
              size="xs"
              color="neutral"
              variant="subtle"
              icon="i-lucide-user-plus"
              label="Count this for…"
              @click="openPicker(s)"
            />
          </div>
        </div>
      </div>
    </div>
  </UCard>
</template>
