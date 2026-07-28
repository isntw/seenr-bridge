<script setup lang="ts">
import { apiErrorMessage } from '../../shared/errors'

// hasPassword is false for an account created by signing in with Plex. Such an account
// has no current password to confirm, so this modal must offer to SET one instead of
// demanding something that cannot exist — otherwise a Plex-created account could never
// gain a password at all.
const props = withDefaults(defineProps<{ username: string | null; hasPassword?: boolean }>(), {
  hasPassword: true,
})
const emit = defineEmits<{ logout: [] }>()

const open = ref(false)
const current = ref('')
const next = ref('')
const confirm = ref('')
const busy = ref(false)
const toast = useToast()

const initials = computed(() => (props.username || '?').slice(0, 2).toUpperCase())
const title = computed(() => (props.hasPassword ? 'Change password' : 'Set a password'))

function reset() {
  current.value = ''
  next.value = ''
  confirm.value = ''
}

async function submit() {
  if (next.value !== confirm.value) {
    toast.add({ title: 'New passwords do not match.', color: 'error' })
    return
  }
  if (next.value.length < 8) {
    toast.add({ title: 'Password must be at least 8 characters.', color: 'error' })
    return
  }
  busy.value = true
  try {
    await $fetch('/api/auth/change-password', {
      method: 'POST',
      body: { current_password: current.value, new_password: next.value },
    })
    toast.add({
      title: props.hasPassword ? 'Password updated.' : 'Password set — you can now sign in either way.',
      color: 'success',
    })
    open.value = false
    reset()
  } catch (e) {
    toast.add({ title: apiErrorMessage(e, 'Could not update password.'), color: 'error' })
  } finally {
    busy.value = false
  }
}

const menuItems = computed(() => [
  [{ label: props.username || 'Account', type: 'label' as const }],
  [
    { label: title.value, icon: 'i-lucide-lock', onSelect: () => (open.value = true) },
    { label: 'Log out', icon: 'i-lucide-log-out', onSelect: () => emit('logout') },
  ],
])
</script>

<template>
  <UDropdownMenu :items="menuItems">
    <UButton
      color="neutral"
      variant="subtle"
      :avatar="{ text: initials }"
      trailing-icon="i-lucide-chevron-down"
    >
      <span class="hidden max-w-35 truncate sm:block">{{ username }}</span>
    </UButton>
  </UDropdownMenu>

  <UModal v-model:open="open" :title="title">
    <template #body>
      <div class="space-y-4">
        <p v-if="!hasPassword" class="text-sm text-muted">
          This account was created by signing in with Plex, so it has no password yet.
          Setting one gives you a second way in — Plex sign-in keeps working either way.
        </p>
        <UFormField v-if="hasPassword" label="Current password">
          <UInput v-model="current" type="password" autocomplete="current-password" class="w-full" />
        </UFormField>
        <UFormField :label="hasPassword ? 'New password' : 'Password'" help="At least 8 characters">
          <UInput v-model="next" type="password" autocomplete="new-password" class="w-full" />
        </UFormField>
        <UFormField :label="hasPassword ? 'Confirm new password' : 'Confirm password'">
          <UInput v-model="confirm" type="password" autocomplete="new-password" class="w-full" />
        </UFormField>
      </div>
    </template>
    <template #footer>
      <div class="flex justify-end gap-3">
        <UButton color="neutral" variant="subtle" label="Cancel" @click="open = false; reset()" />
        <UButton :loading="busy" :label="hasPassword ? 'Update password' : 'Set password'" @click="submit" />
      </div>
    </template>
  </UModal>
</template>
