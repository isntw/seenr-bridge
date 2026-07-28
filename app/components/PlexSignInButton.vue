<script setup lang="ts">
// Plex's own sign-in treatment, extracted so the brand values live in exactly one
// place. #EBAF00 with black text is Plex's, not ours, and must not follow the violet
// app theme — which is also why it is hardcoded rather than themed. The chevron is
// inlined instead of pulling in @iconify-json/simple-icons for a single glyph; only
// `lucide` is installed.
defineProps<{ loading?: boolean; label?: string }>()
</script>

<template>
  <UButton
    :loading="loading"
    class="bg-[#EBAF00] font-semibold text-black hover:bg-[#f5bd1f] focus-visible:outline-[#EBAF00] disabled:bg-[#EBAF00]/60"
  >
    <template v-if="!loading" #leading>
      <svg viewBox="0 0 32 32" class="size-4 shrink-0" aria-hidden="true">
        <path fill="currentColor" d="M15.527 0H6.24l10.239 16L6.24 32h9.287L25.76 16z" />
      </svg>
    </template>
    {{ label ?? 'Sign in with Plex' }}
  </UButton>
</template>
