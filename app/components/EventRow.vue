<script setup lang="ts">
import type { EventGroup, EventRecipient } from '../utils/event-group'
import { timeAgo as timeAgoOf } from '../utils/time-ago'

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

const eventType = computed(() => props.group.action || props.group.event || 'unknown')

// One banner at the top of the panel rather than an alert nested under each recipient.
// A group's recipients almost always fail for the SAME reason — the whole fan-out hits
// one disabled setting or one unreachable seenr — so the old placement repeated the
// identical sentence once per person, each time below a payload dump.
const reasons = computed(() => {
  const errored = props.group.recipients.filter((r) => r.error)
  if (!errored.length) return null

  const distinct = [...new Set(errored.map((r) => r.error!))]
  // Name the person only when the group disagrees. "alice: seenr HTTP 401" on a row with
  // one recipient just repeats the badge two lines above it.
  const lines =
    distinct.length === 1 && errored.length === props.group.recipients.length
      ? distinct
      : errored.map((r) => `${r.username ?? 'unknown'}: ${r.error}`)

  // Same three-way reading as the badges: a decline is neutral, a lost forward is red,
  // and an error on a delivery that DID reach seenr can only be the Plex write — amber.
  const color = errored.every((r) => r.skipped)
    ? ('neutral' as const)
    : errored.some((r) => !r.ok)
      ? ('error' as const)
      : ('warning' as const)

  return { lines, color, icon: color === 'neutral' ? 'i-lucide-info' : 'i-lucide-triangle-alert' }
})

// "synced", not "checked in": the master switch is called Syncing and a declined row
// says "Syncing is disabled in settings", so the success state is the past tense of the
// same verb. It also covers the Plex write, which that switch gates too — "checked in"
// only ever described the seenr half.
const status = computed(() => {
  const total = props.group.recipients.length
  const ok = props.group.okCount
  const skipped = props.group.skippedCount
  if (ok === total) return { label: total > 1 ? `synced · ${total}` : 'synced', color: 'success' as const }
  // Neutral, and checked before the failure branch: a watch the bridge was configured
  // to decline is not a failure, and colouring it red sends the operator looking for a
  // fault that does not exist. The reason is on the row, so it stays diagnosable.
  if (skipped === total) return { label: 'skipped', color: 'neutral' as const }
  if (ok === 0) return { label: 'failed', color: 'error' as const }
  return { label: `${ok} of ${total} synced`, color: 'warning' as const }
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

const timeAgo = computed(() => timeAgoOf(props.group.ts))

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
  const seenr = r.ok
    ? 'synced'
    : r.skipped
      ? 'skipped'
      : r.seenr_status ? `seenr ${r.seenr_status}` : 'failed'
  if (r.plex_status === null) return seenr
  return `${seenr} · ${plexOk(r) ? 'marked in Plex' : `Plex ${r.plex_status}`}`
}

// Four states, not two. `ok` tracks the seenr forward alone — deliberately, so a Plex
// hiccup can't inflate the Dashboard's failure count — but a green badge on a delivery
// whose Plex write failed would hide it behind a tooltip nobody hovers. Warning is the
// honest middle: seenr landed, Plex did not. Neutral is a configured decline, which is
// neither.
function recipientColor(r: EventRecipient) {
  if (r.skipped) return 'neutral'
  if (!r.ok) return 'error'
  return r.plex_status !== null && !plexOk(r) ? 'warning' : 'success'
}

function recipientIcon(r: EventRecipient) {
  if (r.ok) return 'i-lucide-check'
  // A dash, not a cross: nothing went wrong here, the bridge just did not act.
  return r.skipped ? 'i-lucide-minus' : 'i-lucide-x'
}
</script>

<template>
  <UCollapsible v-model:open="open">
    <UButton block color="neutral" variant="ghost" size="xl" class="p-3">
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
          <!-- The media type lives in the panel now, on the detail line beside the
               rating_key: the poster already says which it is, and as a badge it took the
               primary colour and so read like one of the recipient badges below. -->
          <UBadge color="neutral" variant="subtle" size="sm" :label="eventType" />
          <!-- Absent, not greyed, when no Plex write was attempted — otherwise every
               ordinary watch would carry a Plex label. -->
          <PlexBadge
            v-if="plexState"
            :label="plexState.label"
            :tone="plexState.ok ? 'gold' : 'warning'"
            :title="plexState.title"
          />
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
            :leading-icon="recipientIcon(r)"
            :trailing-icon="r.plex_status !== null ? 'i-lucide-clapperboard' : undefined"
            :label="r.username ?? 'unknown'"
            :title="`${r.username ?? 'unknown'}: ${recipientStatus(r)}`"
          />

          <!-- The matched id was a duplicate: the panel lists every external id it
               resolved, this chip only ever showed the tmdb one of them. -->
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
        <!-- Why nothing (or not everything) happened, once, at the top — the first thing
             you want when you opened a row that is not green. -->
        <UAlert
          v-if="reasons"
          :color="reasons.color"
          :icon="reasons.icon"
          variant="subtle"
          class="mt-3"
        >
          <template #description>
            <div v-for="line in reasons.lines" :key="line">{{ line }}</div>
          </template>
        </UAlert>

        <div class="pt-3 text-xs text-dimmed">
          rating_key {{ group.rating_key }} · {{ group.media_type ?? '—' }} ·
          {{ group.action ?? '—' }} · {{ group.event ?? '—' }}
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
                :color="recipientColor(r)"
                variant="subtle"
                size="sm"
                :label="recipientStatus(r)"
              />
            </div>
            <pre class="max-h-64 overflow-auto rounded-lg bg-default p-3 text-xs ring-1 ring-default">{{ pretty(r.payload) }}</pre>
          </div>
        </div>
      </div>
    </template>
  </UCollapsible>
</template>
