<script setup lang="ts">
import type { EventGroup, EventRecipient } from '../utils/event-group'

const props = defineProps<{ group: EventGroup }>()
const open = ref(false)

const derived = computed(() => {
  let main = props.group.title || 'Unknown'
  let sub = ''
  const raw = props.group.recipients[0]?.payload
  try {
    const m = raw ? JSON.parse(raw).Metadata : null
    if (m) {
      if (props.group.media_type === 'episode') {
        main = m.grandparentTitle || props.group.title || 'Unknown'
        sub = `S${m.parentIndex || '?'}·E${m.index || '?'}${m.title ? '  ·  ' + m.title : ''}`
      } else {
        main = m.title || props.group.title || 'Unknown'
        sub = String(m.year || '')
      }
    }
  } catch {
  }
  return { main, sub }
})

const matchedBy = computed(() => {
  const ids = props.group.ids
  if (!ids?.length) return 'no ext id'
  return (ids.find((i) => i.startsWith('tmdb://')) || ids[0]!).replace('://', ' ')
})

const eventType = computed(() => props.group.action || props.group.event || 'unknown')

const status = computed(() => {
  const total = props.group.recipients.length
  const ok = props.group.okCount
  if (ok === total) return { label: total > 1 ? `checked in · ${total}` : 'checked in', color: 'success' as const }
  if (ok === 0) return { label: 'failed', color: 'error' as const }
  return { label: `${ok} of ${total} checked in`, color: 'warning' as const }
})

// Whether this watch reached Plex at all, and whether every attempt landed. Null when
// no recipient had a Plex write attempted, which is the ordinary case for an unshared
// watch and must stay unlabelled rather than showing a "no Plex" badge on every row.
const plexState = computed(() => {
  const attempted = props.group.recipients.filter((r) => r.plex_status !== null)
  if (!attempted.length) return null
  const failed = attempted.filter((r) => !plexOk(r)).length
  if (!failed) return { label: 'Plex', ok: true, title: `Marked watched in Plex for ${attempted.length === 1 ? '1 profile' : `${attempted.length} profiles`}` }
  return { label: `Plex ${failed} failed`, ok: false, title: `${failed} of ${attempted.length} Plex writes failed` }
})

const timeAgo = computed(() => {
  const s = Math.floor((Date.now() - props.group.ts) / 1000)
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return new Date(props.group.ts).toLocaleDateString()
})

function pretty(payload: string | null) {
  if (!payload) return '(no payload)'
  try {
    return JSON.stringify(JSON.parse(payload), null, 2)
  } catch {
    return payload
  }
}

function plexOk(r: EventRecipient) {
  return r.plex_status !== null && r.plex_status >= 200 && r.plex_status < 300
}

function recipientStatus(r: EventRecipient) {
  const seenr = r.ok ? 'checked in' : r.seenr_status ? `seenr ${r.seenr_status}` : 'failed'
  if (r.plex_status === null) return seenr
  return `${seenr} · ${plexOk(r) ? 'marked in Plex' : `Plex ${r.plex_status}`}`
}

// Three states, not two. `ok` tracks the seenr forward alone — deliberately, so a Plex
// hiccup can't inflate the Dashboard's failure count — but a green badge on a delivery
// whose Plex write failed would hide it behind a tooltip nobody hovers. Warning is the
// honest middle: seenr landed, Plex did not.
function recipientColor(r: EventRecipient) {
  if (!r.ok) return 'error'
  return r.plex_status !== null && !plexOk(r) ? 'warning' : 'success'
}
</script>

<template>
  <UCollapsible v-model:open="open">
    <UButton block color="neutral" variant="ghost" size="xl">
      <img
        v-if="group.image"
        :src="`/api/image?path=${encodeURIComponent(group.image)}`"
        alt=""
        loading="lazy"
        class="h-[72px] w-12 shrink-0 rounded-md object-cover ring-1 ring-default"
      >
      <div v-else class="h-[72px] w-12 shrink-0 rounded-md bg-elevated ring-1 ring-default" />

      <div class="min-w-0 flex-1 text-left">
        <div class="flex flex-wrap items-center gap-2">
          <h3 class="min-w-0 truncate text-sm font-medium text-highlighted">{{ derived.main }}</h3>
          <UBadge
            :color="group.media_type === 'movie' ? 'info' : 'primary'"
            variant="subtle"
            size="sm"
            :label="group.media_type ?? 'unknown'"
          />
          <UBadge color="neutral" variant="subtle" size="sm" :label="eventType" />
          <!-- Same gold Plex badge as the Shared page, so "this reached Plex" looks the
               same wherever it appears. Absent, not greyed, when no Plex write was
               attempted — otherwise every ordinary watch would carry a Plex label. -->
          <UBadge
            v-if="plexState"
            variant="subtle"
            size="sm"
            :class="plexState.ok
              ? 'bg-[#EBAF00]/10 text-[#EBAF00] ring-[#EBAF00]/30'
              : 'bg-warning/10 text-warning ring-warning/30'"
            :title="plexState.title"
          >
            <svg viewBox="0 0 32 32" class="size-3 shrink-0" aria-hidden="true">
              <path fill="currentColor" d="M15.527 0H6.24l10.239 16L6.24 32h9.287L25.76 16z" />
            </svg>
            {{ plexState.label }}
          </UBadge>
          <UBadge class="sm:hidden" :color="status.color" variant="subtle" size="sm" :label="status.label" />
        </div>

        <div v-if="derived.sub" class="mt-0.5 truncate text-xs text-muted">{{ derived.sub }}</div>

        <div class="mt-1.5 flex flex-wrap items-center gap-1.5">
          <UBadge
            v-for="r in group.recipients"
            :key="r.id"
            :color="recipientColor(r)"
            variant="subtle"
            size="sm"
            :leading-icon="r.ok ? 'i-lucide-check' : 'i-lucide-x'"
            :trailing-icon="r.plex_status !== null ? 'i-lucide-clapperboard' : undefined"
            :label="r.username ?? 'unknown'"
            :title="`${r.username ?? 'unknown'}: ${recipientStatus(r)}`"
          />

          <UBadge as="code" color="neutral" variant="subtle" size="sm" class="font-mono" :label="matchedBy" />
          <span class="text-xs text-dimmed sm:hidden">{{ timeAgo }}</span>
        </div>
      </div>

      <div class="hidden shrink-0 flex-col items-end gap-1.5 sm:flex">
        <UBadge :color="status.color" variant="subtle" size="sm" :label="status.label" />
        <span class="text-xs text-dimmed">{{ timeAgo }}</span>
      </div>

      <UIcon
        name="i-lucide-chevron-right"
        class="size-4 shrink-0 text-dimmed transition-transform"
        :class="open ? 'rotate-90' : ''"
      />
    </UButton>

    <template #content>
      <div class="bg-default px-4 pb-4 sm:px-5">
        <div class="pt-3 text-xs text-dimmed">
          rating_key {{ group.rating_key }} · {{ group.action ?? '—' }} ·
          {{ group.event ?? '—' }}
        </div>

        <div class="mb-3 mt-1.5 flex flex-wrap gap-1.5">
          <UBadge
            v-for="id in group.ids"
            :key="id"
            as="code"
            color="neutral"
            variant="subtle"
            size="sm"
            class="font-mono"
            :label="id"
          />
          <span v-if="!group.ids.length" class="text-xs text-warning">no external ids</span>
        </div>

        <div class="space-y-3">
          <div v-for="r in group.recipients" :key="r.id">
            <div class="mb-2.5 flex flex-wrap items-center gap-2">
              <span class="text-xs font-medium text-default">{{ r.username }}</span>
              <UBadge
                :color="r.ok ? 'success' : 'error'"
                variant="subtle"
                size="sm"
                :label="recipientStatus(r)"
              />
            </div>
            <UAlert v-if="r.error" color="error" variant="subtle" class="mb-2" :description="r.error" />
            <pre class="max-h-64 overflow-auto rounded-lg bg-default p-3 text-xs ring-1 ring-default">{{ pretty(r.payload) }}</pre>
          </div>
        </div>
      </div>
    </template>
  </UCollapsible>
</template>
