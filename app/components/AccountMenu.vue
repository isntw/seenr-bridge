<script setup lang="ts">
import { apiErrorMessage } from '../../shared/errors'

const props = defineProps<{ username: string | null }>()
const emit = defineEmits<{ logout: [] }>()

const open = ref(false)
const current = ref('')
const next = ref('')
const confirm = ref('')
const busy = ref(false)
const toast = useToast()

const initials = computed(() => (props.username || '?').slice(0, 2).toUpperCase())

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
  busy.value = true
  try {
    await $fetch('/api/auth/change-password', {
      method: 'POST',
      body: { current_password: current.value, new_password: next.value },
    })
    toast.add({ title: 'Password updated.', color: 'success' })
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
    { label: 'Change password', icon: 'i-lucide-lock', onSelect: () => (open.value = true) },
    { label: 'Log out', icon: 'i-lucide-log-out', onSelect: () => emit('logout') },
  ],
])
</script>

<template>
  <UDropdownMenu :items="menuItems">
    <UButton color="neutral" variant="ghost" class="min-h-11 gap-2.5">
      <UAvatar :alt="initials" size="sm" />
      <!-- Username is noise on a phone; the avatar carries the affordance. -->
      <span class="hidden sm:block max-w-35 truncate text-sm">{{ username }}</span>
      <UIcon name="i-lucide-chevron-down" class="size-4" />
    </UButton>
  </UDropdownMenu>

  <UModal v-model:open="open" title="Change password">
    <template #body>
      <div class="space-y-4">
        <UFormField label="Current password">
          <UInput v-model="current" type="password" autocomplete="current-password" class="w-full" />
        </UFormField>
        <UFormField label="New password" help="At least 8 characters">
          <UInput v-model="next" type="password" autocomplete="new-password" class="w-full" />
        </UFormField>
        <UFormField label="Confirm new password">
          <UInput v-model="confirm" type="password" autocomplete="new-password" class="w-full" />
        </UFormField>
      </div>
    </template>
    <template #footer>
      <div class="flex justify-end gap-3">
        <UButton color="neutral" variant="ghost" label="Cancel" @click="open = false; reset()" />
        <UButton :loading="busy" label="Update password" @click="submit" />
      </div>
    </template>
  </UModal>
</template>
