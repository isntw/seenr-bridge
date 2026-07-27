import { defineStore } from 'pinia'
import type { Settings, Mapping, SyncResult, LibrarySection } from '../../shared/types'

export const useSettingsStore = defineStore('settings', () => {
  const settings = ref<Settings | null>(null)
  const mappings = ref<Mapping[]>([])
  const tautulliUsers = ref<string[]>([])

  async function fetch() {
    const [s, m] = await Promise.all([
      $fetch<Settings>('/api/settings'),
      $fetch<Mapping[]>('/api/mappings'),
    ])
    settings.value = s
    mappings.value = m
  }

  async function save(patch: Partial<Settings>) {
    settings.value = await $fetch<Settings>('/api/settings', { method: 'PUT', body: patch })
  }

  // Forwarding is toggled from the page header, where other fields may hold
  // unsaved edits. save() replaces the whole settings object with the server's
  // row, which would silently revert them — so this merges back only the one
  // field it owns.
  async function setForwarding(v: boolean) {
    const s = await $fetch<Settings>('/api/settings', { method: 'PUT', body: { forward_enabled: v } })
    if (settings.value) settings.value.forward_enabled = s.forward_enabled
  }

  async function saveMapping(m: {
    username: string
    seenr_token: string
    enabled?: boolean
    sync_movies?: boolean
    sync_episodes?: boolean
  }) {
    await $fetch<Mapping>('/api/mappings', { method: 'POST', body: m })
    mappings.value = await $fetch<Mapping[]>('/api/mappings')
  }

  async function removeMapping(id: number) {
    await $fetch(`/api/mappings/${id}`, { method: 'DELETE' })
    mappings.value = mappings.value.filter((m) => m.id !== id)
  }

  function testTautulli(patch?: Partial<Settings>) {
    return $fetch<{ ok: boolean; message: string }>('/api/settings/test-tautulli', {
      method: 'POST',
      body: patch ?? {},
    })
  }

  function syncWebhook(triggers: string[]) {
    return $fetch<SyncResult>('/api/tautulli/sync-webhook', {
      method: 'POST',
      body: { triggers },
    })
  }

  // The library sections Tautulli monitors. Kept out of `settings` because it is
  // live data read from Tautulli, not something we persist — only the operator's
  // selection of section_ids is stored.
  const tautulliLibraries = ref<LibrarySection[]>([])
  const librariesError = ref<string | null>(null)

  async function fetchLibraries() {
    const r = await $fetch<{ ok: boolean; items: LibrarySection[]; error?: string }>(
      '/api/tautulli/libraries',
    )
    tautulliLibraries.value = r.items
    librariesError.value = r.ok
      ? null
      : r.error || 'Tautulli isn’t configured yet — add its URL and API key above.'
  }

  async function fetchTautulliUsers() {
    const r = await $fetch<{ ok: boolean; users: string[] }>('/api/tautulli/users')
    tautulliUsers.value = r.users
  }

  return {
    settings, mappings, tautulliUsers, tautulliLibraries, librariesError,
    fetch, save, setForwarding, saveMapping, removeMapping, testTautulli, syncWebhook,
    fetchTautulliUsers, fetchLibraries,
  }
})
