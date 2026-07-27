<script setup lang="ts">
import type { Mapping } from '../../shared/types'
import type { SharedRow } from '../utils/shared-row'

// One co-watched title in the Shared page's list. A row, not a card — it sits in
// a `divide-y` list inside one card, the same shape as the Dashboard's
// Recent-scrobbles list.
//
// Everything inside is display-only, which is what lets the whole row be a single
// UButton. Interactive profile chips inside a clickable row would nest a button in
// a button: invalid HTML, and screen readers and keyboard users both suffer for it.
// Editing happens in the modal this row opens.
defineProps<{
  row: SharedRow
  mappings: Mapping[]
}>()

defineEmits<{ edit: [] }>()

/** Only the profiles this title is actually shared with — an unassigned user is
 *  absent rather than shown greyed out, since the row is a summary, not a form. */
function assigned(mappings: Mapping[], profiles: number[]) {
  return mappings.filter((m) => profiles.includes(m.id))
}
</script>

<template>
  <!-- Props only, identical to EventRow's row trigger. These two lists are meant to
       read as one system, so if one takes UButton's geometry the other must too. -->
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

    <!-- text-left: a native <button> centres its text per the UA stylesheet and
         UButton does not reset it. flex-1 leaves `block`'s justify-center nothing
         to do. Classes on my content, not on the component. -->
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
      </div>

      <!-- Which library the key belongs to. Not decoration: the pipeline gates on
           section, so a share pointing into a library you don't play from forwards
           nothing, and this row is the only place that would ever show it. -->
      <div v-if="row.library_name" class="mt-1 truncate text-xs text-dimmed">
        {{ row.library_name }}
      </div>

      <!-- Static badges, deliberately not UButtons: they report who this is shared
           with, they don't change it. Just the username — an initials avatar in
           front of a name it already spells out earns nothing. -->
      <div class="mt-2 flex flex-wrap gap-1.5">
        <UBadge
          v-for="m in assigned(mappings, row.profiles)"
          :key="m.id"
          color="primary"
          variant="subtle"
          size="sm"
          :label="m.username"
        />

        <!-- Left as prose, not UEmpty: this is a warning about a row that DOES
             exist, sitting inside that row. UEmpty announces the absence of a whole
             collection, and its icon-and-title block would dwarf the badges it
             stands among. -->
        <span v-if="!row.profiles.length" class="text-xs text-warning">
          No profiles assigned — nothing is being co-watched.
        </span>
      </div>
    </div>

    <UIcon name="i-lucide-chevron-right" class="size-4 shrink-0 text-dimmed" />
  </UButton>
</template>
