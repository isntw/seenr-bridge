<script setup lang="ts">
import { VERSION } from '../../shared/version'

definePageMeta({ layout: false })

const auth = useAuthStore()
const username = ref('')
const password = ref('')
const confirm = ref('')
const busy = ref(false)
const error = ref<string | null>(null)

const isSetup = computed(() => auth.needsSetup)

async function submit() {
  error.value = null

  if (isSetup.value) {
    if (password.value.length < 8) {
      error.value = 'Password must be at least 8 characters.'
      return
    }
    if (password.value !== confirm.value) {
      error.value = 'Passwords do not match.'
      return
    }
  }

  busy.value = true
  try {
    if (isSetup.value) await auth.register(username.value, password.value)
    else await auth.login(username.value, password.value)
    await navigateTo('/dashboard')
  } catch (e) {
    const err = e as { data?: { statusMessage?: string } }
    error.value = err.data?.statusMessage || 'Something went wrong.'
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="grid min-h-screen place-items-center p-4">
    <UCard class="w-full max-w-sm">
      <template #header>
        <div class="flex items-center gap-3">
          <div class="grid size-9 place-items-center rounded-xl bg-primary text-lg font-bold text-inverted">S</div>
          <div>
            <div class="text-sm font-semibold">Seenr Bridge</div>
            <div class="text-xs text-muted">
              {{ isSetup ? 'Create your account' : 'Sign in' }}
            </div>
          </div>
        </div>
      </template>

      <form class="space-y-4" @submit.prevent="submit">
        <UFormField label="Username">
          <UInput v-model="username" autocomplete="username" class="w-full" />
        </UFormField>

        <UFormField
          label="Password"
          :hint="isSetup ? 'At least 8 characters' : undefined"
        >
          <UInput
            v-model="password"
            type="password"
            :autocomplete="isSetup ? 'new-password' : 'current-password'"
            class="w-full"
          />
        </UFormField>

        <UFormField v-if="isSetup" label="Confirm password">
          <UInput v-model="confirm" type="password" autocomplete="new-password" class="w-full" />
        </UFormField>

        <UAlert v-if="error" color="error" variant="subtle" :description="error" />

        <UButton
          type="submit"
          :loading="busy"
          :label="isSetup ? 'Create account' : 'Sign in'"
          block
          class="min-h-11"
        />
      </form>

      <template #footer>
        <div class="text-center text-[11px] text-muted">v{{ VERSION }}</div>
      </template>
    </UCard>
  </div>
</template>
