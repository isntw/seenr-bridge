import crypto from 'node:crypto'
import { getPosterSecret } from './db'

/**
 * Notification art has to be fetchable without a session. The browser fetches
 * `icon`/`image` from its own network stack, outside any page and often with the
 * app closed, so /api/image's session gate cannot be relied on there — but making
 * the endpoint public would hand out an image proxy authenticated with the
 * operator's Tautulli API key. Signing each path closes that: /api/push/poster
 * serves only paths this server produced, and only until they expire.
 */
const TTL_MS = 7 * 24 * 60 * 60 * 1000

/**
 * Tautulli resizes to exactly the box it is asked for, so the box has to match the
 * art's own shape or the image comes back stretched. A poster is 2:3 (which is why
 * /api/image asks for 92x138) and an episode still is 16:9. Asking for a square —
 * as this did in 2.6.3 — squashed every poster.
 */
export const POSTER_BOX = { w: 384, h: 576 } as const
export const WIDE_BOX = { w: 1280, h: 720 } as const

export interface PosterBox {
  w: number
  h: number
}

function sign(imgPath: string, box: PosterBox, exp: number): string {
  return crypto
    .createHmac('sha256', getPosterSecret())
    .update(`${imgPath}:${box.w}:${box.h}:${exp}`)
    .digest('hex')
}

/** A relative, signed URL for a Plex art path, or '' when there is no art. */
export function posterUrl(
  imgPath: string | undefined,
  box: PosterBox = POSTER_BOX,
  now = Date.now(),
): string {
  if (!imgPath) return ''

  const exp = now + TTL_MS
  const q = new URLSearchParams({
    path: imgPath,
    w: String(box.w),
    h: String(box.h),
    exp: String(exp),
    sig: sign(imgPath, box, exp),
  })
  return `/api/push/poster?${q}`
}

/** The requested box, or null when anything about the request fails to verify. */
export function verifiedPosterBox(
  imgPath: string,
  w: string | number,
  h: string | number,
  exp: string | number,
  sig: string,
  now = Date.now(),
): PosterBox | null {
  const expiry = Number(exp)
  const box = { w: Number(w), h: Number(h) }

  if (!imgPath || !sig || !Number.isFinite(expiry) || expiry < now) return null
  if (!Number.isInteger(box.w) || !Number.isInteger(box.h)) return null

  const expected = Buffer.from(sign(imgPath, box, expiry))
  const given = Buffer.from(sig)
  // Lengths must match before timingSafeEqual, which throws otherwise.
  if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) return null

  // Dimensions are inside the signature, so only boxes this server chose can get
  // here — no clamping needed, and none that could silently change the aspect.
  return box
}
