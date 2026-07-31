import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

let tmp: string

async function load() {
  const db = await import('../server/utils/db')
  db.closeDb()
  return { db, poster: await import('../server/utils/poster') }
}

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-poster-'))
  process.env.DATA_DIR = tmp
})

afterEach(async () => {
  const db = await import('../server/utils/db')
  db.closeDb()
  fs.rmSync(tmp, { recursive: true, force: true })
})

const ART = '/library/metadata/999/thumb/1'

function parse(url: string) {
  const q = new URLSearchParams(url.slice(url.indexOf('?') + 1))
  return { path: q.get('path')!, exp: q.get('exp')!, sig: q.get('sig')! }
}

describe('posterUrl', () => {
  it('signs a path it can verify back', async () => {
    const { poster } = await load()
    const { path: p, exp, sig } = parse(poster.posterUrl(ART, 1_000_000))

    expect(p).toBe(ART)
    expect(poster.posterSignatureValid(p, exp, sig, 1_000_000)).toBe(true)
  })

  it('is empty for an item with no art, so no icon is sent', async () => {
    const { poster } = await load()
    expect(poster.posterUrl(undefined)).toBe('')
    expect(poster.posterUrl('')).toBe('')
  })

  it('rejects a tampered path — the whole point of signing', async () => {
    const { poster } = await load()
    const { exp, sig } = parse(poster.posterUrl(ART, 1_000_000))

    expect(
      poster.posterSignatureValid('/library/metadata/1/thumb/1', exp, sig, 1_000_000),
    ).toBe(false)
  })

  it('rejects a tampered expiry', async () => {
    const { poster } = await load()
    const { path: p, exp, sig } = parse(poster.posterUrl(ART, 1_000_000))

    expect(poster.posterSignatureValid(p, Number(exp) + 1000, sig, 1_000_000)).toBe(false)
  })

  it('rejects a forged signature of any length', async () => {
    const { poster } = await load()
    const { path: p, exp } = parse(poster.posterUrl(ART, 1_000_000))

    expect(poster.posterSignatureValid(p, exp, 'nope', 1_000_000)).toBe(false)
    expect(poster.posterSignatureValid(p, exp, 'a'.repeat(64), 1_000_000)).toBe(false)
    expect(poster.posterSignatureValid(p, exp, '', 1_000_000)).toBe(false)
  })

  it('expires', async () => {
    const { poster } = await load()
    const { path: p, exp, sig } = parse(poster.posterUrl(ART, 1_000_000))
    const week = 7 * 24 * 60 * 60 * 1000

    expect(poster.posterSignatureValid(p, exp, sig, 1_000_000 + week - 1)).toBe(true)
    expect(poster.posterSignatureValid(p, exp, sig, 1_000_000 + week + 1)).toBe(false)
  })

  it('reuses one generated secret, so a URL survives a restart', async () => {
    const { db, poster } = await load()
    const first = parse(poster.posterUrl(ART, 1_000_000))
    const secret = db.getPosterSecret()

    db.closeDb()
    const again = await load()

    expect(again.db.getPosterSecret()).toBe(secret)
    expect(again.poster.posterSignatureValid(first.path, first.exp, first.sig, 1_000_000)).toBe(
      true,
    )
  })
})
