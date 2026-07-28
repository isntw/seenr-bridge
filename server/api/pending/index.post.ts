import { addPendingWatches, listMappings } from '../../utils/db'

// Records "when this item is watched, count it for these profiles too".
export default defineEventHandler(async (event) => {
  const body = await readBody<{ rating_key?: string; guid?: string; mapping_ids?: number[] }>(event)

  const rating_key = String(body?.rating_key ?? '').trim()
  if (!rating_key) throw createError({ statusCode: 400, statusMessage: 'rating_key is required' })

  const requested = Array.isArray(body?.mapping_ids) ? body.mapping_ids.map(Number) : []
  if (!requested.length) throw createError({ statusCode: 400, statusMessage: 'Pick at least one profile' })

  // Only real mappings: an id from a stale page must 400, not write a row that can
  // never resolve to a seenr token.
  const known = new Set(listMappings().map((m) => m.id))
  const unknown = requested.filter((id) => !known.has(id))
  if (unknown.length)
    throw createError({ statusCode: 400, statusMessage: `Unknown profile id ${unknown.join(', ')}` })

  return { added: addPendingWatches(rating_key, body?.guid || null, requested) }
})
