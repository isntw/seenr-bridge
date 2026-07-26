import { getSettings } from '../utils/db'
import { fetchImage } from '../utils/tautulli'

export default defineEventHandler(async (event) => {
  const imgPath = String(getQuery(event).path || '')

  // Only ever proxy Plex metadata art. Without this the endpoint becomes an
  // open proxy authenticated with the user's Tautulli API key.
  if (!imgPath.startsWith('/library/metadata/')) {
    throw createError({ statusCode: 400, statusMessage: 'invalid image path' })
  }

  const s = getSettings()
  if (!s.tautulli_url || !s.tautulli_apikey) {
    throw createError({ statusCode: 404, statusMessage: 'Tautulli not configured' })
  }

  try {
    const img = await fetchImage(s.tautulli_url, s.tautulli_apikey, imgPath)
    if (!img) throw createError({ statusCode: 404, statusMessage: 'not found' })

    setHeader(event, 'Content-Type', img.contentType)
    setHeader(event, 'Cache-Control', 'public, max-age=86400')
    return img.buffer
  } catch (e: unknown) {
    if (e && typeof e === 'object' && 'statusCode' in e) throw e
    throw createError({ statusCode: 502, statusMessage: 'image fetch failed' })
  }
})
