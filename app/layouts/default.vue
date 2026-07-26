<script setup lang="ts">
import { VERSION } from '../../shared/version'

const auth = useAuthStore()
const status = useStatusStore()
const drawer = ref(false)
const route = useRoute()

// Navigating from inside the drawer should close it.
watch(() => route.path, () => (drawer.value = false))

const title = computed(() => (route.path === '/settings' ? 'Settings' : 'Dashboard'))

onMounted(() => status.start())
onBeforeUnmount(() => status.stop())
</script>

<template>
  <div class="flex min-h-screen">
    <!-- Persistent rail, lg and up only. -->
    <aside class="hidden lg:flex sticky top-0 h-screen w-56 shrink-0 flex-col border-r border-default bg-elevated/30">
      <div class="flex items-center gap-3 px-5 py-4">
        <div class="grid size-9 place-items-center rounded-xl bg-primary text-lg font-bold text-inverted">S</div>
        <div class="text-sm font-semibold">Seenr Bridge</div>
      </div>
      <div class="mt-2 px-3">
        <AppNav />
      </div>
      <div class="mt-auto space-y-2 p-3">
        <div class="flex items-center gap-2 rounded-lg bg-elevated/40 px-3 py-2.5">
          <span
            class="size-1.5 shrink-0 rounded-full"
            :class="status.tautulli === null ? 'bg-muted' : status.tautulli.ok ? 'bg-success' : 'bg-error'"
          />
          <span class="truncate text-xs text-muted">
            {{ status.tautulli === null ? 'Checking Tautulli…' : status.tautulli.ok ? 'Tautulli connected' : 'Tautulli unreachable' }}
          </span>
        </div>
        <div class="text-center text-[11px] text-muted">v{{ VERSION }}</div>
      </div>
    </aside>

    <!-- Off-canvas nav, below lg. -->
    <USlideover v-model:open="drawer" side="left" title="Seenr Bridge">
      <template #body>
        <AppNav />
        <div class="mt-4 text-[11px] text-muted">v{{ VERSION }}</div>
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
          <h1 class="truncate text-base font-semibold">{{ title }}</h1>
        </div>
        <AccountMenu :username="auth.username" @logout="auth.logout" />
      </header>

      <main class="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 sm:py-8">
        <slot />
      </main>
    </div>
  </div>
</template>
