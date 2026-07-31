<script setup lang="ts">
import type {
  Mapping, NotifyMute, PlexLinkStatus, Settings, TestResult,
} from '../../shared/types'
import { apiErrorMessage } from '../../shared/errors'
import { VERSION } from '../../shared/version'
import { timeAgo } from '../utils/time-ago'

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

const push = usePush()
const testingPush = ref(false)

onMounted(() => push.refresh())

const webhookSecret = ref('')

async function loadWebhookSecret() {
  try {
    webhookSecret.value = (
      await $fetch<{ header: string; secret: string }>('/api/tautulli/webhook-secret')
    ).secret
  } catch {
    webhookSecret.value = ''
  }
}

const webhookHeaders = computed(() =>
  JSON.stringify({
    'Content-Type': 'application/json',
    ...(webhookSecret.value ? { 'X-Seenr-Bridge-Secret': webhookSecret.value } : {}),
  }),
)

const notifyBusy = ref(false)

async function saveNotify(patch: Partial<Settings>, ok: string) {
  if (notifyBusy.value) return
  notifyBusy.value = true
  try {
    await store.save(patch)
    toast.add({ title: ok, color: 'success' })
  } catch (e) {
    toast.add({ title: apiErrorMessage(e, 'Could not save.'), color: 'error' })
  } finally {
    notifyBusy.value = false
  }
}

const notifyEnabled = computed({
  get: () => !!store.settings?.notify_enabled,
  set: (v: boolean) =>
    saveNotify(
      { notify_enabled: v },
      v ? 'Notifications on — sync to Tautulli to finish.' : 'Notifications off.',
    ),
})

const notifyUsers = computed(() => store.settings?.notify_users ?? [])

const auth = useAuthStore()

const ownNames = computed(() =>
  [auth.username, auth.plexUsername].filter(Boolean).map((n) => String(n).toLowerCase()),
)

const otherUsers = computed(() =>
  store.tautulliUsers.filter((u) => !ownNames.value.includes(u.toLowerCase())),
)

function toggleNotifyUser(username: string, on: boolean) {
  const next = on
    ? [...notifyUsers.value, username]
    : notifyUsers.value.filter((u) => u !== username)
  saveNotify(
    { notify_users: next },
    on ? `You'll be notified when ${username} starts watching.` : `Stopped notifying about ${username}.`,
  )
}

const DELIVERY = {
  subscribed: 'Receiving notifications.',
  available: 'Not receiving notifications yet.',
  denied: 'Blocked in this browser. Re-allow notifications for this site, then reload.',
  'needs-install': 'Add this to your Home Screen first — tap Share, then “Add to Home Screen”.',
  insecure: 'Browsers only allow notifications on a secure origin, so this needs HTTPS.',
  unsupported: 'This browser has no Web Push support. Try Chrome on Android, or an installed app on iOS 16.4+.',
} as const

const deliveryDetail = computed(() => DELIVERY[push.state.value])

const workerStale = computed(() => push.workerVersion.value !== VERSION)

const workerDetail = computed(() =>
  push.workerVersion.value
    ? workerStale.value
      ? `v${push.workerVersion.value} — the app is v${VERSION}. Update to get the poster and buttons.`
      : `v${push.workerVersion.value} — up to date`
    : 'Older than this feature — update to get the poster and buttons.',
)

const canToggleDelivery = computed(() =>
  push.state.value === 'subscribed' || push.state.value === 'available',
)

function deviceWhen(d: { last_ok: number | null; created: number }) {
  return d.last_ok ? timeAgo(d.last_ok) : 'no sends yet'
}

const { data: notifyMutes, refresh: refreshNotifyMutes } = useAsyncData<NotifyMute[]>(
  'notify-mutes',
  () => $fetch('/api/notify/mutes'),
  { default: (): NotifyMute[] => [], lazy: true },
)

async function unmute(m: NotifyMute) {
  notifyBusy.value = true
  try {
    await $fetch('/api/notify/mutes', { method: 'DELETE', body: { subject_key: m.subject_key } })
    await refreshNotifyMutes()
    toast.add({ title: `Notifications for ${m.title} are back on.`, color: 'success' })
  } catch (e) {
    toast.add({ title: apiErrorMessage(e, 'Could not unmute that.'), color: 'error' })
  } finally {
    notifyBusy.value = false
  }
}

const notifySummary = computed(() => {
  if (!notifyEnabled.value) return 'off'
  const who = notifyUsers.value.length ? `you + ${notifyUsers.value.join(', ')}` : 'you only'
  const muted = notifyMutes.value?.length
  return muted ? `${who} · ${muted} muted` : who
})

async function sendTestPush() {
  testingPush.value = true
  try {
    const r = await push.test()
    toast.add({
      title: r.sent ? `Test sent to ${r.sent} device${r.sent === 1 ? '' : 's'}` : 'Nothing was sent',
      description: r.pruned ? `${r.pruned} dead subscription removed` : undefined,
      color: r.sent ? 'success' : 'warning',
    })
  } catch (e) {
    toast.add({ title: apiErrorMessage(e, 'Test failed'), color: 'error' })
  } finally {
    testingPush.value = false
  }
}

const saving = ref(false)
const syncing = ref(false)
const newUser = ref('')
const newToken = ref('')
const edit = ref<Mapping | null>(null)
const advanced = ref(false)
const notifications = ref(false)
const manual = ref(false)
const testPanel = ref(false)

watch(manual, (open) => {
  if (open && !webhookSecret.value) loadWebhookSecret()
})

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
const hookStatus = computed<'ok' | 'warn' | 'bad' | 'pending'>(() => {
  if (status.tautulli === null) return 'pending'
  if (!status.webhook) return 'bad'
  return status.webhookSecured ? 'ok' : 'warn'
})
const hookStatusText = computed(() => {
  if (status.tautulli === null) return 'checking…'
  if (!status.webhook) return 'not set up'
  return status.webhookSecured ? 'active' : 'unauthenticated'
})

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
    if (r.secret) webhookSecret.value = r.secret
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
    toast.add({ title: v ? 'Syncing enabled.' : 'Syncing paused — nothing reaches seenr or Plex.', color: 'success' })
  } catch (e) {
    store.settings!.forward_enabled = prev
    toast.add({ title: apiErrorMessage(e, 'Could not change syncing.'), color: 'error' })
  } finally {
    forwardingBusy.value = false
  }
}

const plexLink = ref<PlexLinkStatus | null>(null)
const plexBusy = ref(false)
const plexError = ref<string | null>(null)
// Only true until the FIRST read settles. Without it the section renders its
// not-connected state while /api/plex/status is still in flight, so a connected
// install flashes "Sign in with Plex" for a second or two — which reads as "the
// bridge lost my account", the opposite of the truth. Reconnect and Disconnect drive
// `plexBusy` instead, so a refetch never blinks the card back to a skeleton.
const plexLoading = ref(true)
const plexPopup = ref<PlexPopup | null>(null)
let plexCancelled = false

function cancelPlexSignIn() {
  plexCancelled = true
  plexPopup.value?.close()
  plexPopup.value = null
  plexBusy.value = false
}

async function loadPlexLink() {
  try {
    plexLink.value = await $fetch<PlexLinkStatus>('/api/plex/status')
  } catch (e) {
    plexError.value = apiErrorMessage(e, 'Could not read the Plex link status.')
  } finally {
    plexLoading.value = false
  }
}

async function disconnectPlex() {
  plexBusy.value = true
  plexError.value = null
  try {
    await $fetch('/api/plex', { method: 'DELETE' })
    await store.fetch()
    plexLink.value = { connected: false, matched: [], unmatched: [] }
    // Shares keep their switch on purpose — re-linking should not mean re-ticking
    // every title — so say so rather than let it look like nothing happened.
    toast.add({ title: 'Plex disconnected. Shared titles keep their setting.', color: 'success' })
  } catch (e) {
    plexError.value = apiErrorMessage(e, 'Could not disconnect Plex.')
  } finally {
    plexBusy.value = false
  }
}

// No "connected —" prefix: the card only renders once connected, and the chip beside
// this text already carries the state. Phrased as a sentence rather than a ratio,
// because "0 of 0" is what a fresh install would otherwise show — perfectly healthy,
// worded like a failure.
const matchedLabel = computed(() => {
  const l = plexLink.value
  if (!l) return ''
  const total = l.matched.length + l.unmatched.length
  if (!total) return 'no users mapped yet'
  if (!l.unmatched.length) return total === 1 ? '1 user ready' : `all ${total} users ready`
  return `${l.matched.length} of ${total} users ready`
})

// The header's at-a-glance row: one pill per connection, chrome always neutral, a dot
// inside carrying the state. Colouring the whole badge — what SetupSubsection does
// further down, where a badge sits alone beside its own heading — turns a row of three
// into a traffic light; neutral chrome keeps it one quiet strip that does not change
// shape as things go green or red. The cost is that "Tautulli" alone cannot say whether
// it is reachable, so the full sentence rides on title/aria-label.
type StatusPill = {
  key: string
  label: string
  color: 'success' | 'warning' | 'error' | 'neutral'
  state: string
}

const tautulliPill = computed<StatusPill>(() => ({
  key: 'tautulli',
  label: 'Tautulli',
  color: connStatus.value === 'pending' ? 'neutral' : connStatus.value === 'ok' ? 'success' : 'error',
  state:
    connStatus.value === 'pending'
      ? 'Checking Tautulli…'
      : connStatus.value === 'ok'
        ? 'Tautulli connected'
        : 'Tautulli unreachable',
}))

const webhookPill = computed<StatusPill>(() => ({
  key: 'webhook',
  label: 'Webhook',
  color: hookStatus.value === 'pending' ? 'neutral' : hookStatus.value === 'ok' ? 'success' : 'error',
  state:
    hookStatus.value === 'pending'
      ? 'Checking the webhook…'
      : hookStatus.value === 'ok'
        ? 'Webhook active in Tautulli'
        : 'No webhook in Tautulli',
}))

const plexPill = computed<StatusPill>(() => {
  const base = { key: 'plex', label: 'Plex' }
  if (plexLoading.value) return { ...base, color: 'neutral', state: 'Checking Plex…' }
  if (plexError.value) return { ...base, color: 'neutral', state: 'Plex status unavailable' }
  const l = plexLink.value
  // Plex is the optional step, so an unlinked install is neutral rather than an error —
  // red would report a perfectly healthy bridge as broken.
  if (!l?.connected) return { ...base, color: 'neutral', state: 'Plex not connected — optional' }
  // `warning` mirrors the chip in step 3: linked, but some mapped users have no token,
  // so their watches never reach Plex.
  return {
    ...base,
    color: l.unmatched.length ? 'warning' : 'success',
    state: `Plex connected — ${matchedLabel.value}`,
  }
})

const statusPills = computed<StatusPill[]>(() => [
  tautulliPill.value,
  webhookPill.value,
  plexPill.value,
])

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
    plexPopup.value = openPlexPopup(pin.url)

    // Poll to the deadline and no further. A blip mid-poll is skipped rather than
    // aborting the whole sign-in: the operator has already approved in Plex by then,
    // and making them start over for one dropped request is the wrong trade. Every
    // request is bounded, so no single hung call can leave the button spinning.
    const deadline = Date.now() + 120_000
    let approved = false
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 2000))
      if (plexCancelled) return

      try {
        const r = await $fetch<{ pending: boolean }>(`/api/plex/pin/${encodeURIComponent(pin.id)}`, {
          timeout: 10_000,
        })
        if (!r.pending) {
          approved = true
          break
        }
      } catch {
        // transient — try again until the deadline
      }
    }

    // Close it for them either way: a popup left open on a spent PIN is just clutter.
    plexPopup.value?.close()
    plexPopup.value = null

    if (!approved) {
      plexError.value = 'Timed out waiting for Plex. Try again.'
      return
    }
    // Refresh separately: the account IS linked at this point, so a slow status read
    // must not surface as "could not sign in".
    try {
      await store.fetch()
      await loadPlexLink()
    } catch (e) {
      plexError.value = apiErrorMessage(e, 'Signed in, but could not read the status. Reload to check.')
    }
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
      <!-- "Syncing", not "Forwarding": this is the master switch and it gates the Plex
           writes as well, so naming it after one of the two destinations understated
           it. The column stays `forward_enabled` — renaming it would be a migration
           for no behavioural gain.
           Ordered out of DOM sequence on purpose: on a phone the switch belongs next to
           the heading — it is the one control here, and pushing it below the pills buried
           it — while the pills take a full-width second row. From `sm` up all three fit
           one line, so the order flips back to pills-then-switch at the right edge. -->
      <USwitch
        label="Syncing"
        class="order-1 sm:order-2"
        :model-value="store.settings.forward_enabled"
        :disabled="forwardingBusy"
        :title="store.settings.forward_enabled ? 'Nothing is sent to seenr or Plex while this is off' : 'Off — nothing is sent to seenr or Plex'"
        @update:model-value="(v) => toggleForwarding(v === true)"
      />
      <!-- The pills keep a tighter gap than the row itself, so they read as one group
           and the switch beside them stays a separate control rather than a fifth pill. -->
      <div class="order-2 flex w-full flex-wrap items-center gap-2 sm:order-1 sm:ms-auto sm:w-auto">
        <UBadge
          v-for="pill in statusPills"
          :key="pill.key"
          color="neutral"
          variant="subtle"
          size="sm"
          :title="pill.state"
          :aria-label="pill.state"
        >
          <UChip standalone inset size="xs" :color="pill.color" />
          {{ pill.label }}
        </UBadge>
        <!-- A count, not a state, so it gets no dot — the pill is here only to keep the
             group one row of pills instead of pills plus a stray line of text. -->
        <UBadge color="neutral" variant="subtle" size="sm">
          {{ status.users }} {{ status.users === 1 ? 'user' : 'users' }}
        </UBadge>
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
        <UAlert
          v-if="status.tautulli && !status.webhookSecured"
          color="warning"
          variant="subtle"
          icon="i-lucide-shield-alert"
          title="This webhook is unauthenticated"
          description="Anything that can reach the URL can post scrobbles. Sync to Tautulli to add a secret header — required if you expose the bridge beyond your LAN."
        />
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
              <CopyField label="Headers" :value="webhookHeaders" />
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

    <SetupStep :n="3" title="Plex" badge="optional" hint="mark co-watched titles watched in Plex too">
      <UAlert v-if="plexError" color="error" variant="subtle" class="mb-3" :description="plexError" />

      <!-- Shaped like the card below, not a generic bar, so the section does not jump
           when the real thing arrives. -->
      <div
        v-if="plexLoading"
        class="rounded-lg bg-elevated/40 p-3 ring-1 ring-default"
        aria-hidden="true"
      >
        <div class="flex flex-wrap items-start gap-x-3 gap-y-2">
          <USkeleton class="size-9 shrink-0 rounded-md" />
          <div class="min-w-0 flex-1 space-y-2">
            <div class="flex items-center gap-2">
              <USkeleton class="h-4 w-28" />
              <USkeleton class="h-5 w-16" />
            </div>
            <USkeleton class="h-3 w-3/5" />
            <USkeleton class="h-3 w-2/5" />
          </div>
          <!-- Wraps below on a phone exactly like the real buttons do, or the card would
               still jump — the whole point of shaping the skeleton after it. -->
          <div class="flex w-full justify-end sm:w-auto">
            <USkeleton class="h-8 w-28" />
          </div>
        </div>
      </div>

      <!-- Not connected: one sentence and the brand button, nothing else to look at. -->
      <template v-else-if="!plexLink?.connected">
        <p class="text-sm text-muted">
          Sign in once as the server owner. The bridge can then mark a shared title watched
          in each co-watcher's own Plex, not just in seenr.
        </p>
        <div class="mt-3 flex flex-wrap items-center gap-3">
          <PlexSignInButton :loading="plexBusy" @click="signInWithPlex" />
          <span v-if="plexBusy" class="text-xs text-dimmed">
            Approve the request in the Plex tab that just opened…
          </span>
        </div>
      </template>

      <!-- Connected: the server card. Which account, which server, and — the part that
           actually predicts whether a watch will land — which users are reachable. -->
      <template v-else>
        <div class="rounded-lg bg-elevated/40 p-3 ring-1 ring-default">
          <div class="flex flex-wrap items-start gap-x-3 gap-y-2">
            <span
              class="grid size-9 shrink-0 place-items-center rounded-md bg-[#EBAF00]/10 text-[#EBAF00] ring-1 ring-[#EBAF00]/30"
            >
              <svg viewBox="0 0 32 32" class="size-4" aria-hidden="true">
                <path fill="currentColor" d="M15.527 0H6.24l10.239 16L6.24 32h9.287L25.76 16z" />
              </svg>
            </span>

            <div class="min-w-0 flex-1">
              <div class="flex flex-wrap items-center gap-x-2">
                <span class="truncate text-sm font-medium text-highlighted">
                  {{ plexLink.server?.name || 'Plex server' }}
                </span>
                <!-- A chip and muted text, matching the tautulli/webhook indicators in
                     the status bar above, rather than a coloured pill: two green pills
                     beside the name competed with it and read as more urgent than the
                     name itself. -->
                <span class="flex items-center gap-1.5 text-xs">
                  <UChip standalone inset size="xs" :color="plexLink.unmatched.length ? 'warning' : 'success'" />
                  <span :class="plexLink.unmatched.length ? 'text-warning' : 'text-muted'">
                    {{ matchedLabel }}
                  </span>
                </span>
              </div>
              <div class="mt-0.5 truncate text-xs text-dimmed">
                <span v-if="plexLink.account">{{ plexLink.account }}</span>
                <template v-if="plexLink.server?.product"> · {{ plexLink.server.product }}</template>
                <template v-if="plexLink.server?.platform"> · {{ plexLink.server.platform }}</template>
              </div>
              <div v-if="plexLink.server?.url" class="mt-0.5 truncate font-mono text-xs text-dimmed">
                {{ plexLink.server.url }}
              </div>
              <!-- Ownership is only worth saying when it is WRONG. Owning the server is
                   the normal case and a green "owner" badge just added noise; not owning
                   it means every write will fail, which deserves a real warning. -->
              <p v-if="plexLink.server?.owned === false" class="mt-1 text-xs text-warning">
                This account does not own {{ plexLink.server?.name || 'this server' }} — it
                cannot change anyone's watched state on it, and cannot sign in here.
              </p>
              <!-- Owning the server is also what authorises Plex sign-in, so say so here
                   rather than making it a separate setting to find. -->
              <p v-else-if="plexLink.server?.owned" class="mt-1 flex items-center gap-1.5 text-xs text-dimmed">
                <UIcon name="i-lucide-key-round" class="size-3 shrink-0" />
                This account can also sign in to the bridge.
              </p>
            </div>

            <!-- Full width on a phone so the buttons take their own row: kept beside the
                 details they squeezed the column to about a third of the card, which
                 truncated the account and the server URL and broke the sentence below
                 them over three lines. From `sm` up there is room for both. -->
            <div class="flex w-full shrink-0 items-center justify-end gap-1 sm:w-auto">
              <UButton
                color="neutral"
                variant="ghost"
                size="sm"
                icon="i-lucide-refresh-cw"
                :loading="plexBusy"
                label="Reconnect"
                @click="signInWithPlex"
              />
              <UButton
                color="error"
                variant="ghost"
                size="sm"
                icon="i-lucide-trash-2"
                aria-label="Disconnect Plex"
                :disabled="plexBusy"
                @click="disconnectPlex"
              />
            </div>
          </div>

          <p v-if="plexLink.error" class="mt-2 text-xs text-warning">
            Plex couldn't be reached: {{ plexLink.error }}
          </p>
          <p v-else-if="plexLink.unmatched.length" class="mt-2 text-xs text-warning">
            No Plex access for {{ plexLink.unmatched.join(', ') }} — usually a Plex Home
            profile, which Plex doesn't list. Paste a token under Configure for them, or
            their Plex stays untouched.
          </p>
        </div>
      </template>

      <p class="mt-2 text-xs text-dimmed">
        Nothing reaches Plex until you turn on “Mark watched in Plex too” for a shared title.
      </p>
    </SetupStep>

    <div class="flex items-center gap-3 pt-2">
      <hr class="flex-1 border-muted" />
      <span class="text-xs uppercase tracking-wider text-dimmed">More</span>
      <hr class="flex-1 border-muted" />
    </div>
    <DisclosureCard
      v-model:open="notifications"
      title="Notifications"
      :summary="notifySummary"
    >
      <div class="space-y-1">
        <p class="text-sm font-medium text-highlighted">Who to be notified about</p>
        <p class="text-xs text-dimmed">
          Your own playback always notifies you. Add anyone you watch with, then tap the
          notification to count their watch for someone.
        </p>
      </div>

      <div v-if="!otherUsers.length" class="text-xs text-dimmed">
        No other Tautulli users found — check the connection above.
      </div>
      <div v-else class="flex flex-wrap gap-2" role="group" aria-label="People to be notified about">
        <UButton
          v-for="u in otherUsers"
          :key="u"
          :color="notifyUsers.includes(u) ? 'primary' : 'neutral'"
          :variant="notifyUsers.includes(u) ? 'subtle' : 'outline'"
          :leading-icon="notifyUsers.includes(u) ? 'i-lucide-check' : undefined"
          :aria-pressed="notifyUsers.includes(u)"
          :disabled="notifyBusy"
          :label="u"
          @click="toggleNotifyUser(u, !notifyUsers.includes(u))"
        />
      </div>

      <div class="flex items-start justify-between gap-4">
        <div class="min-w-0">
          <p class="text-sm font-medium text-highlighted">Send notifications</p>
        </div>
        <USwitch v-model="notifyEnabled" :disabled="notifyBusy" class="mt-0.5 shrink-0" />
      </div>

      <!-- Absent rather than empty: the only place a mute set from a notification
           can be found, but nothing to explain until there is one. -->
      <template v-if="notifyMutes?.length">
        <USeparator />
        <div class="space-y-1">
          <p class="text-sm font-medium text-highlighted">Muted</p>
          <p class="text-xs text-dimmed">These never notify, whoever plays them.</p>
        </div>
        <div class="space-y-2">
          <div
            v-for="m in notifyMutes"
            :key="m.subject_key"
            class="flex items-center justify-between gap-3"
          >
            <p class="min-w-0 truncate text-sm text-default">{{ m.title }}</p>
            <UButton
              color="neutral"
              variant="subtle"
              size="sm"
              icon="i-lucide-bell"
              :disabled="notifyBusy"
              label="Unmute"
              class="shrink-0"
              @click="unmute(m)"
            />
          </div>
        </div>
      </template>

      <USeparator />

      <div class="flex items-start justify-between gap-4">
        <div class="min-w-0">
          <p class="text-sm font-medium text-highlighted">This device</p>
          <p class="mt-0.5 text-xs text-dimmed">{{ deliveryDetail }}</p>
        </div>
        <UButton
          v-if="canToggleDelivery"
          :loading="push.busy.value"
          :color="push.state.value === 'subscribed' ? 'neutral' : 'primary'"
          :variant="push.state.value === 'subscribed' ? 'subtle' : 'solid'"
          :label="push.state.value === 'subscribed' ? 'Turn off' : 'Turn on'"
          class="mt-0.5 shrink-0"
          @click="push.state.value === 'subscribed' ? push.disable() : push.enable()"
        />
      </div>

      <!-- The worker draws the notification, so a stale one shows the old icon and
           no buttons while the app reports the server's version. -->
      <div v-if="push.state.value === 'subscribed'" class="flex items-start justify-between gap-4">
        <div class="min-w-0">
          <p class="text-sm font-medium text-highlighted">Notification worker</p>
          <p class="mt-0.5 text-xs" :class="workerStale ? 'text-warning' : 'text-dimmed'">
            {{ workerDetail }}
          </p>
        </div>
        <UButton
          v-if="workerStale"
          color="primary"
          variant="subtle"
          :loading="push.busy.value"
          label="Update"
          class="mt-0.5 shrink-0"
          @click="push.updateWorker()"
        />
      </div>

      <template v-if="push.devices.value.length">
        <div class="space-y-2">
          <div
            v-for="d in push.devices.value"
            :key="d.id"
            class="flex items-center justify-between gap-3"
          >
            <p class="min-w-0 truncate text-sm text-default">
              {{ d.label }}
              <span v-if="d.fingerprint === push.ownFingerprint.value" class="text-dimmed">· this device</span>
            </p>
            <div class="flex shrink-0 items-center gap-2">
              <UBadge
                v-if="d.fail_count > 0"
                color="warning"
                variant="subtle"
                size="sm"
                :label="`${d.fail_count} failed`"
              />
              <span v-else class="text-xs text-dimmed">{{ deviceWhen(d) }}</span>
              <UButton
                icon="i-lucide-x"
                color="neutral"
                variant="ghost"
                size="xs"
                :aria-label="`Remove ${d.label}`"
                @click="push.forget(d.id)"
              />
            </div>
          </div>
        </div>
        <div class="flex justify-end">
          <UButton
            :loading="testingPush"
            color="neutral"
            variant="ghost"
            size="xs"
            label="Send a test"
            icon="i-lucide-send"
            @click="sendTestPush"
          />
        </div>
      </template>
    </DisclosureCard>


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
