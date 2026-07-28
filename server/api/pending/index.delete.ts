import { deletePendingWatches } from '../../utils/db'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ rating_key?: string; mapping_ids?: number[] }>(event)

  const rating_key = String(body?.rating_key ?? '').trim()
  if (!rating_key) throw createError({ statusCode: 400, statusMessage: 'rating_key is required' })

  const ids = (Array.isArray(body?.mapping_ids) ? body.mapping_ids : [])
    .map(Number)
    .filter((n) => Number.isInteger(n))

  return { removed: deletePendingWatches(rating_key, ids) }
})
