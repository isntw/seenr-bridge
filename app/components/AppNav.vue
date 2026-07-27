<script setup lang="ts">
const items = [
  { label: 'Dashboard', icon: 'i-lucide-layout-dashboard', to: '/dashboard' },
  { label: 'Shared', icon: 'i-lucide-users-round', to: '/shared' },
  { label: 'Settings', icon: 'i-lucide-settings', to: '/settings' },
]

// The active item needs a violet-tinted icon *and* a tinted base with an inset
// ring, and UButton's `active-class` only reaches the base slot — so the active
// state is derived from the route here and applied to both slots. All three
// routes are exact paths, so plain equality is enough.
const route = useRoute()
const isActive = (to: string) => route.path === to
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
      size="lg"
      class="justify-start"
      :class="isActive(item.to)
        ? 'bg-primary-500/15 text-highlighted ring ring-inset ring-primary-500/25'
        : 'text-muted hover:text-highlighted'"
      :ui="{ leadingIcon: isActive(item.to) ? 'text-primary-300' : '' }"
    />
  </nav>
</template>
