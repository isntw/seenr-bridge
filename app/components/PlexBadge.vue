<script setup lang="ts">
// The gold Plex mark, shared by the Shared page rows and the Dashboard event rows so
// "this touches Plex" looks the same wherever it appears. Extracted because it is now
// needed twice in one row — inline on a phone, in the right-hand column from `sm` up —
// and a third time on the Dashboard.
//
// Plex's own brand gold rather than a theme colour: the badge means "writes outside the
// bridge", so it must not blend into the violet badges beside it. `warning` is for the
// Dashboard's failed-write case, where amber is the point. The chevron is inlined as SVG
// because @iconify-json/simple-icons would be a whole collection for one glyph, and only
// lucide is installed.
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
