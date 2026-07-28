<script setup lang="ts">
const props = defineProps<{ state: string }>()

const kind = computed(() => {
  switch ((props.state || '').toLowerCase()) {
    case 'playing': return { icon: 'i-lucide-play', color: 'text-success', pulses: true }
    case 'buffering': return { icon: 'i-lucide-loader-circle', color: 'text-info', pulses: true }
    case 'paused': return { icon: 'i-lucide-pause', color: 'text-warning', pulses: false }
    default: return { icon: 'i-lucide-circle-dot', color: 'text-dimmed', pulses: false }
  }
})
</script>

<template>
  <UIcon
    :name="kind.icon"
    class="size-3 shrink-0"
    :class="[kind.color, kind.pulses ? 'animate-pulse motion-reduce:animate-none' : '']"
    :aria-label="state"
  />
</template>
