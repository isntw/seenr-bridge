<script setup lang="ts">
import type { Mapping } from '../../shared/types'

const store = useSettingsStore()
const status = useStatusStore()
const toast = useToast()

await store.fetch()

onMounted(() => {
  status.start()
  store.fetchTautulliUsers().catch(() => {})
})
onBeforeUnmount(() => status.stop())

const TRIGGERS = [
  { key: 'watched', label: 'Watched', recommended: true },
  { key: 'play', label: 'Play' },
  { key: 'stop', label: 'Stop' },
  { key: 'pause', label: 'Pause' },
  { key: 'resume', label: 'Resume' },
]
const selectedTriggers = ref<string[]>(['watched'])

function isTriggerSelected(key: string) {
  return selectedTriggers.value.includes(key)
}

// UCheckbox has no built-in array-group mode outside UCheckboxGroup, so a
// shared v-model across sibling checkboxes would fight itself. Each checkbox
// derives its own checked state from the array and toggles membership.
function toggleTrigger(key: string, checked: boolean) {
  if (checked) {
    if (!selectedTriggers.value.includes(key)) selectedTriggers.value.push(key)
  } else {
    selectedTriggers.value = selectedTriggers.value.filter((k) => k !== key)
  }
}

const saving = ref(false)
const syncing = ref(false)
const newUser = ref('')
const newToken = ref('')
const edit = ref<Mapping | null>(null)
const advanced = ref(false)
const manual = ref(false)

const webhookUrl = computed(() => {
  const base = (store.settings?.bridge_url || window.location.origin).replace(/\/+$/, '')
  return `${base}/api/webhook/tautulli`
})

const availableUsers = computed(() => {
  const taken = new Set(store.mappings.map((m) => m.username.toLowerCase()))
  return store.tautulliUsers.filter((u) => !taken.has(u.toLowerCase()))
})

function syncSummary(m: Mapping) {
  if (m.sync_episodes && m.sync_movies) return 'TV + Movies'
  if (m.sync_episodes) return 'TV only'
  if (m.sync_movies) return 'Movies only'
  return 'nothing selected'
}

async function saveConnection() {
  saving.value = true
  try {
    await store.save({
      tautulli_url: store.settings!.tautulli_url,
      tautulli_apikey: store.settings!.tautulli_apikey,
    })
    toast.add({ title: 'Saved.', color: 'success' })
    status.refresh()
    store.fetchTautulliUsers().catch(() => {})
  } catch (e) {
    const err = e as { data?: { statusMessage?: string } }
    toast.add({ title: err.data?.statusMessage || 'Could not save.', color: 'error' })
  } finally {
    saving.value = false
  }
}

async function testConnection() {
  const r = await store.testTautulli({
    tautulli_url: store.settings!.tautulli_url,
    tautulli_apikey: store.settings!.tautulli_apikey,
  })
  toast.add({ title: r.message, color: r.ok ? 'success' : 'error' })
}

async function addMapping() {
  if (!newUser.value.trim() || !newToken.value.trim()) {
    toast.add({ title: 'Username and token are both required.', color: 'error' })
    return
  }
  try {
    await store.saveMapping({ username: newUser.value.trim(), seenr_token: newToken.value.trim() })
    newUser.value = ''
    newToken.value = ''
    toast.add({ title: 'User mapped.', color: 'success' })
  } catch (e) {
    const err = e as { data?: { statusMessage?: string } }
    toast.add({ title: err.data?.statusMessage || 'Could not add user.', color: 'error' })
  }
}

async function saveEdit() {
  if (!edit.value) return
  await store.saveMapping({
    username: edit.value.username,
    seenr_token: edit.value.seenr_token,
    enabled: edit.value.enabled,
    sync_movies: edit.value.sync_movies,
    sync_episodes: edit.value.sync_episodes,
  })
  edit.value = null
  toast.add({ title: 'Updated.', color: 'success' })
}

async function removeEdit() {
  if (!edit.value) return
  await store.removeMapping(edit.value.id)
  edit.value = null
  toast.add({ title: 'Removed.', color: 'success' })
}

async function runSync() {
  syncing.value = true
  try {
    const r = await store.syncWebhook(selectedTriggers.value)
    toast.add({
      title: r.created ? 'Webhook created in Tautulli.' : 'Webhook updated in Tautulli.',
      color: 'success',
    })
    status.refresh()
  } catch (e) {
    const err = e as { data?: { statusMessage?: string } }
    toast.add({ title: err.data?.statusMessage || 'Sync failed.', color: 'error' })
  } finally {
    syncing.value = false
  }
}

async function saveAdvanced() {
  await store.save({
    forward_enabled: store.settings!.forward_enabled,
    seenr_base_url: store.settings!.seenr_base_url,
    bridge_url: store.settings!.bridge_url,
  })
  toast.add({ title: 'Saved.', color: 'success' })
}
</script>

<template>
  <div v-if="store.settings" class="space-y-4">
    <!-- Status line: wraps rather than overflowing on narrow screens. -->
    <div class="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
      <span class="flex items-center gap-1.5">
        <span
          class="size-1.5 rounded-full"
          :class="status.tautulli === null ? 'bg-muted' : status.tautulli.ok ? 'bg-success' : 'bg-error'"
        />
        <span class="text-muted">
          {{ status.tautulli === null ? 'checking…' : status.tautulli.ok ? 'Tautulli connected' : 'Tautulli offline' }}
        </span>
      </span>
      <span class="text-dimmed">{{ status.users }} {{ status.users === 1 ? 'user' : 'users' }}</span>
      <span class="flex items-center gap-1.5">
        <span class="size-1.5 rounded-full" :class="status.webhook ? 'bg-success' : 'bg-error'" />
        <span class="text-muted">{{ status.webhook ? 'webhook active' : 'no webhook' }}</span>
      </span>
    </div>

    <SetupStep :n="1" title="Connect Tautulli" hint="where the bridge reads episode IDs">
      <div class="grid gap-4 sm:grid-cols-2">
        <UFormField label="Tautulli URL" hint="e.g. http://tautulli:8181">
          <UInput v-model="store.settings.tautulli_url" placeholder="http://tautulli:8181" class="w-full" />
        </UFormField>
        <UFormField label="API key" hint="Tautulli → Settings → Web Interface → API key">
          <UInput v-model="store.settings.tautulli_apikey" type="password" placeholder="xxxxxxxx" class="w-full" />
        </UFormField>
      </div>
      <div class="mt-4 flex flex-wrap gap-3">
        <UButton color="neutral" variant="ghost" label="Test connection" class="min-h-11" @click="testConnection" />
        <UButton :loading="saving" label="Save" class="min-h-11" @click="saveConnection" />
      </div>
    </SetupStep>

    <SetupStep :n="2" title="Map users to seenr" hint="each Plex user → their seenr token">
      <div class="space-y-2">
        <p v-if="!store.mappings.length" class="text-sm text-muted">No users yet. Add one below.</p>

        <!-- Stacks below sm so the Configure button never squeezes the token. -->
        <div
          v-for="m in store.mappings"
          :key="m.id"
          class="flex flex-col gap-2 rounded-lg bg-elevated/40 px-3 py-2.5 ring-1 ring-default sm:flex-row sm:items-center sm:gap-3"
        >
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-2 text-sm font-medium">
              <span class="truncate">{{ m.username }}</span>
              <UBadge v-if="!m.enabled" color="neutral" variant="subtle" size="sm" label="paused" />
            </div>
            <div class="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-dimmed">
              <span class="font-mono">{{ m.seenr_token.slice(0, 8) }}…{{ m.seenr_token.slice(-6) }}</span>
              <span>·</span>
              <span>{{ syncSummary(m) }}</span>
            </div>
          </div>
          <UButton
            color="neutral"
            variant="ghost"
            label="Configure"
            class="min-h-11 self-start sm:self-auto"
            @click="edit = { ...m }"
          />
        </div>
      </div>

      <div class="mt-4 grid gap-3 sm:grid-cols-[1fr_2fr_auto] sm:items-end">
        <UFormField label="Plex username">
          <!-- Free text still allowed, so manual entry works when Tautulli
               is unreachable. Selecting the generated "Create …" option calls
               preventDefault() internally (see SelectMenu.vue) and only emits
               `create` — it does not update v-model on its own — so the typed
               value is applied here explicitly. -->
          <USelectMenu
            v-model="newUser"
            :items="availableUsers"
            create-item
            placeholder="Select or type…"
            class="w-full"
            @create="(item) => { newUser = item }"
          />
        </UFormField>
        <UFormField label="seenr token" hint="the part after /scrobble/plex/ in your seenr URL">
          <UInput v-model="newToken" placeholder="9%7CyourSeenrToken" class="w-full" />
        </UFormField>
        <UButton label="Add" class="min-h-11" @click="addMapping" />
      </div>
    </SetupStep>

    <SetupStep :n="3" title="Send Tautulli's events here" hint="one webhook, covers every user">
      <div class="mb-4">
        <div class="mb-2.5 text-sm font-medium">Triggers to enable</div>
        <div class="flex flex-wrap gap-x-5 gap-y-3">
          <UCheckbox
            v-for="t in TRIGGERS"
            :key="t.key"
            :model-value="isTriggerSelected(t.key)"
            :label="t.label"
            class="min-h-11 items-center"
            @update:model-value="(v) => toggleTrigger(t.key, v === true)"
          >
            <template v-if="t.recommended" #description>
              <UBadge color="success" variant="subtle" size="sm" label="recommended" />
            </template>
          </UCheckbox>
        </div>
      </div>

      <UButton :loading="syncing" label="Sync to Tautulli" class="min-h-11" @click="runSync" />

      <UCollapsible v-model:open="manual" class="mt-4">
        <UButton
          color="neutral"
          variant="ghost"
          class="min-h-11"
          trailing-icon="i-lucide-chevron-down"
          label="Set it up manually instead"
        />
        <template #content>
          <div class="space-y-3 pt-3">
            <CopyField label="Webhook URL" :value="webhookUrl" />
            <CopyField label="Method" value="POST" />
            <CopyField label="Headers" :value="'{&quot;Content-Type&quot;: &quot;application/json&quot;}'" />
            <CopyField
              label="JSON body"
              :value="'{&quot;action&quot;: &quot;{action}&quot;, &quot;rating_key&quot;: &quot;{rating_key}&quot;, &quot;username&quot;: &quot;{username}&quot;}'"
              hint="Paste into a Tautulli Webhook agent for each trigger you enable."
            />
          </div>
        </template>
      </UCollapsible>
    </SetupStep>

    <UCollapsible v-model:open="advanced">
      <UButton
        color="neutral"
        variant="ghost"
        class="min-h-11"
        trailing-icon="i-lucide-chevron-down"
        label="Advanced"
      />
      <template #content>
        <UCard class="mt-2">
          <div class="space-y-4">
            <div class="flex items-center justify-between gap-3">
              <div class="min-w-0">
                <div class="text-sm font-medium">Forward to seenr</div>
                <p class="text-xs text-muted">Master switch for all forwarding.</p>
              </div>
              <USwitch v-model="store.settings.forward_enabled" />
            </div>
            <UFormField label="seenr base URL" hint="each user's token is appended to this">
              <UInput v-model="store.settings.seenr_base_url" class="w-full" />
            </UFormField>
            <UFormField
              label="Bridge public URL"
              hint="blank = auto-detect; set only behind a reverse proxy"
            >
              <UInput v-model="store.settings.bridge_url" placeholder="https://bridge.example.com" class="w-full" />
            </UFormField>
            <UButton label="Save" class="min-h-11" @click="saveAdvanced" />
          </div>
        </UCard>
      </template>
    </UCollapsible>

    <UModal
      :open="!!edit"
      :title="edit ? `Configure ${edit.username}` : ''"
      @update:open="(v) => { if (!v) edit = null }"
    >
      <template #body>
        <div v-if="edit" class="space-y-4">
          <UFormField label="seenr token">
            <UInput v-model="edit.seenr_token" class="w-full" />
          </UFormField>
          <div class="flex items-center justify-between gap-3">
            <span class="text-sm">Enabled</span>
            <USwitch v-model="edit.enabled" />
          </div>
          <div class="flex items-center justify-between gap-3">
            <span class="text-sm">TV episodes</span>
            <USwitch v-model="edit.sync_episodes" />
          </div>
          <div class="flex items-center justify-between gap-3">
            <span class="text-sm">Movies</span>
            <USwitch v-model="edit.sync_movies" />
          </div>
        </div>
      </template>
      <template #footer>
        <div class="flex w-full flex-wrap justify-between gap-3">
          <UButton color="error" variant="ghost" label="Remove" class="min-h-11" @click="removeEdit" />
          <div class="flex gap-3">
            <UButton color="neutral" variant="ghost" label="Cancel" class="min-h-11" @click="edit = null" />
            <UButton label="Save" class="min-h-11" @click="saveEdit" />
          </div>
        </div>
      </template>
    </UModal>
  </div>
</template>
