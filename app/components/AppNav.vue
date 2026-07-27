<script setup lang="ts">
const items = [
  { label: 'Dashboard', icon: 'i-lucide-layout-dashboard', to: '/dashboard' },
  { label: 'Shared', icon: 'i-lucide-users-round', to: '/shared' },
  { label: 'Settings', icon: 'i-lucide-settings', to: '/settings' },
]
</script>

<template>
  <nav class="flex flex-col gap-1">
    <!-- Props only. UButton wraps ULink, which decides `active` from the route
         itself, and active-color/active-variant swap the whole button when it
         matches — base tint and icon colour together, because the icon inherits
         currentColor. That replaces a hand-written isActive() off useRoute(), two
         class groups, and a :ui override on the icon slot.
         No `block` and no justify-start either: the nav is a flex column, so stretch
         already makes these full width, and UButton's base sets no justify — so
         flex-start is what you get. -->
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
