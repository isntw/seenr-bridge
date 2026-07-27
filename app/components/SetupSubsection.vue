<script setup lang="ts">
// A labelled job inside a SetupStep card. Step 1 holds three: Connection,
// Libraries and Event webhook. Each carries its own status pill and ends in its
// own action row, which is what stops several primary buttons in one card from
// reading as ambiguous.
//
// When `collapsible`, the header row becomes the toggle and the status pill stays
// visible while closed — so a folded section still tells you whether it is healthy
// without having to open it.
const props = defineProps<{
  label: string
  status?: 'ok' | 'bad' | 'pending' | null
  statusText?: string
  seam?: boolean
  collapsible?: boolean
  /** Initial open state. Read ONCE at setup and deliberately never again: were
   *  this left reactive, a status change could fold a section up while you were
   *  typing in it. Nothing re-collapses a section after first paint. */
  startOpen?: boolean
  /** One-line recap shown on the right while collapsed. */
  summary?: string
}>()

const open = ref(props.collapsible ? !!props.startOpen : true)
</script>

<template>
  <!-- The seam is the ONE rule inside a SetupStep card. Action rows deliberately
       carry no border of their own, so this needs symmetric space on both sides:
       mt-6 puts air between the previous sub-section's buttons and the rule,
       pt-6 between the rule and this sub-section's label. -->
  <div :class="seam ? 'mt-6 border-t border-default pt-6' : ''">
    <button
      v-if="collapsible"
      type="button"
      class="mb-3 flex w-full flex-wrap items-center gap-2 rounded text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-400"
      :aria-expanded="open"
      @click="open = !open"
    >
      <UIcon
        name="i-lucide-chevron-right"
        class="size-3.5 shrink-0 text-muted transition-transform"
        :class="open ? 'rotate-90' : ''"
      />
      <h3 class="text-xs font-semibold uppercase tracking-wider text-muted">{{ label }}</h3>
      <UBadge
        v-if="status && statusText"
        :color="status === 'ok' ? 'success' : status === 'bad' ? 'error' : 'neutral'"
        variant="subtle"
        size="sm"
        :label="statusText"
      />
      <span v-if="!open && summary" class="ml-auto truncate pl-2 text-xs text-dimmed">
        {{ summary }}
      </span>
    </button>

    <div v-else class="mb-3 flex flex-wrap items-center gap-2">
      <h3 class="text-xs font-semibold uppercase tracking-wider text-muted">{{ label }}</h3>
      <UBadge
        v-if="status && statusText"
        :color="status === 'ok' ? 'success' : status === 'bad' ? 'error' : 'neutral'"
        variant="subtle"
        size="sm"
        :label="statusText"
      />
    </div>

    <!-- v-show, not v-if: keeps half-typed input and the library checkbox state
         alive across a collapse, which v-if would discard. -->
    <div v-show="open" class="space-y-4">
      <slot />
    </div>
  </div>
</template>
