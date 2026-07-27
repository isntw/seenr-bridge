import { setSharedTitle, getSettings } from '../../utils/db'
import { getMetadata } from '../../utils/tautulli'

// Plex's id for the title, which is what the pipeline matches a watch against — the
// same show in two libraries has two rating_keys but one guid. Resolved here, on a
// rare action, rather than trusting the client: the item picker's rows come from
// get_library_media_info, which does not carry it.
//
// A failure leaves it null rather than blocking the save; /api/shared retries the
// lookup on every load, and the rating_key match still covers the common case
// meanwhile.
async function resolveGuid(rating_key: string): Promise<string | undefined> {
  const s = getSettings()
  if (!s.tautulli_url || !s.tautulli_apikey) return undefined
  try {
    return (await getMetadata(s.tautulli_url, s.tautulli_apikey, rating_key)).guid || undefined
  } catch {
    return undefined
  }
}

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

  // Only for a real save, never for the delete path (profiles: []), which would spend
  // a Tautulli round-trip resolving a guid for a row it is about to remove.
  const guid = profiles.length ? await resolveGuid(String(rating_key)) : undefined

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
      guid,
      // Absent means off, not unknown: both the add flow and the edit modal always
      // send the checkbox, and defaulting to off is what keeps an upgrade from
      // writing into anyone's Plex.
      plex_sync: b.plex_sync ? 1 : 0,
    },
    profiles,
  )

  return { ok: true, profiles }
})
