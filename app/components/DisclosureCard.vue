<script setup lang="ts">
// The page-level collapsible idiom: a card whose header IS the toggle. Extracted
// from three inline copies in settings.vue. Manual setup deliberately does not
// use this — it renders chrome-less inside step 1 so it reads as part of the
// adjacent Sync action rather than as another page-level section.
const open = defineModel<boolean>('open', { default: false })

defineProps<{ title: string; summary?: string }>()
</script>

<template>
  <UCard :ui="{ body: 'p-0 sm:p-0' }">
    <UCollapsible v-model:open="open">
      <!-- Props only, matching the other two collapsible triggers. `block` supplies
           w-full; the padding and gap are the component's. -->
      <UButton block color="neutral" variant="ghost" size="xl">
        <UIcon
          name="i-lucide-chevron-right"
          class="size-4 shrink-0 text-muted transition-transform"
          :class="open ? 'rotate-90' : ''"
        />
        <span class="text-sm font-semibold text-highlighted">{{ title }}</span>
        <span v-if="summary" class="ml-auto hidden text-xs text-dimmed sm:block">{{ summary }}</span>
      </UButton>
      <template #content>
        <div class="space-y-4 border-t border-default p-5">
          <slot />
        </div>
      </template>
    </UCollapsible>
  </UCard>
</template>
