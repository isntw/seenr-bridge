<script setup lang="ts">
import { VERSION } from '../../shared/version'

// The version and the Tautulli indicator, shared by the desktop rail and the mobile
// slideover. It lives in one component because it previously did not: the rail had both
// and the slideover had only a version line, so the mobile menu quietly lacked the
// connection status that is the whole point of glancing at the nav.
const status = useStatusStore()

const color = computed(() =>
  status.tautulli === null ? 'neutral' : status.tautulli.ok ? 'success' : 'error',
)
const label = computed(() =>
  status.tautulli === null
    ? 'Checking Tautulli…'
    : status.tautulli.ok
      ? 'Tautulli connected'
      : 'Tautulli unreachable',
)
</script>

<template>
  <div>
    <div class="mb-2.5 text-center text-[11px] text-dimmed">v{{ VERSION }}</div>
    <div class="flex items-center gap-2 rounded-lg bg-elevated px-3 py-2.5">
      <UChip standalone inset size="xs" :color="color" />
      <span class="truncate text-xs text-muted">{{ label }}</span>
    </div>
  </div>
</template>
