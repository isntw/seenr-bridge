<script setup lang="ts">
import type {
  ActivitySession, Mapping, PendingWatchEntry, ScrobbleEvent, SharedTitle, Stats,
} from '../../shared/types'

const limit = ref(25)

const { data: stats, refresh: refreshStats, status: statsStatus } = useAsyncData<Stats>(
  'stats',
  () => $fetch('/api/stats'),
  { lazy: true },
)

const { data: events, refresh: refreshEvents, error, status: eventsStatus } = useAsyncData<ScrobbleEvent[]>(
  'events',
  () => $fetch('/api/events', { query: { limit: limit.value } }),
  { watch: [limit], lazy: true },
)

const { data: activity, refresh: refreshActivity } = useAsyncData<ActivitySession[]>(
  'activity',
  () => $fetch('/api/tautulli/activity'),
  { default: (): ActivitySession[] => [], lazy: true },
)

const { data: mappings } = useAsyncData<Mapping[]>(
  'mappings',
  () => $fetch('/api/mappings'),
  { default: (): Mapping[] => [], lazy: true },
)

const { data: shares, refresh: refreshShares } = useAsyncData<SharedTitle[]>(
  'shares',
  () => $fetch('/api/shared'),
  { default: (): SharedTitle[] => [], lazy: true },
)

const { data: pending, refresh: refreshPending } = useAsyncData<PendingWatchEntry[]>(
  'pending',
  () => $fetch('/api/pending'),
  { default: (): PendingWatchEntry[] => [], lazy: true },
)

function refreshWatchTogether() {
  refreshActivity()
  refreshShares()
  refreshPending()
}

const loading = isFirstLoad(statsStatus, eventsStatus)

function refresh() {
  refreshStats()
  refreshEvents()
  refreshActivity()
}

let timer: ReturnType<typeof setInterval> | undefined
onMounted(() => { timer = setInterval(refresh, 5000) })
onBeforeUnmount(() => clearInterval(timer))

const tiles = computed(() => [
  { label: 'Total', icon: 'i-lucide-layers', value: stats.value?.total ?? '—', class: 'text-highlighted' },
  { label: 'Episodes', icon: 'i-lucide-tv', value: stats.value?.episodes ?? '—', class: 'text-primary-300' },
  { label: 'Movies', icon: 'i-lucide-film', value: stats.value?.movies ?? '—', class: 'text-info-300' },
  { label: 'Users', icon: 'i-lucide-users', value: stats.value?.users ?? '—', class: 'text-success-300' },
])

const groups = computed(() => groupEvents(events.value ?? []))

const remaining = computed(() =>
  Math.max(0, (stats.value?.total ?? 0) - (events.value?.length ?? 0)),
)
</script>

<template>
  <div class="space-y-6">
    <div class="grid grid-cols-2 gap-4 sm:grid-cols-4">
      <UCard v-for="t in tiles" :key="t.label">
        <div class="flex items-center gap-2 text-xs uppercase tracking-wider text-muted">
          <UIcon :name="t.icon" class="size-4 text-dimmed" />
          <span class="truncate">{{ t.label }}</span>
        </div>
        <USkeleton v-if="loading" class="mt-2 h-8 w-14 sm:h-9" />
        <div v-else class="mt-2 text-2xl font-semibold sm:text-3xl" :class="t.class">{{ t.value }}</div>
      </UCard>
    </div>

    <!-- Absent rather than empty when nothing plays: an idle card would sit here permanently. -->
    <NowPlaying
      :sessions="activity ?? []"
      :mappings="mappings ?? []"
      :shares="shares ?? []"
      :pending="pending ?? []"
      @changed="refreshWatchTogether()"
    />

    <UCard :ui="{ body: 'p-0 sm:p-0' }">
      <template #header>
        <div class="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 class="text-sm font-semibold tracking-wide text-highlighted">Recent scrobbles</h2>
            <p class="mt-0.5 text-xs text-muted">Live — refreshes every 5s</p>
          </div>
          <UButton
            color="neutral"
            variant="subtle"
            label="Refresh"
            icon="i-lucide-refresh-cw"
            @click="refresh"
          />
        </div>
      </template>

      <UAlert
        v-if="error"
        color="error"
        variant="subtle"
        class="m-4"
        :description="error.message"
      />

      <ListRowsSkeleton v-if="loading" :rows="4" />

      <div v-else-if="!events?.length" class="px-4 py-12 text-center text-sm text-muted">
        No scrobbles yet. Point a Tautulli webhook at
        <code class="text-default">/api/webhook/tautulli</code> and play something.
      </div>

      <div v-else class="divide-y divide-muted">
        <EventRow v-for="g in groups" :key="g.key" :group="g" />
      </div>

      <template v-if="remaining > 0" #footer>
        <div class="text-center">
          <UButton
            color="neutral"
            variant="subtle"
            :label="`Load more · ${remaining} older`"
            @click="limit += 25"
          />
        </div>
      </template>
    </UCard>
  </div>
</template>
