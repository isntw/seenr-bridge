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
      // Absent on an edit-mode save; setSharedTitle COALESCEs rather than wiping.
      section_id: typeof b.section_id === 'string' ? b.section_id : undefined,
      library_name: typeof b.library_name === 'string' ? b.library_name : undefined,
      // Absent means off, not unknown: both the add flow and the edit modal always
      // send the checkbox, and defaulting to off is what keeps an upgrade from
      // writing into anyone's Plex.
      plex_sync: b.plex_sync ? 1 : 0,
    },
    profiles,
  )

  return { ok: true, profiles }
})
