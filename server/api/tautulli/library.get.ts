import { getSettings } from '../../utils/db'
import { getLibraryItems } from '../../utils/tautulli'
import type { LibraryItem } from '../../../shared/types'

export default defineEventHandler(async (event) => {
  const s = getSettings()
  if (!s.tautulli_url || !s.tautulli_apikey) return { ok: false, items: [] as LibraryItem[], total: 0 }

  const q = getQuery(event)
  const type = q.type === 'movie' ? 'movie' : 'show'

  try {
    const r = await getLibraryItems(s.tautulli_url, s.tautulli_apikey, {
      type,
      search: typeof q.search === 'string' ? q.search : '',
      start: Number(q.start) || 0,
      length: Math.min(Number(q.length) || 50, 200),
    })
    return { ok: true, ...r }
  } catch (e: unknown) {
    return { ok: false, items: [] as LibraryItem[], total: 0, error: e instanceof Error ? e.message : String(e) }
  }
})
