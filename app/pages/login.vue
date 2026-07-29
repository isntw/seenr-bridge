<script setup lang="ts">
const route = useRoute()

function afterLogin() {
  const r = typeof route.query.redirect === 'string' ? route.query.redirect : ''
  return r.startsWith('/') && !r.startsWith('//') ? r : '/dashboard'
}

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
const plexPopup = ref<PlexPopup | null>(null)
let plexCancelled = false

function cancelPlex() {
  plexCancelled = true
  plexPopup.value?.close()
  plexPopup.value = null
  plexBusy.value = false
}

// On a fresh install Plex sign-in CREATES the account, so it is a genuine alternative
// to the setup form rather than a second way into an existing one.
async function signInWithPlex() {
  error.value = null
  plexCancelled = false
  plexBusy.value = true
  try {
    const pin = await auth.startPlexLogin()
    plexPopup.value = openPlexPopup(pin.url)

    const deadline = Date.now() + 180_000
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 2000))
      if (plexCancelled) return

      try {
        if (await auth.pollPlexLogin(pin.id)) {
          // Close it for them — the whole point of the popup is that it disappears once
          // it has done its job.
          plexPopup.value?.close()
          plexPopup.value = null
          await navigateTo(afterLogin())
          return
        }
      } catch (e) {
        // A refusal is final: an account that does not own the server will not come to
        // own it by polling again. Stop rather than spinning to the deadline.
        plexPopup.value?.close()
        plexPopup.value = null
        error.value = apiErrorMessage(e, 'Could not sign in with Plex.')
        return
      }
    }
    plexPopup.value?.close()
    plexPopup.value = null
    error.value = 'Timed out waiting for Plex. Try again.'
  } catch (e) {
    plexPopup.value?.close()
    plexPopup.value = null
    error.value = apiErrorMessage(e, 'Could not sign in with Plex.')
  } finally {
    plexBusy.value = false
  }
}

// A popup left open after navigating away would keep pointing at a dead PIN.
onBeforeUnmount(() => plexPopup.value?.close())

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
    await navigateTo(afterLogin())
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
        <!-- Plex first: it is one click and needs nothing remembered, so it is the
             primary way in. Hidden only when it could not possibly work — no Tautulli
             connection means the bridge cannot tell which server's owner to accept. On a
             fresh install it IS shown, because there it creates the account. -->
        <template v-if="auth.plexLogin">
          <!-- While waiting, the button is replaced rather than merely disabled: the
               operator's attention is in the popup, so this panel's job is to say where
               to look and offer a way back if the window is lost or was blocked. -->
          <div
            v-if="plexBusy"
            class="rounded-lg bg-elevated/40 p-4 text-center ring-1 ring-default"
          >
            <UIcon name="i-lucide-loader-circle" class="size-5 animate-spin text-[#EBAF00]" />
            <div class="mt-1.5 text-sm font-medium text-highlighted">
              Waiting for Plex authorization…
            </div>
            <div class="mt-0.5 text-xs text-dimmed">Complete sign-in in the popup window</div>
            <div class="mt-3 flex items-center justify-center gap-4">
              <UButton
                color="neutral"
                variant="link"
                size="xs"
                icon="i-lucide-external-link"
                label="Reopen Plex login"
                @click="plexPopup?.reopen()"
              />
              <UButton color="neutral" variant="link" size="xs" label="Cancel" @click="cancelPlex" />
            </div>
          </div>

          <template v-else>
            <PlexSignInButton
              class="w-full justify-center"
              :label="isSetup ? 'Create account with Plex' : 'Sign in with Plex'"
              @click="signInWithPlex"
            />
            <!-- Nothing under the button when signing in: who is allowed is the
                 server's business, and saying so was noise on a page whose only job is
                 to let the operator in. Setup keeps one line, because creating an
                 account with no password is a consequence worth stating up front. -->
            <p v-if="isSetup" class="mt-2 text-center text-xs text-dimmed">
              Creates your account from your Plex identity — no password needed.
            </p>
          </template>

          <div class="my-4 flex items-center gap-3">
            <hr class="flex-1 border-muted">
            <span class="text-xs text-dimmed">or</span>
            <hr class="flex-1 border-muted">
          </div>
        </template>

        <!-- Always present, never hidden: it is the route that cannot be taken away by a
             plex.tv outage. -->
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
            :color="auth.plexLogin ? 'neutral' : 'primary'"
            :variant="auth.plexLogin ? 'subtle' : 'solid'"
            :label="isSetup ? 'Create account' : 'Sign in'"
            block
          />
        </form>
      </UCard>

      <div class="mt-5 text-center text-[11px] text-dimmed">Seenr Bridge · v{{ VERSION }}</div>
    </div>
  </div>
</template>
