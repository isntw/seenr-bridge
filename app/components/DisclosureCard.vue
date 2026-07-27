<script setup lang="ts">
const open = defineModel<boolean>('open', { default: false })

defineProps<{ title: string; summary?: string }>()
</script>

<template>
  <UCard :ui="{ body: 'p-0 sm:p-0' }">
    <UCollapsible v-model:open="open">
      <UButton block color="neutral" variant="ghost" size="xl">
        <span class="flex min-w-0 flex-1 items-center gap-2 text-left">
          <UIcon
            name="i-lucide-chevron-right"
            class="size-4 shrink-0 text-muted transition-transform"
            :class="open ? 'rotate-90' : ''"
          />
          <span class="text-sm font-semibold text-highlighted">{{ title }}</span>
          <span v-if="summary" class="ml-auto hidden min-w-0 truncate text-xs text-dimmed sm:block">
            {{ summary }}
          </span>
        </span>
      </UButton>
      <template #content>
        <USeparator />
        <div class="space-y-4 p-5">
          <slot />
        </div>
      </template>
    </UCollapsible>
  </UCard>
</template>
