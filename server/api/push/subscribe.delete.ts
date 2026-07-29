import { deletePushSubscriptionByEndpoint } from '../../utils/db'

export default defineEventHandler(async (event) => {
  const b = await readBody<{ endpoint?: unknown }>(event).catch(() => ({}) as { endpoint?: unknown })
  const endpoint = typeof b?.endpoint === 'string' ? b.endpoint.trim() : ''
  if (!endpoint) throw createError({ statusCode: 400, statusMessage: 'Missing endpoint' })

  deletePushSubscriptionByEndpoint(endpoint)
  return { ok: true }
})
