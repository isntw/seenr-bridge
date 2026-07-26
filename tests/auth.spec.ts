import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { createEvent } from 'h3'
import {
  hashPassword,
  verifyPassword,
  SESSION_COOKIE,
  PUBLIC_API_PATHS,
  setSessionCookie,
  requiresAuth,
} from '../server/utils/auth'

let tmp: string

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-auth-'))
  process.env.DATA_DIR = tmp
})

afterEach(async () => {
  const db = await import('../server/utils/db')
  db.closeDb()
  fs.rmSync(tmp, { recursive: true, force: true })
})

describe('hashPassword / verifyPassword', () => {
  it('round-trips: verifyPassword is true for the password that produced the hash', () => {
    const hash = hashPassword('correct horse battery staple')
    expect(verifyPassword('correct horse battery staple', hash)).toBe(true)
  })

  it('is false for a wrong password', () => {
    const hash = hashPassword('correct horse battery staple')
    expect(verifyPassword('wrong password', hash)).toBe(false)
  })

  it('salts each call independently, and both hashes still verify', () => {
    const first = hashPassword('same')
    const second = hashPassword('same')

    // Proves the salt is not fixed: same input, different stored strings.
    expect(first).not.toBe(second)
    expect(verifyPassword('same', first)).toBe(true)
    expect(verifyPassword('same', second)).toBe(true)
  })

  it('rejects malformed stored hashes rather than throwing', () => {
    expect(() => verifyPassword('x', '')).not.toThrow()
    expect(verifyPassword('x', '')).toBe(false)

    expect(() => verifyPassword('x', 'nosalt')).not.toThrow()
    expect(verifyPassword('x', 'nosalt')).toBe(false)

    expect(() => verifyPassword('x', 'abc:')).not.toThrow()
    expect(verifyPassword('x', 'abc:')).toBe(false)
  })
})

describe('SESSION_COOKIE', () => {
  it("is 'sb_session'", () => {
    expect(SESSION_COOKIE).toBe('sb_session')
  })
})

describe('PUBLIC_API_PATHS', () => {
  it('contains exactly the seven expected bypass paths', () => {
    expect(PUBLIC_API_PATHS.size).toBe(7)
    expect(new Set(PUBLIC_API_PATHS)).toEqual(
      new Set([
        '/api/health',
        '/api/version',
        '/api/webhook/tautulli',
        '/api/auth/status',
        '/api/auth/login',
        '/api/auth/register',
        '/api/auth/logout',
      ]),
    )
  })
})

describe('requiresAuth (middleware decision, extracted for testability)', () => {
  it('does not gate non-/api/ paths', () => {
    expect(requiresAuth('/')).toBe(false)
    expect(requiresAuth('/dashboard')).toBe(false)
    expect(requiresAuth('/_nuxt/entry.js')).toBe(false)
  })

  it('does not gate any of the seven public /api paths', () => {
    for (const p of PUBLIC_API_PATHS) {
      expect(requiresAuth(p)).toBe(false)
    }
  })

  it('gates a protected /api path', () => {
    expect(requiresAuth('/api/settings')).toBe(true)
  })

  // Icons are fetched from the server at runtime, so gating them means no icon
  // renders anywhere reachable without a session (e.g. login's :loading spinner).
  it('does not gate the icon collection endpoint', () => {
    expect(requiresAuth('/api/_nuxt_icon/lucide.json')).toBe(false)
    expect(requiresAuth('/api/_nuxt_icon/lucide')).toBe(false)
  })

  it('still gates anything under the icon prefix that is not a plain collection name', () => {
    expect(requiresAuth('/api/_nuxt_icon/%2e%2e/settings')).toBe(true)
    expect(requiresAuth('/api/_nuxt_icon/../settings')).toBe(true)
    expect(requiresAuth('/api/_nuxt_icon/lucide/../../settings')).toBe(true)
    expect(requiresAuth('/api/_nuxt_icon/')).toBe(true)
  })
})

// Drives setSessionCookie through a real H3Event (Node req/res pair from a
// live loopback server), not a type-cast fake, so the actual Set-Cookie
// header emitted by h3 can be inspected.
function captureSetCookie(userId: number): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const event = createEvent(req, res)
      setSessionCookie(event, userId)
      res.end()
    })
    server.listen(0, () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      http
        .get({ host: '127.0.0.1', port, path: '/' }, (res) => {
          const setCookie = res.headers['set-cookie'] ?? []
          res.resume()
          res.on('end', () => server.close(() => resolve(setCookie)))
        })
        .on('error', reject)
    })
  })
}

describe('setSessionCookie', () => {
  it('sets an HttpOnly, SameSite=Lax, Path=/ cookie with a 30-day Max-Age', async () => {
    const cookies = await captureSetCookie(1)
    const cookie = cookies.find((c) => c.startsWith(`${SESSION_COOKIE}=`))

    expect(cookie).toBeDefined()
    expect(cookie).toMatch(/HttpOnly/)
    expect(cookie).toMatch(/SameSite=Lax/)
    expect(cookie).toMatch(/Path=\//)
    expect(cookie).toMatch(/Max-Age=2592000/)
  })
})
