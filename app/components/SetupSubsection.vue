<script setup lang="ts">
// A labelled job inside a SetupStep card. Step 1 holds two: Connection and
// Event webhook. Each carries its own status pill and ends in its own action
// row, which is what stops two primary buttons in one card from reading as
// ambiguous.
defineProps<{
  label: string
  status?: 'ok' | 'bad' | 'pending' | null
  statusText?: string
  seam?: boolean
}>()
</script>

<template>
  <div :class="seam ? 'border-t border-default pt-5' : ''">
    <div class="mb-3 flex flex-wrap items-center gap-2">
      <h3 class="text-xs font-semibold uppercase tracking-wider text-muted">{{ label }}</h3>
      <UBadge
        v-if="status && statusText"
        :color="status === 'ok' ? 'success' : status === 'bad' ? 'error' : 'neutral'"
        variant="subtle"
        size="sm"
        :label="statusText"
      />
    </div>
    <div class="space-y-4">
      <slot />
    </div>
  </div>
</template>
