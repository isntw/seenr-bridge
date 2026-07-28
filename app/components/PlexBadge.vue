<script setup lang="ts">
withDefaults(
  defineProps<{
    label?: string
    tone?: 'gold' | 'warning'
  }>(),
  { label: 'Plex', tone: 'gold' },
)
</script>

<template>
  <UBadge
    variant="subtle"
    size="sm"
    :class="tone === 'gold'
      ? 'bg-[#EBAF00]/10 text-[#EBAF00] ring-[#EBAF00]/30'
      : 'bg-warning/10 text-warning ring-warning/30'"
  >
    <svg viewBox="0 0 32 32" class="size-3 shrink-0" aria-hidden="true">
      <path fill="currentColor" d="M15.527 0H6.24l10.239 16L6.24 32h9.287L25.76 16z" />
    </svg>
    {{ label }}
  </UBadge>
</template>
