<script setup lang="ts">
import type { ScrobbleEvent } from '../../shared/types'

const props = defineProps<{ event: ScrobbleEvent }>()
const open = ref(false)

const derived = computed(() => {
  let main = props.event.title || 'Unknown'
  let sub = ''
  try {
    const m = props.event.payload ? JSON.parse(props.event.payload).Metadata : null
    if (m) {
      if (props.event.media_type === 'episode') {
        main = m.grandparentTitle || props.event.title || 'Unknown'
        sub = `S${m.parentIndex || '?'}·E${m.index || '?'}${m.title ? '  ·  ' + m.title : ''}`
      } else {
        main = m.title || props.event.title || 'Unknown'
        sub = String(m.year || '')
      }
    }
  } catch {
    // Malformed payload — fall back to the stored title.
  }
  return { main, sub }
})

const matchedBy = computed(() => {
  const ids = props.event.ids
  if (!ids?.length) return 'no ext id'
  return (ids.find((i) => i.startsWith('tmdb://')) || ids[0]!).replace('://', ' ')
})

const status = computed(() => {
  if (props.event.ok) return { label: 'checked in', color: 'success' as const, rail: 'bg-success' }
  if (props.event.seenr_status) {
    return { label: `seenr ${props.event.seenr_status}`, color: 'error' as const, rail: 'bg-error' }
  }
  return { label: 'failed', color: 'warning' as const, rail: 'bg-warning' }
})

const timeAgo = computed(() => {
  const s = Math.floor((Date.now() - props.event.ts) / 1000)
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return new Date(props.event.ts).toLocaleDateString()
})

const pretty = computed(() => {
  if (!props.event.payload) return '(no payload)'
  try {
    return JSON.stringify(JSON.parse(props.event.payload), null, 2)
  } catch {
    return props.event.payload
  }
})
</script>

<template>
  <div>
    <button
      type="button"
      class="relative flex w-full items-start gap-3 py-3 pl-4 pr-2 text-left transition hover:bg-elevated/60"
      :aria-expanded="open"
      @click="open = !open"
    >
      <span class="absolute inset-y-2.5 left-0 w-[3px] rounded-full" :class="status.rail" />

      <img
        v-if="event.image"
        :src="`/api/image?path=${encodeURIComponent(event.image)}`"
        alt=""
        loading="lazy"
        class="h-14 w-10 shrink-0 rounded-md object-cover ring-1 ring-default sm:h-16 sm:w-11"
      >
      <div
        v-else
        class="grid h-14 w-10 shrink-0 place-items-center rounded-md bg-elevated text-xs text-muted ring-1 ring-default sm:h-16 sm:w-11"
      >
        ?
      </div>

      <div class="min-w-0 flex-1">
        <div class="flex flex-wrap items-center gap-2">
          <h3 class="min-w-0 truncate text-[15px] font-semibold tracking-tight text-highlighted">{{ derived.main }}</h3>
          <UBadge
            :color="event.media_type === 'movie' ? 'info' : 'primary'"
            variant="subtle"
            size="sm"
            :label="event.media_type ?? 'unknown'"
          />
          <!-- Below sm the status pill joins this row instead of sitting
               in a right-hand column that would starve the title. -->
          <UBadge
            class="sm:hidden"
            :color="status.color"
            variant="subtle"
            size="sm"
            :label="status.label"
          />
        </div>

        <div v-if="derived.sub" class="mt-0.5 truncate text-sm text-muted">{{ derived.sub }}</div>

        <div class="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-dimmed">
          <span>{{ event.username }}</span>
          <code class="rounded bg-elevated px-1.5 py-0.5 font-mono text-[11px] ring-1 ring-default">{{ matchedBy }}</code>
          <span class="sm:hidden">{{ timeAgo }}</span>
        </div>
      </div>

      <div class="hidden shrink-0 flex-col items-end gap-1.5 pr-1 sm:flex">
        <UBadge :color="status.color" variant="subtle" size="sm" :label="status.label" />
        <span class="text-xs text-dimmed">{{ timeAgo }}</span>
      </div>
    </button>

    <!-- bg-default is darker than the card, matching the old bg-black/30 well. -->
    <div v-if="open" class="bg-default px-4 pb-4">
      <UAlert v-if="event.error" color="error" variant="subtle" class="mb-2 mt-3" :description="event.error" />
      <div class="mb-1 pt-3 text-xs text-dimmed">
        rating_key {{ event.rating_key }} · event {{ event.event }} · ids: {{ event.ids.join(', ') || 'none' }}
      </div>
      <!-- Ringed, because the panel behind it is already bg-default. -->
      <pre class="max-h-64 overflow-auto rounded-lg bg-default p-3 text-xs ring-1 ring-default">{{ pretty }}</pre>
    </div>
  </div>
</template>
