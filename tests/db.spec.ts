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
      image: null, series_key: null, seenr_status: 200, plex_status: null, ok: 1,
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
      image: null, series_key: null, seenr_status: 200, plex_status: null, ok: 1,
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
      image: null, series_key: null, seenr_status: 500, plex_status: null, ok: 0,
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

// The library a shared title came from decides whether the pipeline forwards it, so
// losing it silently would be worse than never storing it.
describe('shared title libraries', () => {
  async function withMapping() {
    const db = await freshDb()
    const m = db.upsertMapping('alice', 'tok', 1)
    return { db, id: m.id }
  }

  it('stores the library it was added from', async () => {
    const { db, id } = await withMapping()
    db.setSharedTitle(
      { rating_key: '12266', media_type: 'movie', title: 'Way of Water', section_id: '1', library_name: 'Movies' },
      [id],
    )

    const [t] = db.listSharedTitles()
    expect(t).toMatchObject({ section_id: '1', library_name: 'Movies' })
  })

  it('keeps the stored library when an edit-mode save omits it', async () => {
    const { db, id } = await withMapping()
    db.setSharedTitle(
      { rating_key: '12266', media_type: 'movie', title: 'Way of Water', section_id: '1', library_name: 'Movies' },
      [id],
    )
    // What the edit modal sends: same title, changed profiles, no library.
    db.setSharedTitle({ rating_key: '12266', media_type: 'movie', title: 'Way of Water' }, [id])

    const [t] = db.listSharedTitles()
    expect(t!.library_name).toBe('Movies')
    expect(t!.section_id).toBe('1')
  })

  it('is null for a title shared without one', async () => {
    const { db, id } = await withMapping()
    db.setSharedTitle({ rating_key: '999', media_type: 'show', title: 'Legacy' }, [id])

    const [t] = db.listSharedTitles()
    expect(t!.library_name).toBeNull()
    expect(t!.section_id).toBeNull()
  })

  it('backfills only while the library is still unknown', async () => {
    const { db, id } = await withMapping()
    db.setSharedTitle({ rating_key: '999', media_type: 'show', title: 'Legacy' }, [id])

    db.setSharedTitleLibrary('999', '6', 'Seriale')
    expect(db.listSharedTitles()[0]).toMatchObject({ section_id: '6', library_name: 'Seriale' })

    // A second lookup must not overwrite a known value — that would let a stale
    // reply clobber what the add flow recorded.
    db.setSharedTitleLibrary('999', '2', 'TV Shows')
    expect(db.listSharedTitles()[0]).toMatchObject({ section_id: '6', library_name: 'Seriale' })
  })
})

describe('plex columns', () => {
  it('defaults plex_token to empty and generates a stable client id on demand', async () => {
    const db = await freshDb()
    expect(db.getSettings().plex_token).toBe('')

    const id = db.getPlexClientId()
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
    // Creating a PIN and polling it must present the SAME identifier, so this
    // must not regenerate on each call.
    expect(db.getPlexClientId()).toBe(id)
  })

  it('round-trips plex_token through settings and the wire boundary', async () => {
    const db = await freshDb()
    db.saveSettings({ plex_token: 'owner-tok' })
    expect(db.getSettings().plex_token).toBe('owner-tok')
    expect(db.settingsToWire(db.getSettings()).plex_token).toBe('owner-tok')
  })

  it('does not leak plex_client_id onto the wire', async () => {
    const db = await freshDb()
    db.getPlexClientId()
    expect(Object.keys(db.settingsToWire(db.getSettings()))).not.toContain('plex_client_id')
  })

  it('defaults a share to plex_sync OFF so an upgrade writes to nobody', async () => {
    const db = await freshDb()
    const m = db.upsertMapping('alice', 'tok', 1, 1, 1)
    db.setSharedTitle({ rating_key: '999', media_type: 'show' }, [m.id])

    expect(db.getSharedTitle('999')!.plex_sync).toBe(0)
    expect(db.listSharedTitles()[0]!.plex_sync).toBe(false)
  })

  it('stores plex_sync and converts it to a boolean on the wire', async () => {
    const db = await freshDb()
    const m = db.upsertMapping('alice', 'tok', 1, 1, 1)
    db.setSharedTitle({ rating_key: '999', media_type: 'show', plex_sync: 1 }, [m.id])

    expect(db.getSharedTitle('999')!.plex_sync).toBe(1)
    expect(db.listSharedTitles()[0]!.plex_sync).toBe(true)
  })

  it('turns plex_sync back off on a later save (plain assignment, not COALESCE)', async () => {
    const db = await freshDb()
    const m = db.upsertMapping('alice', 'tok', 1, 1, 1)
    db.setSharedTitle({ rating_key: '999', media_type: 'show', plex_sync: 1 }, [m.id])
    db.setSharedTitle({ rating_key: '999', media_type: 'show', plex_sync: 0 }, [m.id])

    expect(db.getSharedTitle('999')!.plex_sync).toBe(0)
  })

  it('returns undefined for a share that does not exist', async () => {
    const db = await freshDb()
    expect(db.getSharedTitle('nope')).toBeUndefined()
  })

  it('stores a per-mapping plex token override', async () => {
    const db = await freshDb()
    const m = db.upsertMapping('alice', 'tok', 1, 1, 1, 'plex-override')
    expect(m.plex_token).toBe('plex-override')
    expect(db.mappingToWire(m).plex_token).toBe('plex-override')
  })

  it('defaults a mapping plex token to empty', async () => {
    const db = await freshDb()
    expect(db.upsertMapping('bob', 'tok', 1, 1, 1).plex_token).toBe('')
  })

  it('records plex_status on an event and passes it through eventToWire', async () => {
    const db = await freshDb()
    db.insertEvent({
      ts: 1, action: 'watched', event: 'media.scrobble', username: 'alice',
      media_type: 'episode', title: 'Ozymandias', rating_key: '12345', ids: '[]',
      image: null, series_key: '999', seenr_status: 200, plex_status: 200,
      ok: 1, error: null, payload: null,
    })

    const row = db.listEvents(1)[0]!
    expect(row.plex_status).toBe(200)
    expect(db.eventToWire(row).plex_status).toBe(200)
  })
})
