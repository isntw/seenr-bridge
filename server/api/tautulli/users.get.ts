import { getSettings } from '../../utils/db'
import { getUsers } from '../../utils/tautulli'

export default defineEventHandler(async () => {
  const s = getSettings()
  if (!s.tautulli_url || !s.tautulli_apikey) return { ok: false, users: [] as string[] }
  try {
    return { ok: true, users: await getUsers(s.tautulli_url, s.tautulli_apikey) }
  } catch (e: unknown) {
    return { ok: false, users: [] as string[], error: e instanceof Error ? e.message : String(e) }
  }
})
