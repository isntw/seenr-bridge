<script setup lang="ts">
defineProps<{
  label: string
  status?: 'ok' | 'warn' | 'bad' | 'pending' | null
  statusText?: string
  seam?: boolean
  collapsible?: boolean
  startOpen?: boolean
  summary?: string
}>()
</script>

<template>
  <div>
    <USeparator v-if="seam" class="my-6" />
    <!-- unmount-on-hide=false keeps half-typed credentials and the library checkbox
         state alive across a fold; the default would discard them. -->
    <UCollapsible v-if="collapsible" :default-open="!!startOpen" :unmount-on-hide="false">
      <template #default="{ open }">
        <UButton
          block
          color="neutral"
          variant="ghost"
          size="sm"
          :class="open ? 'mb-3' : ''"
        >
          <span class="flex min-w-0 flex-1 items-center gap-2 text-left">
            <UIcon
              name="i-lucide-chevron-right"
              class="size-3.5 shrink-0 text-muted transition-transform"
              :class="open ? 'rotate-90' : ''"
            />
            <h3 class="text-xs font-semibold uppercase tracking-wider text-muted">{{ label }}</h3>
            <UBadge
              v-if="status && statusText"
              :color="status === 'ok' ? 'success' : status === 'warn' ? 'warning' : status === 'bad' ? 'error' : 'neutral'"
              variant="subtle"
              size="sm"
              :label="statusText"
            />
            <span v-if="!open && summary" class="ml-auto min-w-0 truncate pl-2 text-xs text-dimmed">
              {{ summary }}
            </span>
          </span>
        </UButton>
      </template>

      <template #content>
        <div class="space-y-4">
          <slot />
        </div>
      </template>
    </UCollapsible>

    <template v-else>
      <div class="mb-3 flex flex-wrap items-center gap-2">
        <h3 class="text-xs font-semibold uppercase tracking-wider text-muted">{{ label }}</h3>
        <UBadge
          v-if="status && statusText"
          :color="status === 'ok' ? 'success' : status === 'warn' ? 'warning' : status === 'bad' ? 'error' : 'neutral'"
          variant="subtle"
          size="sm"
          :label="statusText"
        />
      </div>

      <div class="space-y-4">
        <slot />
      </div>
    </template>
  </div>
</template>
