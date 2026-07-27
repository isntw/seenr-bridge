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
        <!-- One flex-1 child, so `block`'s justify-center always has something to
             absorb the space. The summary alone cannot: it is sm:block, so on a
             phone — or on any card with no summary — the header would centre. -->
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
