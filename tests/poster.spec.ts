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
  return {
    path: q.get('path')!,
    w: q.get('w')!,
    h: q.get('h')!,
    exp: q.get('exp')!,
    sig: q.get('sig')!,
  }
}

describe('posterUrl', () => {
  it('signs a path and box it can verify back', async () => {
    const { poster } = await load()
    const { path: p, w, h, exp, sig } = parse(poster.posterUrl(ART, poster.WIDE_BOX, 1_000_000))

    expect(p).toBe(ART)
    expect(poster.verifiedPosterBox(p, w, h, exp, sig, 1_000_000)).toEqual({ w: 1280, h: 720 })
  })

  // The only box there is, because the only slot art goes in is the wide row.
  it('asks for 16:9', async () => {
    const { poster } = await load()

    expect(poster.WIDE_BOX.w / poster.WIDE_BOX.h).toBeCloseTo(16 / 9, 3)
  })

  it('is empty for an item with no art, so no image is sent', async () => {
    const { poster } = await load()
    expect(poster.posterUrl(undefined)).toBe('')
    expect(poster.posterUrl('')).toBe('')
  })

  it('rejects a tampered path — the whole point of signing', async () => {
    const { poster } = await load()
    const { w, h, exp, sig } = parse(poster.posterUrl(ART, poster.WIDE_BOX, 1_000_000))

    expect(
      poster.verifiedPosterBox('/library/metadata/1/thumb/1', w, h, exp, sig, 1_000_000),
    ).toBeNull()
  })

  // Without the box inside the signature, anyone holding a URL could restretch the
  // image by editing w and h.
  it('rejects a tampered box', async () => {
    const { poster } = await load()
    const { path: p, w, h, exp, sig } = parse(poster.posterUrl(ART, poster.WIDE_BOX, 1_000_000))

    expect(poster.verifiedPosterBox(p, 4096, h, exp, sig, 1_000_000)).toBeNull()
    expect(poster.verifiedPosterBox(p, w, 4096, exp, sig, 1_000_000)).toBeNull()
    expect(poster.verifiedPosterBox(p, 'x', h, exp, sig, 1_000_000)).toBeNull()
  })

  it('rejects a tampered expiry', async () => {
    const { poster } = await load()
    const { path: p, w, h, exp, sig } = parse(poster.posterUrl(ART, poster.WIDE_BOX, 1_000_000))

    expect(poster.verifiedPosterBox(p, w, h, Number(exp) + 1000, sig, 1_000_000)).toBeNull()
  })

  it('rejects a forged signature of any length', async () => {
    const { poster } = await load()
    const { path: p, w, h, exp } = parse(poster.posterUrl(ART, poster.WIDE_BOX, 1_000_000))

    expect(poster.verifiedPosterBox(p, w, h, exp, 'nope', 1_000_000)).toBeNull()
    expect(poster.verifiedPosterBox(p, w, h, exp, 'a'.repeat(64), 1_000_000)).toBeNull()
    expect(poster.verifiedPosterBox(p, w, h, exp, '', 1_000_000)).toBeNull()
  })

  it('expires', async () => {
    const { poster } = await load()
    const { path: p, w, h, exp, sig } = parse(poster.posterUrl(ART, poster.WIDE_BOX, 1_000_000))
    const week = 7 * 24 * 60 * 60 * 1000

    expect(poster.verifiedPosterBox(p, w, h, exp, sig, 1_000_000 + week - 1)).not.toBeNull()
    expect(poster.verifiedPosterBox(p, w, h, exp, sig, 1_000_000 + week + 1)).toBeNull()
  })

  it('reuses one generated secret, so a URL survives a restart', async () => {
    const { db, poster } = await load()
    const first = parse(poster.posterUrl(ART, poster.WIDE_BOX, 1_000_000))
    const secret = db.getPosterSecret()

    db.closeDb()
    const again = await load()

    expect(again.db.getPosterSecret()).toBe(secret)
    expect(
      again.poster.verifiedPosterBox(first.path, first.w, first.h, first.exp, first.sig, 1_000_000),
    ).not.toBeNull()
  })
})
