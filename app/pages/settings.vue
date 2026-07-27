<script setup lang="ts">
import type { Mapping, PlexLinkStatus, TestResult } from '../../shared/types'
import { apiErrorMessage } from '../../shared/errors'

const store = useSettingsStore()
const status = useStatusStore()
const toast = useToast()

store.fetch()

onMounted(() => {
  status.start()
  store.fetchTautulliUsers().catch(() => {})
  store.fetchLibraries().catch(() => {})
})
onBeforeUnmount(() => status.stop())

const TRIGGERS = [
  { key: 'watched', label: 'Watched' },
  { key: 'play', label: 'Play' },
  { key: 'stop', label: 'Stop' },
  { key: 'pause', label: 'Pause' },
  { key: 'resume', label: 'Resume' },
]
const selectedTriggers = ref<string[]>(['watched'])

function isTriggerSelected(key: string) {
  return selectedTriggers.value.includes(key)
}

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
const testPanel = ref(false)

const TEST_ACTIONS = ['watched', 'play', 'stop', 'pause', 'resume']
const testRatingKey = ref('')
const testUsername = ref('')
const testAction = ref('watched')
const previewBusy = ref(false)
const sendBusy = ref(false)
const testResult = ref<TestResult | null>(null)

const mappedUsernames = computed(() => store.mappings.map((m) => m.username))

const testResultPayload = computed(() =>
  testResult.value?.payload ? JSON.stringify(testResult.value.payload, null, 2) : '',
)

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

const isConfigured = computed(
  () => !!store.settings?.tautulli_url && !!store.settings?.tautulli_apikey,
)

const connSummary = computed(() => {
  const raw = store.settings?.tautulli_url
  if (!raw) return 'not set'
  try {
    return new URL(raw).host
  } catch {
    return raw
  }
})

const triggerSummary = computed(() =>
  selectedTriggers.value.length ? selectedTriggers.value.join(', ') : 'none selected',
)

const librarySel = ref<string[]>([])
const librariesBusy = ref(false)

let librariesSeeded = false
watch(
  () => store.settings,
  (s) => {
    if (!s || librariesSeeded) return
    librariesSeeded = true
    librarySel.value = [...s.libraries]
  },
  { immediate: true },
)

const libsSorted = computed(() =>
  [...store.tautulliLibraries].sort(
    (a, b) =>
      a.section_type.localeCompare(b.section_type) || a.section_name.localeCompare(b.section_name),
  ),
)

function isLibOn(id: string) {
  return librarySel.value.length === 0 || librarySel.value.includes(id)
}

function toggleLib(id: string, on: boolean) {
  const base = librarySel.value.length
    ? librarySel.value
    : libsSorted.value.map((l) => l.section_id)
  librarySel.value = on ? [...new Set([...base, id])] : base.filter((x) => x !== id)
}

const allLibsOn = computed(
  () => librarySel.value.length === 0 || librarySel.value.length === libsSorted.value.length,
)

function setAllLibs(on: boolean) {
  librarySel.value = on ? [] : ['__none__']
}

async function saveLibraries() {
  librariesBusy.value = true
  try {
    const value = allLibsOn.value ? [] : librarySel.value.filter((x) => x !== '__none__')
    await store.save({ libraries: value })
    librarySel.value = value
    toast.add({
      title: value.length
        ? `Using ${value.length} of ${libsSorted.value.length} libraries.`
        : 'Using all libraries.',
      color: 'success',
    })
  } catch (e) {
    toast.add({ title: apiErrorMessage(e, 'Could not save the library selection.'), color: 'error' })
  } finally {
    librariesBusy.value = false
  }
}

const connStatus = computed<'ok' | 'bad' | 'pending'>(() =>
  status.tautulli === null ? 'pending' : status.tautulli.ok ? 'ok' : 'bad',
)
const connStatusText = computed(() =>
  status.tautulli === null ? 'checking…' : status.tautulli.ok ? 'connected' : 'unreachable',
)
const hookStatus = computed<'ok' | 'bad' | 'pending'>(() =>
  status.tautulli === null ? 'pending' : status.webhook ? 'ok' : 'bad',
)
const hookStatusText = computed(() =>
  status.tautulli === null ? 'checking…' : status.webhook ? 'active' : 'not set up',
)

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
    toast.add({ title: apiErrorMessage(e, 'Could not save.'), color: 'error' })
  } finally {
    saving.value = false
  }
}

type ConnTest = 'idle' | 'busy' | 'ok' | 'bad'
const connTest = ref<ConnTest>('idle')
let connTestRevert: ReturnType<typeof setTimeout> | undefined

const CONN_TEST_HOLD_MS = 5000

const connTestLabel = computed(() =>
  connTest.value === 'ok' ? 'Connected' : connTest.value === 'bad' ? 'Failed' : 'Test connection',
)

onBeforeUnmount(() => clearTimeout(connTestRevert))

async function testConnection() {
  clearTimeout(connTestRevert)
  connTest.value = 'busy'
  try {
    const r = await store.testTautulli({
      tautulli_url: store.settings!.tautulli_url,
      tautulli_apikey: store.settings!.tautulli_apikey,
    })
    connTest.value = r.ok ? 'ok' : 'bad'
    if (!r.ok) toast.add({ title: r.message, color: 'error' })
  } catch (e) {
    connTest.value = 'bad'
    toast.add({ title: apiErrorMessage(e, 'Could not reach the bridge.'), color: 'error' })
  } finally {
    connTestRevert = setTimeout(() => { connTest.value = 'idle' }, CONN_TEST_HOLD_MS)
  }
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
    toast.add({ title: apiErrorMessage(e, 'Could not add user.'), color: 'error' })
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
    plex_token: edit.value.plex_token,
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
    toast.add({ title: apiErrorMessage(e, 'Sync failed.'), color: 'error' })
  } finally {
    syncing.value = false
  }
}

async function saveAdvanced() {
  await store.save({
    seenr_base_url: store.settings!.seenr_base_url,
    bridge_url: store.settings!.bridge_url,
  })
  toast.add({ title: 'Saved.', color: 'success' })
}

const forwardingBusy = ref(false)

async function toggleForwarding(v: boolean) {
  if (forwardingBusy.value) return
  const prev = store.settings!.forward_enabled
  forwardingBusy.value = true
  store.settings!.forward_enabled = v
  try {
    await store.setForwarding(v)
    toast.add({ title: v ? 'Forwarding enabled.' : 'Forwarding paused.', color: 'success' })
  } catch (e) {
    store.settings!.forward_enabled = prev
    toast.add({ title: apiErrorMessage(e, 'Could not change forwarding.'), color: 'error' })
  } finally {
    forwardingBusy.value = false
  }
}

const plexLink = ref<PlexLinkStatus | null>(null)
const plexBusy = ref(false)
const plexError = ref<string | null>(null)

async function loadPlexLink() {
  try {
    plexLink.value = await $fetch<PlexLinkStatus>('/api/plex/users')
  } catch (e) {
    plexError.value = apiErrorMessage(e, 'Could not read the Plex link status.')
  }
}

// The PIN flow: create a PIN, open plex.tv in a new tab, then poll until the operator
// approves it. The token is saved server-side by the poll endpoint and never comes back
// to the browser.
async function signInWithPlex() {
  plexBusy.value = true
  plexError.value = null
  try {
    const pin = await $fetch<{ id: string; code: string; url: string }>('/api/plex/pin', {
      method: 'POST',
    })
    window.open(pin.url, '_blank', 'noopener')

    const deadline = Date.now() + 120_000
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 2000))
      const r = await $fetch<{ pending: boolean }>(`/api/plex/pin/${encodeURIComponent(pin.id)}`)
      if (!r.pending) {
        await store.fetch()
        await loadPlexLink()
        return
      }
    }
    plexError.value = 'Timed out waiting for Plex. Try again.'
  } catch (e) {
    plexError.value = apiErrorMessage(e, 'Could not sign in with Plex.')
  } finally {
    plexBusy.value = false
  }
}

onMounted(() => void loadPlexLink())

async function runTest(dryRun: boolean) {
  if (!testRatingKey.value.trim() || !testUsername.value.trim()) {
    toast.add({ title: 'Pick an item and a user first.', color: 'error' })
    return
  }
  const busy = dryRun ? previewBusy : sendBusy
  busy.value = true
  try {
    testResult.value = await $fetch<TestResult>('/api/test', {
      method: 'POST',
      body: {
        rating_key: testRatingKey.value.trim(),
        username: testUsername.value.trim(),
        action: testAction.value,
        dryRun,
      },
    })
  } catch (e) {
    toast.add({ title: apiErrorMessage(e, 'Test failed.'), color: 'error' })
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div v-if="!store.settings" class="space-y-6">
    <USkeleton class="h-7 w-32" />
    <USkeleton class="h-72 w-full rounded-lg" />
    <USkeleton class="h-56 w-full rounded-lg" />
    <USkeleton class="h-14 w-full rounded-lg" />
  </div>

  <div v-else class="space-y-6">
    <div class="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
      <h2 class="text-lg font-semibold text-highlighted">Setup</h2>
      <div class="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
        <span class="flex items-center gap-1.5">
          <UChip
            standalone
            inset
            size="xs"
            :color="connStatus === 'pending' ? 'neutral' : connStatus === 'ok' ? 'success' : 'error'"
          />
          <span class="text-muted">
            {{ connStatus === 'pending' ? 'checking…' : connStatus === 'ok' ? 'Tautulli connected' : 'Tautulli unreachable' }}
          </span>
        </span>
        <span class="text-dimmed">{{ status.users }} {{ status.users === 1 ? 'user' : 'users' }}</span>
        <span class="flex items-center gap-1.5">
          <UChip
            standalone
            inset
            size="xs"
            :color="hookStatus === 'pending' ? 'neutral' : hookStatus === 'ok' ? 'success' : 'error'"
          />
          <span class="text-muted">
            {{ hookStatus === 'pending' ? 'checking…' : hookStatus === 'ok' ? 'webhook active' : 'no webhook' }}
          </span>
        </span>
        <USwitch
          label="Forwarding"
          :model-value="store.settings.forward_enabled"
          :disabled="forwardingBusy"
          @update:model-value="(v) => toggleForwarding(v === true)"
        />
      </div>
    </div>

    <SetupStep :n="1" title="Tautulli" hint="the source — where playback happens and episode IDs come from">
      <SetupSubsection
        label="Connection"
        :status="connStatus"
        :status-text="connStatusText"
        collapsible
        :start-open="!isConfigured"
        :summary="connSummary"
      >
        <div class="grid gap-4 sm:grid-cols-2 sm:items-end">
          <UFormField label="Tautulli URL">
            <UInput v-model="store.settings.tautulli_url" placeholder="http://tautulli:8181" class="w-full" />
          </UFormField>
          <UFormField label="API key">
            <UInput v-model="store.settings.tautulli_apikey" type="password" placeholder="xxxxxxxx" class="w-full" />
          </UFormField>
        </div>
        <p class="text-xs text-dimmed">
          URL e.g. <code class="text-default">http://tautulli:8181</code> · key from Tautulli →
          Settings → Web Interface → API key
        </p>
        <div class="flex flex-col gap-3 pt-1 sm:flex-row sm:justify-end">
          <UButton
            :loading="connTest === 'busy'"
            :color="connTest === 'ok' ? 'success' : connTest === 'bad' ? 'error' : 'neutral'"
            variant="subtle"
            :icon="connTest === 'ok' ? 'i-lucide-check' : connTest === 'bad' ? 'i-lucide-x' : undefined"
            :label="connTestLabel"
            class="justify-center order-2 sm:order-1"
            @click="testConnection"
          />
          <UButton
            :loading="saving"
            label="Save"
            class="justify-center order-1 sm:order-2"
            @click="saveConnection"
          />
        </div>
      </SetupSubsection>

      <SetupSubsection
        label="Libraries"
        :status="libsSorted.length ? 'ok' : 'pending'"
        :status-text="libsSorted.length ? (allLibsOn ? 'all' : `${librarySel.length} of ${libsSorted.length}`) : '—'"
        seam
        collapsible
        :start-open="false"
        :summary="allLibsOn ? 'every library' : `${librarySel.length} selected`"
      >
        <p class="text-xs text-dimmed">
          Which Plex libraries to read titles from, and to forward playback for. Leave everything
          ticked to use them all — new libraries are then included automatically.
        </p>

        <UAlert
          v-if="store.librariesError"
          color="warning"
          variant="subtle"
          :description="store.librariesError"
        />

        <div v-else-if="!libsSorted.length" class="space-y-1.5">
          <USkeleton v-for="i in 3" :key="i" class="h-11 w-full" />
        </div>

        <template v-else>
          <div class="space-y-1.5">
            <UCheckbox
              v-for="l in libsSorted"
              :key="l.section_id"
              variant="card"
              size="sm"
              :model-value="isLibOn(l.section_id)"
              @update:model-value="(v) => toggleLib(l.section_id, v === true)"
            >
              <template #label>
                <span class="flex items-center gap-2.5">
                  <span class="truncate text-sm text-default">{{ l.section_name }}</span>
                  <UBadge
                    :color="l.section_type === 'movie' ? 'info' : 'primary'"
                    variant="subtle"
                    size="sm"
                    :label="l.section_type"
                  />
                  <UBadge v-if="!l.count" color="neutral" variant="subtle" size="sm" label="empty" />
                  <span class="ml-auto shrink-0 font-mono text-xs font-normal text-dimmed">
                    {{ l.count }}
                  </span>
                </span>
              </template>
            </UCheckbox>
          </div>

          <div class="flex flex-col gap-3 pt-1 sm:flex-row sm:items-center">
            <div class="flex gap-1">
              <UButton variant="link" size="xs" label="Select all" @click="setAllLibs(true)" />
              <UButton variant="link" size="xs" label="None" @click="setAllLibs(false)" />
              <UButton variant="link" size="xs" label="Refresh" @click="store.fetchLibraries()" />
            </div>
            <UButton
              :loading="librariesBusy"
              label="Save libraries"
              class="justify-center sm:ml-auto"
              @click="saveLibraries"
            />
          </div>
        </template>
      </SetupSubsection>

      <SetupSubsection
        label="Event webhook"
        :status="hookStatus"
        :status-text="hookStatusText"
        seam
        collapsible
        :start-open="!isConfigured"
        :summary="triggerSummary"
      >
        <p class="text-xs text-dimmed">
          One webhook in Tautulli covers every user. <strong class="text-default">Watched</strong> is
          the recommended trigger.
        </p>
        <div class="flex flex-wrap gap-2" role="group" aria-label="Triggers to enable">
          <UButton
            v-for="t in TRIGGERS"
            :key="t.key"
            :color="isTriggerSelected(t.key) ? 'primary' : 'neutral'"
            :variant="isTriggerSelected(t.key) ? 'subtle' : 'outline'"
            :leading-icon="isTriggerSelected(t.key) ? 'i-lucide-check' : undefined"
            :aria-pressed="isTriggerSelected(t.key)"
            :label="t.label"
            @click="toggleTrigger(t.key, !isTriggerSelected(t.key))"
          />
        </div>
        <div class="flex pt-1 sm:justify-end">
          <UButton
            :loading="syncing"
            label="Sync to Tautulli"
            class="w-full justify-center sm:w-auto"
            @click="runSync"
          />
        </div>

        <UCollapsible v-model:open="manual">
          <UButton color="neutral" variant="ghost" class="w-full justify-start gap-2.5 px-0">
            <UIcon
              name="i-lucide-chevron-right"
              class="size-4 shrink-0 text-muted transition-transform"
              :class="manual ? 'rotate-90' : ''"
            />
            <span class="text-sm font-medium text-highlighted">Set it up manually instead</span>
          </UButton>
          <template #content>
            <div class="space-y-4 pt-2">
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
      </SetupSubsection>
    </SetupStep>

    <SetupStep :n="2" title="seenr users" hint="each Plex user → their seenr token">
      <p v-if="!store.mappings.length" class="text-sm text-muted">No users yet. Add one below.</p>

      <div v-else class="space-y-2">
        <div
          v-for="m in store.mappings"
          :key="m.id"
          class="flex flex-col gap-2.5 rounded-lg bg-elevated/40 px-3.5 py-3 ring-1 ring-default sm:flex-row sm:items-center sm:gap-3"
        >
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-2 text-sm font-medium text-highlighted">
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
            variant="subtle"
            label="Configure"
            class="self-start sm:self-auto"
            @click="edit = { ...m }"
          />
        </div>
      </div>

      <div class="mt-4 grid gap-3 sm:grid-cols-[1fr_2fr_auto] sm:items-end">
        <UFormField label="Plex username">
          <USelectMenu
            v-model="newUser"
            :items="availableUsers"
            create-item
            placeholder="Select or type…"
            class="w-full"
            @create="(item) => { newUser = item }"
          />
        </UFormField>
        <UFormField label="seenr token">
          <UInput v-model="newToken" placeholder="9%7CyourSeenrToken" class="w-full" />
        </UFormField>
        <UButton label="Add" icon="i-lucide-plus" class="w-full justify-center sm:w-auto" @click="addMapping" />
      </div>
      <p class="mt-2 text-xs text-dimmed">
        Token is the part after <code class="text-default">/scrobble/plex/</code> in your seenr URL.
        Playback by anyone not mapped here is ignored — nothing is forwarded and no event is
        recorded, so it won't show on the Dashboard either.
      </p>
    </SetupStep>

    <SetupStep :n="3" title="Plex" hint="optional — also mark co-watched titles watched in Plex">
      <p class="text-sm text-muted">
        Plex stores "watched" per account, so marking a co-watcher's copy needs their own
        access. Sign in as the server owner once and the bridge finds the rest.
      </p>

      <UAlert v-if="plexError" color="error" variant="subtle" class="mt-3" :description="plexError" />

      <div class="mt-3 flex flex-wrap items-center gap-3">
        <UButton
          :label="plexLink?.connected ? 'Reconnect Plex' : 'Sign in with Plex'"
          :loading="plexBusy"
          icon="i-lucide-link"
          @click="signInWithPlex"
        />
        <span v-if="plexBusy" class="text-xs text-dimmed">
          Approve the request in the Plex tab that just opened…
        </span>
        <template v-else-if="plexLink?.connected">
          <UBadge
            :color="plexLink.unmatched.length ? 'warning' : 'success'"
            variant="subtle"
            size="sm"
            :label="`${plexLink.matched.length} of ${plexLink.matched.length + plexLink.unmatched.length} users matched`"
          />
        </template>
      </div>

      <p v-if="plexLink?.error" class="mt-2 text-xs text-warning">
        Plex reported: {{ plexLink.error }}
      </p>
      <p v-else-if="plexLink?.unmatched.length" class="mt-2 text-xs text-warning">
        No token found for {{ plexLink.unmatched.join(', ') }} — likely a Plex Home profile.
        Add one by hand under Configure for that user, or their Plex will be left alone.
      </p>
      <p class="mt-2 text-xs text-dimmed">
        Nothing is written to Plex until a shared title has "Also mark watched in Plex"
        ticked on the Shared page.
      </p>
    </SetupStep>

    <div class="flex items-center gap-3 pt-2">
      <hr class="flex-1 border-muted" />
      <span class="text-xs uppercase tracking-wider text-dimmed">More</span>
      <hr class="flex-1 border-muted" />
    </div>

    <DisclosureCard v-model:open="advanced" title="Advanced" summary="seenr URL · bridge URL">
      <UFormField label="seenr base URL" help="each user's token is appended to this">
        <UInput v-model="store.settings.seenr_base_url" class="w-full" />
      </UFormField>
      <UFormField label="Bridge public URL" help="blank = auto-detect; set only behind a reverse proxy">
        <UInput v-model="store.settings.bridge_url" placeholder="https://bridge.example.com" class="w-full" />
      </UFormField>
      <UButton label="Save" @click="saveAdvanced" />
    </DisclosureCard>

    <DisclosureCard v-model:open="testPanel" title="Test a scrobble" summary="send a rating_key through the pipeline">
      <p class="text-xs text-muted">
        Sends one item down the same path a Tautulli webhook takes — good for checking ID matching
        without waiting for playback.
      </p>

      <ItemPicker v-model="testRatingKey" />

      <div class="grid gap-3 sm:grid-cols-2 sm:items-end">
        <UFormField label="User">
          <USelectMenu
            v-model="testUsername"
            :items="mappedUsernames"
            create-item
            placeholder="Select or type…"
            class="w-full"
            @create="(item) => { testUsername = item }"
          />
        </UFormField>
        <UFormField label="Action">
          <USelectMenu v-model="testAction" :items="TEST_ACTIONS" class="w-full" />
        </UFormField>
      </div>
      <p class="text-xs text-dimmed">The user must have a seenr token mapped in step 2.</p>

      <USeparator />

      <div class="flex flex-col gap-3 sm:flex-row sm:items-center">
        <UButton
          icon="i-lucide-eye"
          label="Preview"
          class="justify-center"
          :loading="previewBusy"
          :disabled="sendBusy"
          @click="runTest(true)"
        />
        <UButton
          color="error"
          variant="subtle"
          icon="i-lucide-send"
          label="Send for real"
          class="justify-center"
          :loading="sendBusy"
          :disabled="previewBusy"
          @click="runTest(false)"
        />
        <p class="text-xs text-dimmed sm:ml-auto sm:text-right">
          Preview builds the payload only.<br class="hidden sm:block" />
          Send forwards to <strong class="text-default">{{ testUsername || 'the selected user' }}</strong>
          and records an event.
        </p>
      </div>

      <USeparator v-if="testResult" />

      <div v-if="testResult" class="space-y-3">
        <div class="flex flex-wrap items-center gap-2">
          <UBadge
            :color="testResult.ok ? 'success' : testResult.skipped ? 'warning' : 'error'"
            variant="subtle"
            :label="testResult.ok ? 'ok' : testResult.skipped ? 'skipped' : 'failed'"
          />
          <UBadge
            v-if="testResult.media_type"
            color="neutral"
            variant="subtle"
            :label="testResult.media_type"
          />
          <UBadge
            v-if="testResult.seenr_status"
            color="neutral"
            variant="subtle"
            :label="`seenr ${testResult.seenr_status}`"
          />
        </div>

        <div v-if="testResult.title" class="text-sm font-medium">{{ testResult.title }}</div>
        <div v-if="testResult.ids?.length" class="text-xs text-dimmed">
          ids: {{ testResult.ids.join(', ') }}
        </div>

        <UAlert
          v-if="testResult.reason"
          :color="testResult.ok ? 'neutral' : testResult.skipped ? 'warning' : 'error'"
          variant="subtle"
          :description="testResult.reason"
        />

        <pre
          v-if="testResult.payload"
          class="max-h-64 overflow-auto rounded-lg bg-default p-3 text-xs ring-1 ring-default"
        >{{ testResultPayload }}</pre>
      </div>
    </DisclosureCard>

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
          <UFormField
            label="Plex token (optional)"
            help="Only needed when Plex did not report this user — e.g. a Plex Home profile."
          >
            <UInput v-model="edit.plex_token" type="password" placeholder="leave blank to auto-detect" class="w-full" />
          </UFormField>
        </div>
      </template>
      <template #footer>
        <div class="flex w-full flex-wrap justify-between gap-3">
          <UButton color="error" variant="ghost" label="Remove" @click="removeEdit" />
          <div class="flex gap-3">
            <UButton color="neutral" variant="subtle" label="Cancel" @click="edit = null" />
            <UButton label="Save" @click="saveEdit" />
          </div>
        </div>
      </template>
    </UModal>
  </div>
</template>
