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
    <!-- The old trigger was a filled pill (bg-white/5, ring-white/10), not a
         bare ghost button — `subtle` is Nuxt UI's equivalent of that. -->
    <UButton color="neutral" variant="subtle" class="gap-2.5 rounded-full py-1 pl-1 pr-3">
      <!-- `text` renders the two-letter initials verbatim; `alt` would have Nuxt
           UI derive its own initials from them and show a single letter. -->
      <UAvatar
        :text="initials"
        size="sm"
        :ui="{ root: 'bg-primary-500/20', fallback: 'text-primary-200 text-xs font-semibold' }"
      />
      <!-- Username is noise on a phone; the avatar carries the affordance. -->
      <span class="hidden sm:block max-w-35 truncate text-sm text-muted">{{ username }}</span>
      <UIcon name="i-lucide-chevron-down" class="size-4 text-dimmed" />
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
        <UButton color="neutral" variant="subtle" label="Cancel" @click="open = false; reset()" />
        <UButton :loading="busy" label="Update password" @click="submit" />
      </div>
    </template>
  </UModal>
</template>
