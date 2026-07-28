import { addPendingWatches, listMappings } from '../../utils/db'

export default defineEventHandler(async (event) => {
  const body = await readBody<{
    rating_key?: string
    guid?: string
    mapping_ids?: number[]
    plex_sync?: boolean
  }>(event)

  const rating_key = String(body?.rating_key ?? '').trim()
  if (!rating_key) throw createError({ statusCode: 400, statusMessage: 'rating_key is required' })

  const requested = Array.isArray(body?.mapping_ids) ? body.mapping_ids.map(Number) : []
  if (!requested.length) throw createError({ statusCode: 400, statusMessage: 'Pick at least one profile' })

  const known = new Set(listMappings().map((m) => m.id))
  const unknown = requested.filter((id) => !known.has(id))
  if (unknown.length)
    throw createError({ statusCode: 400, statusMessage: `Unknown profile id ${unknown.join(', ')}` })

  return {
    added: addPendingWatches(rating_key, body?.guid || null, requested, !!body?.plex_sync),
  }
})
