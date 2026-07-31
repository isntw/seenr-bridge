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

function sign(imgPath: string, exp: number): string {
  return crypto
    .createHmac('sha256', getPosterSecret())
    .update(`${imgPath}:${exp}`)
    .digest('hex')
}

/** A relative, signed URL for a Plex art path, or '' when there is no art. */
export function posterUrl(imgPath: string | undefined, now = Date.now()): string {
  if (!imgPath) return ''

  const exp = now + TTL_MS
  const q = new URLSearchParams({ path: imgPath, exp: String(exp), sig: sign(imgPath, exp) })
  return `/api/push/poster?${q}`
}

export function posterSignatureValid(
  imgPath: string,
  exp: string | number,
  sig: string,
  now = Date.now(),
): boolean {
  const expiry = Number(exp)
  if (!imgPath || !sig || !Number.isFinite(expiry) || expiry < now) return false

  const expected = Buffer.from(sign(imgPath, expiry))
  const given = Buffer.from(sig)
  // Lengths must match before timingSafeEqual, which throws otherwise.
  return expected.length === given.length && crypto.timingSafeEqual(expected, given)
}
