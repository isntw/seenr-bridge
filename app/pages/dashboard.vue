<script setup lang="ts">
import type { ScrobbleEvent, Stats } from '../../shared/types'

const limit = ref(25)

const { data: stats, refresh: refreshStats } = await useAsyncData<Stats>(
  'stats',
  () => $fetch('/api/stats'),
)

const { data: events, refresh: refreshEvents, error } = await useAsyncData<ScrobbleEvent[]>(
  'events',
  () => $fetch('/api/events', { query: { limit: limit.value } }),
  { watch: [limit] },
)

function refresh() {
  refreshStats()
  refreshEvents()
}

// Live view: the legacy dashboard polled every 5s.
let timer: ReturnType<typeof setInterval> | undefined
onMounted(() => { timer = setInterval(refresh, 5000) })
onBeforeUnmount(() => clearInterval(timer))

const tiles = computed(() => [
  { label: 'Total', icon: 'i-lucide-layers', value: stats.value?.total ?? '—', class: '' },
  { label: 'Episodes', icon: 'i-lucide-tv', value: stats.value?.episodes ?? '—', class: 'text-primary' },
  { label: 'Movies', icon: 'i-lucide-film', value: stats.value?.movies ?? '—', class: 'text-info' },
  { label: 'Users', icon: 'i-lucide-users', value: stats.value?.users ?? '—', class: 'text-success' },
])

const remaining = computed(() =>
  Math.max(0, (stats.value?.total ?? 0) - (events.value?.length ?? 0)),
)
</script>

<template>
  <div class="space-y-6">
    <!-- 2-up on phones, 4-up from sm. -->
    <div class="grid grid-cols-2 gap-4 sm:grid-cols-4">
      <UCard v-for="t in tiles" :key="t.label" :ui="{ body: 'px-4 py-3 sm:px-5 sm:py-4' }">
        <div class="flex items-center gap-2 text-xs uppercase tracking-wider text-muted">
          <UIcon :name="t.icon" class="size-4" />
          <span class="truncate">{{ t.label }}</span>
        </div>
        <div class="mt-2 text-2xl font-semibold sm:text-3xl" :class="t.class">{{ t.value }}</div>
      </UCard>
    </div>

    <UCard :ui="{ body: 'p-0 sm:p-0' }">
      <template #header>
        <div class="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 class="text-sm font-semibold">Recent scrobbles</h2>
            <p class="mt-0.5 text-xs text-muted">Live — refreshes every 5s</p>
          </div>
          <UButton
            color="neutral"
            variant="ghost"
            label="Refresh"
            icon="i-lucide-refresh-cw"
            class="min-h-11"
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

      <div v-if="!events?.length" class="px-4 py-12 text-center text-sm text-muted">
        No scrobbles yet. Point a Tautulli webhook at
        <code class="text-default">/api/webhook/tautulli</code> and play something.
      </div>

      <div v-else class="divide-y divide-default">
        <EventRow v-for="e in events" :key="e.id" :event="e" />
      </div>

      <template v-if="remaining > 0" #footer>
        <div class="text-center">
          <UButton
            color="neutral"
            variant="ghost"
            class="min-h-11"
            :label="`Load more · ${remaining} older`"
            @click="limit += 25"
          />
        </div>
      </template>
    </UCard>
  </div>
</template>
