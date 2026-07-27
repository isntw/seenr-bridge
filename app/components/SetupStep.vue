<script setup lang="ts">
defineProps<{ n: number; title: string; hint?: string; badge?: string }>()
</script>

<template>
  <UCard>
    <template #header>
      <div class="flex items-start gap-3">
        <span class="grid size-6 shrink-0 place-items-center rounded-full bg-primary-600 text-xs font-semibold text-white">
          {{ n }}
        </span>
        <div class="min-w-0 flex-1">
          <h2 class="text-sm font-semibold text-highlighted">{{ title }}</h2>
          <p v-if="hint" class="mt-0.5 text-xs text-dimmed">{{ hint }}</p>
        </div>
        <UBadge
          v-if="badge"
          color="neutral"
          variant="subtle"
          size="sm"
          class="mt-0.5 shrink-0"
          :label="badge"
        />
      </div>
    </template>
    <slot />
  </UCard>
</template>
