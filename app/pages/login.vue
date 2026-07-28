<script setup lang="ts">
import { VERSION } from '../../shared/version'
import { apiErrorMessage } from '../../shared/errors'

definePageMeta({ layout: false })

const auth = useAuthStore()
const username = ref('')
const password = ref('')
const confirm = ref('')
const busy = ref(false)
const error = ref<string | null>(null)

const isSetup = computed(() => auth.needsSetup)

const plexBusy = ref(false)

// On a fresh install Plex sign-in CREATES the account, so it is a genuine alternative
// to the setup form rather than a second way into an existing one.
async function signInWithPlex() {
  error.value = null
  plexBusy.value = true
  try {
    const pin = await auth.startPlexLogin()
    window.open(pin.url, '_blank', 'noopener')

    const deadline = Date.now() + 120_000
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 2000))
      try {
        if (await auth.pollPlexLogin(pin.id)) {
          await navigateTo('/dashboard')
          return
        }
      } catch (e) {
        // A refusal is final — an unlinked account will not become linked by polling
        // again — so surface it and stop rather than spinning to the deadline.
        error.value = apiErrorMessage(e, 'Could not sign in with Plex.')
        return
      }
    }
    error.value = 'Timed out waiting for Plex. Try again.'
  } catch (e) {
    error.value = apiErrorMessage(e, 'Could not sign in with Plex.')
  } finally {
    plexBusy.value = false
  }
}

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
    error.value = apiErrorMessage(e, 'Something went wrong.')
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="grid min-h-screen place-items-center p-4">
    <div class="w-full max-w-sm">
      <div class="mb-6 flex flex-col items-center gap-3">
        <div
          class="grid size-12 place-items-center rounded-2xl bg-linear-to-br from-primary-500 to-secondary-600 text-2xl font-bold text-white shadow-lg shadow-primary-900/40"
        >
          S
        </div>
        <div class="text-center">
          <div class="text-lg font-semibold text-highlighted">Seenr Bridge</div>
          <div class="mt-0.5 text-sm text-muted">
            {{ isSetup ? 'Create your account to get started' : 'Sign in to continue' }}
          </div>
        </div>
      </div>

      <UCard>
        <form class="space-y-4" @submit.prevent="submit">
          <UFormField label="Username">
            <UInput v-model="username" autocomplete="username" class="w-full" />
          </UFormField>

          <UFormField
            label="Password"
            :help="isSetup ? 'At least 8 characters' : undefined"
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
          />
        </form>

        <!-- Hidden when it could only fail — no Tautulli connection means the bridge
             cannot tell which server's owner to accept. On a fresh install it is shown,
             because there it CREATES the account. -->
        <template v-if="auth.plexLogin">
          <div class="my-4 flex items-center gap-3">
            <hr class="flex-1 border-muted">
            <span class="text-xs text-dimmed">or</span>
            <hr class="flex-1 border-muted">
          </div>

          <PlexSignInButton
            class="w-full justify-center"
            :loading="plexBusy"
            :label="isSetup ? 'Create account with Plex' : 'Sign in with Plex'"
            @click="signInWithPlex"
          />
          <p class="mt-2 text-center text-xs text-dimmed">
            {{ isSetup
              ? 'Creates your account from your Plex identity — no password needed.'
              : 'For the owner of the Plex server this bridge watches.' }}
          </p>
        </template>
      </UCard>

      <div class="mt-5 text-center text-[11px] text-dimmed">Seenr Bridge · v{{ VERSION }}</div>
    </div>
  </div>
</template>
