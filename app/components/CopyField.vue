<script setup lang="ts">
const props = defineProps<{ label: string; value: string; hint?: string }>()
const copied = ref(false)
const toast = useToast()

async function copy() {
  try {
    await navigator.clipboard.writeText(props.value)
    copied.value = true
    setTimeout(() => (copied.value = false), 1500)
  } catch {
    toast.add({ title: 'Could not copy to clipboard', color: 'error' })
  }
}
</script>

<template>
  <div>
    <div class="mb-1.5 text-sm font-medium">{{ label }}</div>
    <div class="flex items-stretch gap-2">
      <!-- bg-default is darker than the card it sits in, matching the old
           bg-black/40 inset. -->
      <!-- `flex items-center` because the row is items-stretch: the box is sized
           by the Copy button beside it, and without this the single line of text
           sits at that box's top edge and reads as stray bottom padding. -->
      <code class="flex min-w-0 flex-1 items-center overflow-x-auto whitespace-pre rounded-lg bg-default px-3 py-2 font-mono text-xs ring-1 ring-default">{{ value }}</code>
      <UButton
        :color="copied ? 'success' : 'neutral'"
        :variant="copied ? 'solid' : 'subtle'"
        :label="copied ? 'Copied' : 'Copy'"
        class="shrink-0"
        @click="copy"
      />
    </div>
    <div v-if="hint" class="mt-1 text-xs text-dimmed">{{ hint }}</div>
  </div>
</template>
