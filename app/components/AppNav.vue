<script setup lang="ts">
const items = [
  { label: 'Dashboard', icon: 'i-lucide-layout-dashboard', to: '/dashboard' },
  { label: 'Shared', icon: 'i-lucide-users-round', to: '/shared' },
  { label: 'Settings', icon: 'i-lucide-settings', to: '/settings' },
]
</script>

<template>
  <nav class="flex flex-col gap-1">
    <UButton
      v-for="item in items"
      :key="item.to"
      :to="item.to"
      :icon="item.icon"
      :label="item.label"
      color="neutral"
      variant="ghost"
      active-color="primary"
      active-variant="subtle"
      size="lg"
    />
  </nav>
</template>
