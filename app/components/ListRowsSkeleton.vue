<script setup lang="ts">
withDefaults(defineProps<{ rows?: number }>(), { rows: 4 })
</script>

<template>
  <div class="divide-y divide-default" aria-hidden="true">
    <div v-for="i in rows" :key="i" class="flex items-center gap-2 px-3 py-2">
      <USkeleton class="h-[72px] w-12 shrink-0 rounded-md" />
      <div class="min-w-0 flex-1 space-y-2">
        <USkeleton class="h-4 w-2/5" />
        <USkeleton class="h-3 w-1/4" />
      </div>
      <USkeleton class="h-5 w-20 shrink-0" />
    </div>
  </div>
</template>
