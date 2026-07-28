<script setup lang="ts">
// The live signal for the Now playing card. It reports Tautulli's session state
// rather than just "something is on": a pulse next to a paused stream would be a
// lie, and paused-vs-playing is the thing worth knowing at a glance.
//
// The pulse is a ring BEHIND the dot (Tailwind's animate-ping: scale + fade), not
// an opacity blink on the dot itself, so the dot's own colour stays readable at
// every frame. `motion-reduce:animate-none` leaves a solid dot when the viewer has
// asked for less motion — the state still reads, from the colour and from the word
// the card prints beside it.
const props = defineProps<{ state: string }>()

const kind = computed(() => {
  switch ((props.state || '').toLowerCase()) {
    case 'playing': return { color: 'success' as const, ping: 'bg-success', pulses: true }
    case 'buffering': return { color: 'info' as const, ping: 'bg-info', pulses: true }
    case 'paused': return { color: 'warning' as const, ping: '', pulses: false }
    default: return { color: 'neutral' as const, ping: '', pulses: false }
  }
})
</script>

<template>
  <span class="relative inline-flex items-center justify-center">
    <span
      v-if="kind.pulses"
      class="absolute size-1.5 animate-ping rounded-full opacity-75 motion-reduce:animate-none"
      :class="kind.ping"
      aria-hidden="true"
    />
    <UChip standalone inset size="xs" :color="kind.color" />
  </span>
</template>
