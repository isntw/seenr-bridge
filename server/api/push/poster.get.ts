import { getSettings } from '../../utils/db'
import { verifiedPosterBox } from '../../utils/poster'
import { fetchImage } from '../../utils/tautulli'

// Public, unlike /api/image: the browser fetches notification art with no page in
// play. The signature is what keeps it from being an open proxy — see poster.ts.
export default defineEventHandler(async (event) => {
  const q = getQuery(event)
  const imgPath = String(q.path || '')

  const box = verifiedPosterBox(
    imgPath,
    String(q.w || ''),
    String(q.h || ''),
    String(q.exp || ''),
    String(q.sig || ''),
  )
  if (!box) {
    throw createError({ statusCode: 403, statusMessage: 'invalid or expired signature' })
  }

  // Belt and braces behind the signature, matching /api/image: a signature only
  // proves this server produced the path, not that the path is art.
  if (!imgPath.startsWith('/library/metadata/') || imgPath.includes('..')) {
    throw createError({ statusCode: 400, statusMessage: 'invalid image path' })
  }

  const s = getSettings()
  if (!s.tautulli_url || !s.tautulli_apikey) {
    throw createError({ statusCode: 404, statusMessage: 'Tautulli not configured' })
  }

  try {
    const img = await fetchImage(s.tautulli_url, s.tautulli_apikey, imgPath, box.w, box.h)
    if (!img) throw createError({ statusCode: 404, statusMessage: 'not found' })

    setHeader(event, 'Content-Type', img.contentType)
    setHeader(event, 'Cache-Control', 'public, max-age=86400')
    return img.buffer
  } catch (e: unknown) {
    if (e && typeof e === 'object' && 'statusCode' in e) throw e
    throw createError({ statusCode: 502, statusMessage: 'image fetch failed' })
  }
})
