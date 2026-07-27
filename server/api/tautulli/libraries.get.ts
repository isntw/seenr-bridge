import { getSettings } from '../../utils/db'
import { getLibraries } from '../../utils/tautulli'
import type { LibrarySection } from '../../../shared/types'

// The library sections Tautulli monitors, for the chooser in Settings. Mirrors
// library.get.ts: never throws, so a Tautulli problem shows inline instead of
// blanking the page.
export default defineEventHandler(async () => {
  const s = getSettings()
  if (!s.tautulli_url || !s.tautulli_apikey) return { ok: false, items: [] as LibrarySection[] }

  try {
    const items = await getLibraries(s.tautulli_url, s.tautulli_apikey)
    return { ok: true, items }
  } catch (e: unknown) {
    return {
      ok: false,
      items: [] as LibrarySection[],
      error: e instanceof Error ? e.message : String(e),
    }
  }
})
