<script setup lang="ts">
import type { Mapping, TestResult } from '../../shared/types'
import { apiErrorMessage } from '../../shared/errors'

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

// Chips are aria-pressed buttons rather than checkboxes, so each derives its own
// pressed state from the array and toggles membership. A shared v-model across
// siblings would fight itself.
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

// Sub-section pills read the same polled status the header and sidebar use — no
// extra request path is introduced.
const connStatus = computed<'ok' | 'bad' | 'pending'>(() =>
  status.tautulli === null ? 'pending' : status.tautulli.ok ? 'ok' : 'bad',
)
const connStatusText = computed(() =>
  status.tautulli === null ? 'checking…' : status.tautulli.ok ? 'connected' : 'unreachable',
)
const hookStatus = computed<'ok' | 'bad'>(() => (status.webhook ? 'ok' : 'bad'))
const hookStatusText = computed(() => (status.webhook ? 'active' : 'not set up'))

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
    forward_enabled: store.settings!.forward_enabled,
    seenr_base_url: store.settings!.seenr_base_url,
    bridge_url: store.settings!.bridge_url,
  })
  toast.add({ title: 'Saved.', color: 'success' })
}

// Preview and Send share this — the only difference is dryRun (build the
// payload without forwarding, vs. actually posting to seenr and recording an
// event row). Both hit the authed /api/test endpoint directly since the
// result is page-local scratch state, not shared app state like settings.
async function runTest(dryRun: boolean) {
  if (!testRatingKey.value.trim() || !testUsername.value.trim()) {
    toast.add({ title: 'rating_key and username are both required.', color: 'error' })
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
  <div v-if="store.settings" class="space-y-6">
    <!-- "Setup" on the left, the live status line on the right — the old page
         header. Both wrap rather than overflowing on narrow screens. -->
    <div class="flex flex-wrap items-center justify-between gap-3">
      <h2 class="text-lg font-semibold text-highlighted">Setup</h2>
      <div class="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
        <span class="flex items-center gap-1.5">
          <span
            class="size-1.5 rounded-full"
            :class="status.tautulli === null ? 'bg-neutral-500' : status.tautulli.ok ? 'bg-success' : 'bg-error'"
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
    </div>

    <SetupStep :n="1" title="Tautulli" hint="the source — where playback happens and episode IDs come from">
      <SetupSubsection label="Connection" :status="connStatus" :status-text="connStatusText">
        <div class="grid gap-4 sm:grid-cols-2 sm:items-end">
          <UFormField label="Tautulli URL">
            <UInput v-model="store.settings.tautulli_url" placeholder="http://tautulli:8181" class="w-full" />
          </UFormField>
          <UFormField label="API key">
            <UInput v-model="store.settings.tautulli_apikey" type="password" placeholder="xxxxxxxx" class="w-full" />
          </UFormField>
        </div>
        <!-- Group-level, not per-field: a `help` on one UFormField and not its
             sibling makes that grid cell taller and the row ragged. Keeping the
             hints here is what lets the grid align on items-end. -->
        <p class="text-xs text-dimmed">
          URL e.g. <code class="text-default">http://tautulli:8181</code> · key from Tautulli →
          Settings → Web Interface → API key
        </p>
        <div class="flex flex-col gap-3 border-t border-default pt-4 sm:flex-row sm:justify-end">
          <!-- Below sm the row stacks with the primary on top (order-1), so the
               action you almost always want is the first control you meet as the
               row scrolls into view; the secondary drops beneath it. -->
          <UButton
            color="neutral"
            variant="subtle"
            label="Test connection"
            class="min-h-11 justify-center order-2 sm:order-1"
            @click="testConnection"
          />
          <UButton
            :loading="saving"
            label="Save"
            class="min-h-11 justify-center order-1 sm:order-2"
            @click="saveConnection"
          />
        </div>
      </SetupSubsection>

      <SetupSubsection label="Event webhook" :status="hookStatus" :status-text="hookStatusText" seam>
        <p class="text-xs text-dimmed">
          One webhook in Tautulli covers every user. <strong class="text-default">Watched</strong> is
          the recommended trigger.
        </p>
        <div class="flex flex-wrap gap-2" role="group" aria-label="Triggers to enable">
          <!-- Chips, not checkboxes: the `recommended` badge used to be passed as
               #description to the Watched checkbox, which made that one row
               taller than its four siblings. The badge now folds into the
               selected state and the recommendation moved to the line above. -->
          <button
            v-for="t in TRIGGERS"
            :key="t.key"
            type="button"
            :aria-pressed="isTriggerSelected(t.key)"
            class="min-h-11 rounded-lg px-3.5 text-sm ring-1 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-400"
            :class="isTriggerSelected(t.key)
              ? 'bg-primary-600/20 text-primary-200 ring-primary-400/40'
              : 'bg-default text-muted ring-default hover:text-default'"
            @click="toggleTrigger(t.key, !isTriggerSelected(t.key))"
          >
            {{ t.label }}
          </button>
        </div>
        <div class="flex border-t border-default pt-4 sm:justify-end">
          <UButton
            :loading="syncing"
            label="Sync to Tautulli"
            class="min-h-11 w-full justify-center sm:w-auto"
            @click="runSync"
          />
        </div>

        <!-- Chrome-less on purpose. This is an alternative to the Sync button
             directly above it, not a third page-level section, so it gets no
             card background, ring or radius — unlike Advanced and Test, which
             use DisclosureCard. -->
        <UCollapsible v-model:open="manual" class="border-t border-default pt-2">
          <UButton color="neutral" variant="ghost" class="w-full min-h-11 justify-start gap-2.5 px-0">
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
      <div class="space-y-2">
        <p v-if="!store.mappings.length" class="text-sm text-muted">No users yet. Add one below.</p>

        <!-- Stacks below sm so the Configure button never squeezes the token. -->
        <div
          v-for="m in store.mappings"
          :key="m.id"
          class="flex flex-col gap-2 rounded-lg bg-default px-3 py-2.5 ring-1 ring-default sm:flex-row sm:items-center sm:gap-3"
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
            class="min-h-11 self-start sm:self-auto"
            @click="edit = { ...m }"
          />
        </div>
      </div>

      <!-- items-start (not items-end): the token field's help text below its
           input makes that cell taller than the plain username field, so
           bottom-aligning would misalign the inputs. Top-aligning keeps the
           inputs level since both labels are the same height. -->
      <div class="mt-4 grid gap-3 sm:grid-cols-[1fr_2fr_auto] sm:items-start">
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
        <UFormField label="seenr token" help="the part after /scrobble/plex/ in your seenr URL">
          <UInput v-model="newToken" placeholder="9%7CyourSeenrToken" class="w-full" />
        </UFormField>
        <div>
          <!-- The Add button has no label of its own, so with the row now
               top-aligned it would sit level with the labels above, not the
               inputs. This invisible spacer reproduces a label's height plus
               the label-to-input gap (mirroring UFormField's own
               labelWrapper + `mt-1` container spacing) purely to push the
               button down to input level. See git show 2e675ca for the
               pre-conversion React version, which used the same trick. -->
          <div class="text-sm font-medium select-none" aria-hidden="true">&nbsp;</div>
          <UButton label="Add" class="mt-1 min-h-11 w-full sm:w-auto" @click="addMapping" />
        </div>
      </div>
    </SetupStep>

    <div class="flex items-center gap-3 pt-2">
      <hr class="flex-1 border-muted" />
      <span class="text-xs uppercase tracking-wider text-dimmed">More</span>
      <hr class="flex-1 border-muted" />
    </div>

    <DisclosureCard v-model:open="advanced" title="Advanced" summary="forwarding · seenr URL · bridge URL">
      <div class="flex items-center justify-between gap-3">
        <div class="min-w-0">
          <div class="text-sm font-medium">Forward to seenr</div>
          <p class="text-xs text-muted">Master switch for all forwarding.</p>
        </div>
        <USwitch v-model="store.settings.forward_enabled" />
      </div>
      <UFormField label="seenr base URL" help="each user's token is appended to this">
        <UInput v-model="store.settings.seenr_base_url" class="w-full" />
      </UFormField>
      <UFormField label="Bridge public URL" help="blank = auto-detect; set only behind a reverse proxy">
        <UInput v-model="store.settings.bridge_url" placeholder="https://bridge.example.com" class="w-full" />
      </UFormField>
      <UButton label="Save" class="min-h-11" @click="saveAdvanced" />
    </DisclosureCard>

    <DisclosureCard v-model:open="testPanel" title="Test a scrobble" summary="send a rating_key through the pipeline">
            <p class="text-xs text-muted">
              Runs a <code class="text-default">rating_key</code> through the same pipeline as a
              real Tautulli webhook — useful for checking id matching without waiting for playback.
            </p>

            <!-- items-start (not items-end): the username field's help text
                 below its input makes that cell taller than its siblings, so
                 bottom-aligning would misalign the inputs. -->
            <div class="grid gap-3 sm:grid-cols-3 sm:items-start">
              <UFormField label="rating_key">
                <UInput v-model="testRatingKey" placeholder="25419" class="w-full" />
              </UFormField>
              <UFormField label="username" help="must have a seenr token mapped above">
                <USelectMenu
                  v-model="testUsername"
                  :items="mappedUsernames"
                  create-item
                  placeholder="Select or type…"
                  class="w-full"
                  @create="(item) => { testUsername = item }"
                />
              </UFormField>
              <UFormField label="action">
                <USelectMenu v-model="testAction" :items="TEST_ACTIONS" class="w-full" />
              </UFormField>
            </div>

            <div class="space-y-2">
              <p class="text-xs text-muted">
                <strong class="text-default">Preview</strong> only builds the payload — nothing is
                sent and nothing is recorded.
                <strong class="text-default">Send to seenr for real</strong> actually forwards it
                to this user's seenr account and writes an event row.
              </p>
              <div class="flex flex-wrap gap-3">
                <UButton
                  color="neutral"
                  variant="outline"
                  icon="i-lucide-eye"
                  label="Preview"
                  class="min-h-11"
                  :loading="previewBusy"
                  :disabled="sendBusy"
                  @click="runTest(true)"
                />
                <!-- error (rose), not warning (amber): this is the destructive
                     half of the pair, and amber is not in this palette. -->
                <UButton
                  color="error"
                  icon="i-lucide-send"
                  label="Send to seenr for real"
                  class="min-h-11"
                  :loading="sendBusy"
                  :disabled="previewBusy"
                  @click="runTest(false)"
                />
              </div>
            </div>

            <div v-if="testResult" class="space-y-3 border-t border-default pt-4">
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
        </div>
      </template>
      <template #footer>
        <div class="flex w-full flex-wrap justify-between gap-3">
          <UButton color="error" variant="ghost" label="Remove" class="min-h-11" @click="removeEdit" />
          <div class="flex gap-3">
            <UButton color="neutral" variant="subtle" label="Cancel" class="min-h-11" @click="edit = null" />
            <UButton label="Save" class="min-h-11" @click="saveEdit" />
          </div>
        </div>
      </template>
    </UModal>
  </div>
</template>
