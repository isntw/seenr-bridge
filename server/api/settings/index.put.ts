import { saveSettings, settingsToWire, type SettingsRow } from '../../utils/db'
import type { Settings } from '../../../shared/types'

function validate(raw: unknown): Partial<SettingsRow> {
  const b = (raw ?? {}) as Record<string, unknown>
  const str = (v: unknown) => (typeof v === 'string' ? v.trim() : undefined)
  const bool = (v: unknown) => (v === undefined ? undefined : v ? 1 : 0)

  return {
    tautulli_url: str(b.tautulli_url),
    tautulli_apikey: str(b.tautulli_apikey),
    seenr_base_url: str(b.seenr_base_url),
    bridge_url: str(b.bridge_url),
    forward_enabled: bool(b.forward_enabled),
    sync_movies: bool(b.sync_movies),
    sync_episodes: bool(b.sync_episodes),
  }
}

export default defineEventHandler(async (event): Promise<Settings> => {
  const patch = await readValidatedBody(event, validate)
  return settingsToWire(saveSettings(patch))
})
