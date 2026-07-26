import { setSharedTitle } from '../../utils/db'

export default defineEventHandler(async (event) => {
  const b = await readBody<Record<string, unknown>>(event)
  const rating_key = b?.rating_key
  const media_type = b?.media_type

  if (!rating_key || !media_type) {
    throw createError({ statusCode: 400, statusMessage: 'rating_key and media_type required' })
  }

  const profiles = Array.isArray(b.profiles)
    ? b.profiles.map((n) => Number(n)).filter((n): n is number => Number.isInteger(n))
    : []

  setSharedTitle(
    {
      rating_key: String(rating_key),
      media_type: String(media_type),
      title: typeof b.title === 'string' ? b.title : undefined,
      year: typeof b.year === 'string' ? b.year : undefined,
      image: typeof b.image === 'string' ? b.image : undefined,
    },
    profiles,
  )

  return { ok: true, profiles }
})
