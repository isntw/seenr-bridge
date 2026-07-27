<script setup lang="ts">
// A labelled job inside a SetupStep card. Step 1 holds three: Connection,
// Libraries and Event webhook. Each carries its own status pill and ends in its
// own action row, which is what stops several primary buttons in one card from
// reading as ambiguous.
//
// When `collapsible`, the header row becomes the toggle and the status pill stays
// visible while closed — so a folded section still tells you whether it is healthy
// without having to open it.
defineProps<{
  label: string
  status?: 'ok' | 'bad' | 'pending' | null
  statusText?: string
  seam?: boolean
  collapsible?: boolean
  /** Initial open state, handed straight to UCollapsible's `defaultOpen`. That
   *  prop is read-once by definition, which is the behaviour this needs: were the
   *  open state derived reactively, a status change could fold a section up while
   *  you were typing in it. */
  startOpen?: boolean
  /** One-line recap shown on the right while collapsed. */
  summary?: string
}>()
</script>

<template>
  <!-- The seam is the ONE rule inside a SetupStep card. Action rows deliberately
       carry no border of their own, so this needs symmetric space on both sides:
       mt-6 puts air between the previous sub-section's buttons and the rule,
       pt-6 between the rule and this sub-section's label. -->
  <div :class="seam ? 'mt-6 border-t border-default pt-6' : ''">
    <!-- unmount-on-hide=false is load-bearing: the default unmounts the content,
         which would discard half-typed credentials and the library checkbox state
         every time a section folded. -->
    <UCollapsible v-if="collapsible" :default-open="!!startOpen" :unmount-on-hide="false">
      <!-- as-child on UCollapsible's trigger means this button IS the trigger:
           reka-ui puts aria-expanded/aria-controls on it, so the header keeps its
           status pill and summary without a second nested button. -->
      <template #default="{ open }">
        <!-- Props only, same as EventRow's trigger: UButton's own padding, hover and
             focus ring. The header is therefore no longer flush with the content
             below it — that inset is the component's padding, not a mistake.
             mb-3 only while open: it is the gap between header and content, so with
             nothing below it the margin just pushes the label off-centre. -->
        <UButton
          block
          color="neutral"
          variant="ghost"
          size="sm"
          :class="open ? 'mb-3' : ''"
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
          <!-- min-w-0 is what makes `truncate` work inside a flex row; without it a
               flex item refuses to shrink below its content and overflows instead.
               A class on my own span, not an override of UButton. -->
          <span v-if="!open && summary" class="ml-auto min-w-0 truncate pl-2 text-xs text-dimmed">
            {{ summary }}
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
          :color="status === 'ok' ? 'success' : status === 'bad' ? 'error' : 'neutral'"
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
