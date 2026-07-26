import { defineStore } from 'pinia'
import type { Settings, Mapping, SyncResult } from '../../shared/types'

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

  async function fetchTautulliUsers() {
    const r = await $fetch<{ ok: boolean; users: string[] }>('/api/tautulli/users')
    tautulliUsers.value = r.users
  }

  return {
    settings, mappings, tautulliUsers,
    fetch, save, saveMapping, removeMapping, testTautulli, syncWebhook, fetchTautulliUsers,
  }
})
