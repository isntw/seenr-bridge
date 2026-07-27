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
  <!-- The seam is the ONE rule inside a SetupStep card. Action rows deliberately
       carry no border of their own, so this needs symmetric space on both sides:
       mt-6 puts air between the previous sub-section's buttons and the rule,
       pt-6 between the rule and this sub-section's label. -->
  <div :class="seam ? 'mt-6 border-t border-default pt-6' : ''">
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
