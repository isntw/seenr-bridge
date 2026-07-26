import crypto from 'node:crypto'
import type { H3Event } from 'h3'
import { getCookie, setCookie, deleteCookie } from 'h3'
import { getSessionByToken, getUserById, createSession, SESSION_TTL_SECONDS, type User } from './db'

export const SESSION_COOKIE = 'sb_session'
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
])

// The middleware's full decision, extracted so it can be unit-tested without
// constructing an H3Event. Non-/api/ paths pass through untouched (pages,
// assets), public /api paths pass through unauthenticated, everything else
// requires a session.
export function requiresAuth(path: string): boolean {
  if (!path.startsWith('/api/')) return false
  if (PUBLIC_API_PATHS.has(path)) return false
  return true
}
