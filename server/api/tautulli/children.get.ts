import { getSettings } from '../../utils/db'
import { getChildren } from '../../utils/tautulli'
import type { LibraryChild } from '../../../shared/types'

export default defineEventHandler(async (event) => {
  const s = getSettings()
  if (!s.tautulli_url || !s.tautulli_apikey) return { ok: false, items: [] as LibraryChild[] }

  const q = getQuery(event)
  const ratingKey = typeof q.rating_key === 'string' ? q.rating_key.trim() : ''
  if (!ratingKey) return { ok: false, items: [] as LibraryChild[], error: 'rating_key is required' }

  try {
    return { ok: true, items: await getChildren(s.tautulli_url, s.tautulli_apikey, ratingKey) }
  } catch (e: unknown) {
    return { ok: false, items: [] as LibraryChild[], error: e instanceof Error ? e.message : String(e) }
  }
})
