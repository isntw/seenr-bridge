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

describe('session expiry', () => {
  it('resolves a freshly created session', async () => {
    const db = await freshDb()
    const token = db.createSession(1)
    expect(db.getSessionByToken(token)).toEqual({ user_id: 1 })
  })

  it('does not resolve a session whose created timestamp is older than the TTL window', async () => {
    const db = await freshDb()
    const token = 'a'.repeat(64)
    const staleCreated = Date.now() - db.SESSION_TTL_SECONDS * 1000 - 1000
    db.useDb()
      .prepare('INSERT INTO sessions (token, user_id, created) VALUES (?, ?, ?)')
      .run(token, 1, staleCreated)

    expect(db.getSessionByToken(token)).toBeUndefined()
  })

  it('cleans up expired rows opportunistically when a new session is created', async () => {
    const db = await freshDb()
    const staleToken = 'b'.repeat(64)
    const staleCreated = Date.now() - db.SESSION_TTL_SECONDS * 1000 - 1000
    db.useDb()
      .prepare('INSERT INTO sessions (token, user_id, created) VALUES (?, ?, ?)')
      .run(staleToken, 1, staleCreated)

    db.createSession(2)

    const remaining = db
      .useDb()
      .prepare('SELECT token FROM sessions')
      .all() as { token: string }[]
    expect(remaining.some((r) => r.token === staleToken)).toBe(false)
  })
})

describe('wire conversion', () => {
  // All three *ToWire helpers need coverage: this boundary is the only thing
  // stopping a raw 0/1 reaching the client, so an untested helper is an
  // untested guarantee.

  it('mappingToWire converts 0/1 columns to booleans', async () => {
    const db = await freshDb()
    const m = db.upsertMapping('bob', 'tok', 1, 0, 1)
    const wire = db.mappingToWire(m)

    expect(wire.enabled).toBe(true)
    expect(wire.sync_movies).toBe(false)
    expect(wire.sync_episodes).toBe(true)
  })

  it('settingsToWire converts 0/1 columns to booleans', async () => {
    const db = await freshDb()
    db.saveSettings({ forward_enabled: 0, sync_movies: 1, sync_episodes: 0 })
    const wire = db.settingsToWire(db.getSettings())

    expect(wire.forward_enabled).toBe(false)
    expect(wire.sync_movies).toBe(true)
    expect(wire.sync_episodes).toBe(false)
  })

  it('eventToWire converts ok to boolean and parses the ids JSON', async () => {
    const db = await freshDb()
    const id = db.insertEvent({
      ts: 1_700_000_000_000, action: 'watched', event: 'media.scrobble',
      username: 'alice', media_type: 'episode', title: 't', rating_key: '1',
      ids: JSON.stringify(['tmdb://62161', 'imdb://tt2301455']),
      image: null, series_key: null, seenr_status: 200, ok: 1,
      error: null, payload: null,
    })
    const row = db.listEvents(10).find((r) => r.id === id)!
    const wire = db.eventToWire(row)

    expect(wire.ok).toBe(true)
    expect(wire.ids).toEqual(['tmdb://62161', 'imdb://tt2301455'])
  })

  it('eventToWire falls back to an empty ids array on malformed JSON', async () => {
    const db = await freshDb()
    const id = db.insertEvent({
      ts: 1_700_000_000_000, action: 'watched', event: 'media.scrobble',
      username: 'alice', media_type: 'movie', title: 't', rating_key: '1',
      ids: '{not valid json',
      image: null, series_key: null, seenr_status: 500, ok: 0,
      error: 'boom', payload: null,
    })
    const row = db.listEvents(10).find((r) => r.id === id)!
    const wire = db.eventToWire(row)

    // A corrupt ids column must not crash the events endpoint.
    expect(wire.ids).toEqual([])
    expect(wire.ok).toBe(false)
  })
})

describe('parseLibraries', () => {
  // '' is the column default on every upgraded install, so this is the case that
  // decides whether an upgrade keeps forwarding. Empty must mean ALL, never none.
  it('treats empty, null and undefined as "all libraries"', async () => {
    const db = await freshDb()
    expect(db.parseLibraries('')).toEqual([])
    expect(db.parseLibraries(null)).toEqual([])
    expect(db.parseLibraries(undefined)).toEqual([])
  })

  it('parses a JSON array of ids', async () => {
    const db = await freshDb()
    expect(db.parseLibraries('["1","5"]')).toEqual(['1', '5'])
  })

  it('coerces numeric ids to strings, since Tautulli mixes both forms', async () => {
    const db = await freshDb()
    expect(db.parseLibraries('[1,5]')).toEqual(['1', '5'])
  })

  it('degrades malformed JSON to "all" rather than throwing', async () => {
    const db = await freshDb()
    expect(db.parseLibraries('{oops')).toEqual([])
  })

  it('degrades a non-array payload to "all"', async () => {
    const db = await freshDb()
    expect(db.parseLibraries('{"a":1}')).toEqual([])
    expect(db.parseLibraries('"5"')).toEqual([])
  })
})

describe('settings libraries round-trip', () => {
  it('stores JSON and hands back a real array at the wire boundary', async () => {
    const db = await freshDb()
    db.saveSettings({ libraries: JSON.stringify(['1', '6']) })

    // storage form
    expect(db.getSettings().libraries).toBe('["1","6"]')
    // wire form
    expect(db.settingsToWire(db.getSettings()).libraries).toEqual(['1', '6'])
  })

  it('defaults to an empty selection on a fresh database', async () => {
    const db = await freshDb()
    expect(db.settingsToWire(db.getSettings()).libraries).toEqual([])
  })

  it('leaves the selection alone when a patch omits it', async () => {
    const db = await freshDb()
    db.saveSettings({ libraries: JSON.stringify(['3']) })
    db.saveSettings({ tautulli_url: 'http://elsewhere:8181' })
    expect(db.settingsToWire(db.getSettings()).libraries).toEqual(['3'])
  })
})
