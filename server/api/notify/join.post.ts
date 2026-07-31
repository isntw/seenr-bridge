import { joinSharedTitle } from '../../utils/notify'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ rating_key?: string }>(event)

  const rating_key = String(body?.rating_key ?? '').trim()
  if (!rating_key) throw createError({ statusCode: 400, statusMessage: 'rating_key is required' })

  const result = await joinSharedTitle(rating_key)
  if (!result.ok) {
    throw createError({ statusCode: 400, statusMessage: result.reason || 'Could not share that.' })
  }

  return result
})
