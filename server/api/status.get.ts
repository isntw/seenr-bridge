import { getSettings, listMappings } from '../utils/db'
import { testConnection, bridgeWebhookExists } from '../utils/tautulli'
import type { Status } from '../../shared/types'

export default defineEventHandler(async (): Promise<Status> => {
  const s = getSettings()
  const configured = !!(s.tautulli_url && s.tautulli_apikey)
  const tautulli = configured
    ? await testConnection(s.tautulli_url, s.tautulli_apikey)
    : { ok: false, message: 'not configured' }

  let webhook = false
  if (tautulli.ok) {
    try {
      webhook = await bridgeWebhookExists(s.tautulli_url, s.tautulli_apikey)
    } catch {
      webhook = false
    }
  }

  return { tautulli, webhook, users: listMappings().length }
})
