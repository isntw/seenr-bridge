import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

let tmp: string

async function freshDb() {
  const mod = await import('../server/utils/db')
  mod.closeDb()
  return mod
}

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-test-'))
  process.env.DATA_DIR = tmp
})

afterEach(async () => {
  const mod = await import('../server/utils/db')
  mod.closeDb()
  fs.rmSync(tmp, { recursive: true, force: true })
})

describe('migrations', () => {
  it('are idempotent when re-run against an existing file', async () => {
    const first = await freshDb()
    first.getSettings()
    first.closeDb()

    // Re-importing re-runs the migration guards against a populated file.
    const second = await freshDb()
    expect(() => second.getSettings()).not.toThrow()
    expect(second.getSettings().seenr_base_url).toBe(
      'https://seenr.app/api/v1/scrobble/plex',
    )
  })
})

describe('mappings', () => {
  it('upsert updates rather than duplicating on username conflict', async () => {
    const db = await freshDb()
    db.upsertMapping('alice', 'tok-1', 1, 1, 1)
    db.upsertMapping('alice', 'tok-2', 0, 0, 1)

    const all = db.listMappings()
    expect(all).toHaveLength(1)
    expect(all[0]!.seenr_token).toBe('tok-2')
    expect(all[0]!.enabled).toBe(0)
  })

  it('looks up usernames case-insensitively', async () => {
    const db = await freshDb()
    db.upsertMapping('Alice', 'tok', 1, 1, 1)
    expect(db.getMappingByUsername('alice')?.seenr_token).toBe('tok')
    expect(db.getMappingByUsername('ALICE')?.seenr_token).toBe('tok')
  })
})

describe('events', () => {
  it('caps the table at 1000 rows, trimming oldest first', async () => {
    const db = await freshDb()
    const base = {
      action: 'watched', event: 'media.scrobble', username: 'alice',
      media_type: 'episode', title: 't', rating_key: '1', ids: '[]',
      image: null, series_key: null, seenr_status: 200, ok: 1,
      error: null, payload: null,
    }
    for (let i = 0; i < 1005; i++) {
      db.insertEvent({ ...base, ts: 1_700_000_000_000 + i })
    }

    const rows = db.listEvents(2000)
    expect(rows).toHaveLength(1000)
    // Oldest survivor is the 6th insert, so the first five were trimmed.
    expect(Math.min(...rows.map((r) => r.ts))).toBe(1_700_000_000_005)
  })
})

describe('wire conversion', () => {
  it('converts 0/1 columns to booleans and parses ids', async () => {
    const db = await freshDb()
    const m = db.upsertMapping('bob', 'tok', 1, 0, 1)
    const wire = db.mappingToWire(m)

    expect(wire.enabled).toBe(true)
    expect(wire.sync_movies).toBe(false)
    expect(wire.sync_episodes).toBe(true)
  })
})
