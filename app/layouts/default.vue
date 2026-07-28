<script setup lang="ts">
const auth = useAuthStore()
const status = useStatusStore()
const drawer = ref(false)
const route = useRoute()

watch(() => route.path, () => (drawer.value = false))

const TITLES: Record<string, string> = {
  '/dashboard': 'Dashboard',
  '/shared': 'Shared',
  '/settings': 'Settings',
}
const title = computed(() => TITLES[route.path] ?? 'Dashboard')

onMounted(() => status.start())
onBeforeUnmount(() => status.stop())
</script>

<template>
  <div class="flex min-h-screen">
    <aside class="hidden lg:flex sticky top-0 h-screen w-56 shrink-0 flex-col border-r border-default bg-rail">
      <div class="flex items-center gap-3 px-5 py-4">
        <div
          class="grid size-9 place-items-center rounded-xl bg-linear-to-br from-primary-500 to-secondary-600 text-lg font-bold text-white shadow-lg shadow-primary-900/40"
        >
          S
        </div>
        <div class="text-sm font-semibold text-highlighted">Seenr Bridge</div>
      </div>
      <div class="mt-2 px-3">
        <AppNav />
      </div>
      <div class="mt-auto p-3">
        <AppNavFooter />
      </div>
    </aside>

    <USlideover
      v-model:open="drawer"
      side="left"
      title="Seenr Bridge"
      :ui="{ content: 'bg-rail' }"
    >
      <template #body>
        <AppNav />
      </template>
      <!-- The footer slot, not the end of the body: the slideover is full height, so a
           version line after the nav items floats in the middle of an empty panel
           instead of sitting at the bottom where the rail puts it. -->
      <template #footer>
        <AppNavFooter class="w-full" />
      </template>
    </USlideover>

    <div class="flex min-w-0 flex-1 flex-col">
      <header class="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-default bg-default/80 px-4 py-3 backdrop-blur sm:px-6">
        <div class="flex min-w-0 items-center gap-2">
          <UButton
            class="lg:hidden"
            icon="i-lucide-menu"
            color="neutral"
            variant="ghost"
            aria-label="Open navigation"
            @click="drawer = true"
          />
          <h1 class="truncate text-base font-semibold text-highlighted">{{ title }}</h1>
        </div>
        <AccountMenu :username="auth.username" :has-password="auth.hasPassword" @logout="auth.logout" />
      </header>

      <main class="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 sm:py-8">
        <slot />
      </main>
    </div>
  </div>
</template>
