import { saveSettings, settingsToWire, type SettingsRow } from '../../utils/db'
import type { Settings } from '../../../shared/types'

function validate(raw: unknown): Partial<SettingsRow> {
  const b = (raw ?? {}) as Record<string, unknown>
  const str = (v: unknown) => (typeof v === 'string' ? v.trim() : undefined)
  const bool = (v: unknown) => (v === undefined ? undefined : v ? 1 : 0)

  // The wire form is a string[]; storage is JSON in one TEXT column. Anything
  // that isn't an array is left `undefined` so saveSettings keeps the current
  // value rather than wiping the selection — same contract as every other field
  // here, which is what lets a partial PUT stay safe.
  const libraries = Array.isArray(b.libraries)
    ? JSON.stringify(b.libraries.map(String))
    : undefined

  // Same partial-PUT contract as libraries above. Note the stored empty array
  // means "notify nobody", so a caller CAN legitimately clear the selection —
  // unlike libraries, where empty means every library.
  const notify_users = Array.isArray(b.notify_users)
    ? JSON.stringify(b.notify_users.map(String))
    : undefined

  return {
    tautulli_url: str(b.tautulli_url),
    tautulli_apikey: str(b.tautulli_apikey),
    seenr_base_url: str(b.seenr_base_url),
    bridge_url: str(b.bridge_url),
    forward_enabled: bool(b.forward_enabled),
    sync_movies: bool(b.sync_movies),
    sync_episodes: bool(b.sync_episodes),
    libraries,
    plex_token: str(b.plex_token),
    notify_enabled: bool(b.notify_enabled),
    notify_users,
  }
}

export default defineEventHandler(async (event): Promise<Settings> => {
  const patch = await readValidatedBody(event, validate)
  return settingsToWire(saveSettings(patch))
})
