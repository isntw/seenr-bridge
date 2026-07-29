import crypto from 'node:crypto'
import type { H3Event } from 'h3'
import { getCookie, setCookie, deleteCookie } from 'h3'
import { getSessionByToken, getUserById, createSession, SESSION_TTL_SECONDS, type User } from './db'

export const SESSION_COOKIE = 'sb_session'

// Tautulli cannot hold a session cookie, so the webhook authenticates with a shared
// secret that syncSeenrWebhook writes into the notifier's headers.
export const WEBHOOK_SECRET_HEADER = 'x-seenr-bridge-secret'

/** True when `expected` is '' — an install whose notifier predates authentication
 *  must keep working until it re-syncs. */
export function webhookSecretValid(provided: string | undefined, expected: string): boolean {
  if (!expected) return true
  if (!provided) return false
  const a = Buffer.from(provided)
  const b = Buffer.from(expected)
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}

// Derived from the same constant the DB uses to expire session rows
// (server/utils/db.ts), so the cookie's Max-Age and the server-side window
// cannot drift apart.
const MAX_AGE = SESSION_TTL_SECONDS

export function hashPassword(pw: string): string {
  const salt = crypto.randomBytes(16)
  const hash = crypto.scryptSync(pw, salt, 64)
  return salt.toString('hex') + ':' + hash.toString('hex')
}

export function verifyPassword(pw: string, stored: string): boolean {
  const [saltHex, hashHex] = (stored || '').split(':')
  if (!saltHex || !hashHex) return false
  const expected = Buffer.from(hashHex, 'hex')
  const actual = crypto.scryptSync(pw, Buffer.from(saltHex, 'hex'), 64)
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual)
}

export function currentUser(event: H3Event): User | undefined {
  const token = getCookie(event, SESSION_COOKIE)
  if (!token) return undefined
  const sess = getSessionByToken(token)
  return sess ? getUserById(sess.user_id) : undefined
}

export function setSessionCookie(event: H3Event, userId: number): void {
  setCookie(event, SESSION_COOKIE, createSession(userId), {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: MAX_AGE,
  })
}

export function clearSessionCookie(event: H3Event): void {
  deleteCookie(event, SESSION_COOKIE, { path: '/' })
}

// Exactly these bypass the auth gate. Tautulli cannot authenticate, and the
// login screen needs status/login/register before a session exists.
export const PUBLIC_API_PATHS = new Set([
  '/api/health',
  '/api/version',
  '/api/webhook/tautulli',
  '/api/auth/status',
  '/api/auth/login',
  '/api/auth/register',
  '/api/auth/logout',
  // Plex sign-in happens before a session exists, so both steps must be reachable
  // unauthenticated. Exact paths, never a prefix: the PIN id travels in the POST body
  // precisely so no dynamic segment is needed here — see the note on ICON_PATH_PREFIX
  // below for what prefix matching costs. Neither endpoint grants anything by itself;
  // /poll only issues a session for a Plex account the operator has already linked.
  '/api/auth/plex/start',
  '/api/auth/plex/poll',
])

// @nuxt/icon serves the bundled icon collections from /api/_nuxt_icon/<name>.json
// at runtime, so gating it means no icon renders on a page reachable without a
// session — the login button's :loading spinner is one. The payload is static
// open-source SVG data with nothing user-specific in it, so it is public.
const ICON_PATH_PREFIX = '/api/_nuxt_icon/'
// One plain segment only. A bare startsWith would also accept
// /api/_nuxt_icon/%2e%2e/settings, which the gate sees literally (getRequestURL
// normalises real `..` but not its encoded form) while the router may decode it.
const ICON_COLLECTION = /^[a-zA-Z0-9._-]+$/

// The middleware's full decision, extracted so it can be unit-tested without
// constructing an H3Event. Non-/api/ paths pass through untouched (pages,
// assets), public /api paths pass through unauthenticated, everything else
// requires a session.
export function requiresAuth(path: string): boolean {
  if (!path.startsWith('/api/')) return false
  if (PUBLIC_API_PATHS.has(path)) return false
  if (path.startsWith(ICON_PATH_PREFIX)) {
    return !ICON_COLLECTION.test(path.slice(ICON_PATH_PREFIX.length))
  }
  return true
}
