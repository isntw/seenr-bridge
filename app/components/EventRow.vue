<script setup lang="ts">
import type { EventGroup, EventRecipient } from '../utils/event-group'

// One watch, not one delivery. A co-watched title forwards to every assigned
// profile and records a row each, so this renders the group and lists who
// received it — see app/utils/event-group.ts.
const props = defineProps<{ group: EventGroup }>()
const open = ref(false)

const derived = computed(() => {
  let main = props.group.title || 'Unknown'
  let sub = ''
  // Every recipient's payload describes the same media and differs only in the
  // target account, so the first is enough to read the title and episode from.
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
    // Malformed payload — fall back to the stored title.
  }
  return { main, sub }
})

const matchedBy = computed(() => {
  const ids = props.group.ids
  if (!ids?.length) return 'no ext id'
  return (ids.find((i) => i.startsWith('tmdb://')) || ids[0]!).replace('://', ' ')
})

/** What Tautulli called it — `watched`, `play`, `stop`, … falling back to the
 *  Plex event name the payload was built with. */
const eventType = computed(() => props.group.action || props.group.event || 'unknown')

// The group's headline status. Deliveries fail independently, so "some worked" is
// a real state and gets its own wording rather than being rounded to ok or failed.
const status = computed(() => {
  const total = props.group.recipients.length
  const ok = props.group.okCount
  if (ok === total) return { label: total > 1 ? `checked in · ${total}` : 'checked in', color: 'success' as const }
  if (ok === 0) return { label: 'failed', color: 'error' as const }
  return { label: `${ok} of ${total} checked in`, color: 'warning' as const }
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

function recipientStatus(r: EventRecipient) {
  if (r.ok) return 'checked in'
  return r.seenr_status ? `seenr ${r.seenr_status}` : 'failed'
}
</script>

<template>
  <!-- unmountOnHide left at its default here, unlike SetupSubsection: the panel is
       read-only detail, so there is no input state to preserve, and keeping every
       row's payload <pre> mounted would mean rendering up to 1000 of them. -->
  <UCollapsible v-model:open="open">
    <!-- Props only, no classes: the row takes UButton's own padding, gap, radius,
         hover and focus ring. `block` supplies w-full, and its justify-center is
         moot because the title block below is flex-1 and absorbs the space — which
         is what makes a zero-override row possible at all.
         as-child makes this the collapsible trigger, so reka-ui owns aria-expanded
         and pairs it with aria-controls. -->
    <UButton block color="neutral" variant="ghost" size="xl">
      <img
        v-if="group.image"
        :src="`/api/image?path=${encodeURIComponent(group.image)}`"
        alt=""
        loading="lazy"
        class="h-[72px] w-12 shrink-0 rounded-md object-cover ring-1 ring-default"
      >
      <div v-else class="h-[72px] w-12 shrink-0 rounded-md bg-elevated ring-1 ring-default" />

      <div class="min-w-0 flex-1">
        <div class="flex flex-wrap items-center gap-2">
          <h3 class="min-w-0 truncate text-sm font-medium text-highlighted">{{ derived.main }}</h3>
          <UBadge
            :color="group.media_type === 'movie' ? 'info' : 'primary'"
            variant="subtle"
            size="sm"
            :label="group.media_type ?? 'unknown'"
          />
          <UBadge color="neutral" variant="subtle" size="sm" :label="eventType" />
          <!-- Below sm the status pill joins this row instead of sitting in a
               right-hand column that would starve the title. -->
          <UBadge class="sm:hidden" :color="status.color" variant="subtle" size="sm" :label="status.label" />
        </div>

        <div v-if="derived.sub" class="mt-0.5 truncate text-xs text-muted">{{ derived.sub }}</div>

        <!-- Who received it. Each carries its own colour because one profile can
             be accepted while another is rejected. UBadge rather than a hand-rolled
             pill, so these sit on the same sizing scale as the media/event badges
             above instead of a one-off 11px. -->
        <div class="mt-1.5 flex flex-wrap items-center gap-1.5">
          <UBadge
            v-for="r in group.recipients"
            :key="r.id"
            :color="r.ok ? 'success' : 'error'"
            variant="subtle"
            size="sm"
            :leading-icon="r.ok ? 'i-lucide-check' : 'i-lucide-x'"
            :label="r.username ?? 'unknown'"
            :title="`${r.username ?? 'unknown'}: ${recipientStatus(r)}`"
          />

          <!-- `as="code"` keeps it marked up as the raw value it quotes. -->
          <UBadge as="code" color="neutral" variant="subtle" size="sm" class="font-mono" :label="matchedBy" />
          <span class="text-xs text-dimmed sm:hidden">{{ timeAgo }}</span>
        </div>
      </div>

      <div class="hidden shrink-0 flex-col items-end gap-1.5 sm:flex">
        <UBadge :color="status.color" variant="subtle" size="sm" :label="status.label" />
        <span class="text-xs text-dimmed">{{ timeAgo }}</span>
      </div>

      <!-- Rotates rather than pointing right: this row expands in place, the same
           idiom DisclosureCard uses. -->
      <UIcon
        name="i-lucide-chevron-right"
        class="size-4 shrink-0 text-dimmed transition-transform"
        :class="open ? 'rotate-90' : ''"
      />
    </UButton>

    <template #content>
      <!-- bg-default is darker than the card, matching the old bg-black/30 well. -->
      <div class="bg-default px-4 pb-4 sm:px-5">
        <div class="pt-3 text-xs text-dimmed">
          rating_key {{ group.rating_key }} · {{ group.action ?? '—' }} ·
          {{ group.event ?? '—' }}
        </div>

        <!-- The ids were the reason that line ran on: three of them, each long
             enough to wrap, inside a sentence. As badges they wrap as units and
             stay individually readable — and they are the part you actually came
             here to check, since a wrong id is the bug this bridge exists to fix. -->
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

        <!-- One block per recipient: each had its own HTTP call, its own status and
             its own error, so collapsing them would hide which profile broke. -->
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
            <!-- Ringed, because the panel behind it is already bg-default. -->
            <pre class="max-h-64 overflow-auto rounded-lg bg-default p-3 text-xs ring-1 ring-default">{{ pretty(r.payload) }}</pre>
          </div>
        </div>
      </div>
    </template>
  </UCollapsible>
</template>
