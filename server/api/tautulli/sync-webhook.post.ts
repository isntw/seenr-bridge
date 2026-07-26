import { getSettings } from '../../utils/db'
import { syncSeenrWebhook } from '../../utils/tautulli'
import type { SyncResult } from '../../../shared/types'

export default defineEventHandler(async (event): Promise<SyncResult> => {
  const s = getSettings()
  if (!s.tautulli_url || !s.tautulli_apikey) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Configure and save the Tautulli connection first.',
    })
  }

  // bridge_url wins if set (reverse proxy); otherwise infer from this request.
  let baseUrl = (s.bridge_url || '').trim().replace(/\/+$/, '')
  if (!baseUrl) {
    const proto = getRequestHeader(event, 'x-forwarded-proto') || 'http'
    baseUrl = `${proto}://${getRequestHeader(event, 'host')}`
  }
  const webhookUrl = `${baseUrl}/api/webhook/tautulli`

  const body = await readBody<{ triggers?: unknown }>(event).catch(() => ({}) as { triggers?: unknown })
  const triggers = Array.isArray(body?.triggers)
    ? body.triggers.filter((t): t is string => typeof t === 'string')
    : undefined

  try {
    const r = await syncSeenrWebhook(s.tautulli_url, s.tautulli_apikey, webhookUrl, { triggers })
    return { ok: true, webhookUrl, ...r }
  } catch (e: unknown) {
    throw createError({
      statusCode: 500,
      statusMessage: e instanceof Error ? e.message : String(e),
      data: { webhookUrl },
    })
  }
})
