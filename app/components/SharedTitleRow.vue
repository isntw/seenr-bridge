<script setup lang="ts">
import type { Mapping } from '../../shared/types'
import type { SharedRow } from '../utils/shared-row'

defineProps<{
  row: SharedRow
  mappings: Mapping[]
}>()

defineEmits<{ edit: [] }>()

// One string for both instances of the badge — the mobile one and the column one — so
// they cannot drift apart.
const PLEX_TITLE = "Also marked watched in each co-watcher's own Plex"

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
        <!-- The right-hand Plex column is hidden on a phone, so the badge rides here
             instead — the same swap EventRow does with its status badge. -->
        <PlexBadge v-if="row.plex_sync" class="sm:hidden" :title="PLEX_TITLE" />
      </div>

      <!-- Kind and library are both metadata, so they read as one dimmed line rather than
           a badge plus a line of text. As a badge, `show` took the primary colour and so
           looked like one of the profile names directly underneath it. -->
      <div class="mt-1 truncate text-xs text-dimmed">
        {{ row.isShow ? 'show' : 'movie' }}<template v-if="row.library_name"> · {{ row.library_name }}</template>
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

    <!-- Its own column from `sm` up, so the one badge that reports behaviour rather than
         metadata lands at the same place on every row instead of trailing a title of
         whatever length. `items-start` keeps it on the title's line. -->
    <div class="hidden shrink-0 items-start sm:flex">
      <PlexBadge v-if="row.plex_sync" :title="PLEX_TITLE" />
    </div>

    <UIcon name="i-lucide-chevron-right" class="size-4 shrink-0 text-dimmed" />
  </UButton>
</template>
