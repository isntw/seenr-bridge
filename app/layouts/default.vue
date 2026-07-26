<script setup lang="ts">
import { VERSION } from '../../shared/version'

const auth = useAuthStore()
const status = useStatusStore()
const drawer = ref(false)
const route = useRoute()

// Navigating from inside the drawer should close it.
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
    <!-- Persistent rail, lg and up only. -->
    <aside class="hidden lg:flex sticky top-0 h-screen w-56 shrink-0 flex-col border-r border-default bg-rail">
      <div class="flex items-center gap-3 px-5 py-4">
        <!-- from-primary-500 to-secondary-600 is the old violet -> fuchsia mark
             (see app.config.ts: secondary is fuchsia purely for this). -->
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
      <!-- Version sits above the connection pill, as in the pre-Nuxt sidebar. -->
      <div class="mt-auto p-3">
        <div class="mb-2.5 text-center text-[11px] text-dimmed">v{{ VERSION }}</div>
        <div class="flex items-center gap-2 rounded-lg bg-elevated px-3 py-2.5">
          <span
            class="size-1.5 shrink-0 rounded-full"
            :class="status.tautulli === null ? 'bg-neutral-500' : status.tautulli.ok ? 'bg-success' : 'bg-error'"
          />
          <span class="truncate text-xs text-muted">
            {{ status.tautulli === null ? 'Checking Tautulli…' : status.tautulli.ok ? 'Tautulli connected' : 'Tautulli unreachable' }}
          </span>
        </div>
      </div>
    </aside>

    <!-- Off-canvas nav, below lg. Same rail colour as the persistent one. -->
    <USlideover
      v-model:open="drawer"
      side="left"
      title="Seenr Bridge"
      :ui="{ content: 'bg-rail' }"
    >
      <template #body>
        <AppNav />
        <div class="mt-4 text-[11px] text-dimmed">v{{ VERSION }}</div>
      </template>
    </USlideover>

    <div class="flex min-w-0 flex-1 flex-col">
      <header class="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-default bg-default/80 px-4 py-3 backdrop-blur sm:px-6">
        <div class="flex min-w-0 items-center gap-2">
          <UButton
            class="lg:hidden min-h-11 min-w-11"
            icon="i-lucide-menu"
            color="neutral"
            variant="ghost"
            aria-label="Open navigation"
            @click="drawer = true"
          />
          <h1 class="truncate text-base font-semibold text-highlighted">{{ title }}</h1>
        </div>
        <AccountMenu :username="auth.username" @logout="auth.logout" />
      </header>

      <main class="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 sm:py-8">
        <slot />
      </main>
    </div>
  </div>
</template>
