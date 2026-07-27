<script setup lang="ts">
import type { Mapping } from '../../shared/types'
import type { SharedRow } from '../utils/shared-row'

defineProps<{
  row: SharedRow
  mappings: Mapping[]
}>()

defineEmits<{ edit: [] }>()

function assigned(mappings: Mapping[], profiles: number[]) {
  return mappings.filter((m) => profiles.includes(m.id))
}
</script>

<template>
  <UButton
    block
    color="neutral"
    variant="ghost"
    size="xl"
    :aria-label="`Edit ${row.title}`"
    @click="$emit('edit')"
  >
    <img
      v-if="row.poster"
      :src="row.poster"
      alt=""
      loading="lazy"
      class="h-[72px] w-12 shrink-0 rounded-md object-cover ring-1 ring-default"
    >
    <div v-else class="h-[72px] w-12 shrink-0 rounded-md bg-elevated ring-1 ring-default" />

    <div class="min-w-0 flex-1 text-left">
      <div class="flex flex-wrap items-center gap-2">
        <span class="min-w-0 truncate text-sm font-medium text-highlighted">{{ row.title }}</span>
        <span v-if="row.year" class="text-xs text-dimmed">{{ row.year }}</span>
        <UBadge
          :color="row.isShow ? 'primary' : 'info'"
          variant="subtle"
          size="sm"
          :label="row.isShow ? 'show' : 'movie'"
        />
        <!-- Plex's own gold rather than a theme colour, matching the sign-in button:
             this badge means "writes outside the bridge", so it should not blend in
             with the show/movie and profile badges around it. -->
        <UBadge
          v-if="row.plex_sync"
          variant="subtle"
          size="sm"
          class="bg-[#EBAF00]/10 text-[#EBAF00] ring-[#EBAF00]/30"
          title="Also marked watched in each co-watcher's own Plex"
        >
          <svg viewBox="0 0 32 32" class="size-3 shrink-0" aria-hidden="true">
            <path fill="currentColor" d="M15.527 0H6.24l10.239 16L6.24 32h9.287L25.76 16z" />
          </svg>
          Plex
        </UBadge>
      </div>

      <div v-if="row.library_name" class="mt-1 truncate text-xs text-dimmed">
        {{ row.library_name }}
      </div>

      <div class="mt-2 flex flex-wrap gap-1.5">
        <UBadge
          v-for="m in assigned(mappings, row.profiles)"
          :key="m.id"
          color="primary"
          variant="subtle"
          size="sm"
          :label="m.username"
        />

        <span v-if="!row.profiles.length" class="text-xs text-warning">
          No profiles assigned — nothing is being co-watched.
        </span>
      </div>
    </div>

    <UIcon name="i-lucide-chevron-right" class="size-4 shrink-0 text-dimmed" />
  </UButton>
</template>
