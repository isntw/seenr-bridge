import { getSettings } from '../../utils/db'
import { testConnection } from '../../utils/tautulli'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ tautulli_url?: string; tautulli_apikey?: string }>(event)
    .catch(() => ({}) as Record<string, string>)
  const s = getSettings()
  const url = (body?.tautulli_url || s.tautulli_url || '').trim()
  const key = (body?.tautulli_apikey || s.tautulli_apikey || '').trim()

  if (!url || !key) return { ok: false, message: 'URL and API key required' }
  return await testConnection(url, key)
})
