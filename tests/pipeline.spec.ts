import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { TautulliMetadata } from '../shared/types'

const meta: TautulliMetadata = {
  media_type: 'episode',
  rating_key: '12345',
  title: 'Ozymandias',
  grandparent_title: 'Breaking Bad',
  parent_media_index: '5',
  media_index: '14',
  year: 2013,
  duration: 2880000,
  guid: 'plex://episode/abc',
  grandparent_guid: 'plex://show/def',
  grandparent_rating_key: '999',
  guids: ['tmdb://62161'],
  thumb: '/library/metadata/12345/thumb/1',
  grandparent_thumb: '/library/metadata/999/thumb/1',
}

const getMetadata = vi.fn(async () => meta)
const getWatchedEpisodeKeys = vi.fn(async () => [] as string[])
const forwardToSeenr = vi.fn(async () => ({ status: 200, body: 'ok' }))

vi.mock('../server/utils/tautulli', () => ({
  getMetadata: (...a: unknown[]) => getMetadata(...(a as [])),
  getWatchedEpisodeKeys: (...a: unknown[]) => getWatchedEpisodeKeys(...(a as [])),
}))
vi.mock('../server/utils/seenr', () => ({
  forwardToSeenr: (...a: unknown[]) => forwardToSeenr(...(a as [])),
}))

let tmp: string

async function load() {
  const db = await import('../server/utils/db')
  db.closeDb()
  const pipeline = await import('../server/utils/pipeline')
  return { db, pipeline }
}

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-pipe-'))
  process.env.DATA_DIR = tmp
  getMetadata.mockClear()
  getMetadata.mockImplementation(async () => meta)
  getWatchedEpisodeKeys.mockClear()
  getWatchedEpisodeKeys.mockImplementation(async () => [])
  forwardToSeenr.mockClear()
  forwardToSeenr.mockImplementation(async () => ({ status: 200, body: 'ok' }))
})

afterEach(async () => {
  const db = await import('../server/utils/db')
  db.closeDb()
  fs.rmSync(tmp, { recursive: true, force: true })
})

const input = { action: 'watched', rating_key: '12345', username: 'alice' }

async function configured() {
  const { db, pipeline } = await load()
  db.saveSettings({ tautulli_url: 'http://taut:8181', tautulli_apikey: 'key' })
  return { db, pipeline }
}

describe('processEvent guards', () => {
  it('fails when Tautulli is not configured', async () => {
    const { pipeline } = await load()
    const r = await pipeline.processEvent(input)
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('Tautulli connection not configured')
    expect(forwardToSeenr).not.toHaveBeenCalled()
  })

  it('skips when the username has no mapping', async () => {
    const { pipeline } = await configured()
    const r = await pipeline.processEvent(input)
    expect(r.skipped).toBe(true)
    expect(r.reason).toContain('No seenr mapping')
    expect(forwardToSeenr).not.toHaveBeenCalled()
  })

  it('skips when the mapping is disabled', async () => {
    const { db, pipeline } = await configured()
    db.upsertMapping('alice', 'tok', 0, 1, 1)
    const r = await pipeline.processEvent(input)
    expect(r.skipped).toBe(true)
    expect(r.reason).toContain('is disabled')
    expect(forwardToSeenr).not.toHaveBeenCalled()
  })

  it('skips an episode when that user has episode sync off', async () => {
    const { db, pipeline } = await configured()
    db.upsertMapping('alice', 'tok', 1, 1, 0)
    const r = await pipeline.processEvent(input)
    expect(r.skipped).toBe(true)
    expect(r.reason).toContain('Episode sync is off')
    expect(forwardToSeenr).not.toHaveBeenCalled()
  })

  it('skips a movie when that user has movie sync off', async () => {
    const { db, pipeline } = await configured()
    db.upsertMapping('alice', 'tok', 1, 0, 1)
    getMetadata.mockResolvedValueOnce({ ...meta, media_type: 'movie' })
    const r = await pipeline.processEvent(input)
    expect(r.skipped).toBe(true)
    expect(r.reason).toContain('Movie sync is off')
    expect(forwardToSeenr).not.toHaveBeenCalled()
  })

  it('records a failure when forwarding is globally disabled', async () => {
    const { db, pipeline } = await configured()
    db.saveSettings({ forward_enabled: 0 })
    db.upsertMapping('alice', 'tok', 1, 1, 1)
    const r = await pipeline.processEvent(input)

    expect(r.ok).toBe(false)
    expect(r.reason).toBe('Forwarding is disabled in settings')
    expect(forwardToSeenr).not.toHaveBeenCalled()
    expect(db.listEvents(10)).toHaveLength(1)
  })
})

describe('processEvent success path', () => {
  it('forwards and records a successful scrobble', async () => {
    const { db, pipeline } = await configured()
    db.upsertMapping('alice', 'tok', 1, 1, 1)
    const r = await pipeline.processEvent(input)

    expect(r.ok).toBe(true)
    expect(r.seenr_status).toBe(200)
    expect(forwardToSeenr).toHaveBeenCalledOnce()

    const rows = db.listEvents(10)
    expect(rows).toHaveLength(1)
    expect(rows[0]!.ok).toBe(1)
    expect(rows[0]!.series_key).toBe('999')
    expect(rows[0]!.image).toBe('/library/metadata/999/thumb/1')
  })

  it('records a failure for a non-2xx seenr response', async () => {
    const { db, pipeline } = await configured()
    db.upsertMapping('alice', 'tok', 1, 1, 1)
    forwardToSeenr.mockResolvedValueOnce({ status: 401, body: 'bad token' })
    const r = await pipeline.processEvent(input)

    expect(r.ok).toBe(false)
    expect(r.seenr_status).toBe(401)
    expect(db.listEvents(10)[0]!.error).toContain('401')
  })
})

describe('processEvent dryRun', () => {
  it('builds a payload without forwarding or recording', async () => {
    const { db, pipeline } = await configured()
    db.upsertMapping('alice', 'tok', 1, 1, 1)
    const r = await pipeline.processEvent(input, { dryRun: true, record: false })

    expect(r.ok).toBe(true)
    expect(r.payload).toBeDefined()
    expect(r.ids).toEqual(['tmdb://62161'])
    expect(forwardToSeenr).not.toHaveBeenCalled()
    expect(db.listEvents(10)).toHaveLength(0)
  })
})

// Shares are keyed on the show's rating_key (the episode's grandparent_rating_key,
// '999' for the test fixture `meta`), not the episode's own key.
describe('processEvent fan-out (shared titles)', () => {
  it('fans out to every assigned profile when the trigger is one of them', async () => {
    const { db, pipeline } = await configured()
    const alice = db.upsertMapping('alice', 'tok-alice', 1, 1, 1)
    const bob = db.upsertMapping('bob', 'tok-bob', 1, 1, 1)
    db.setSharedTitle({ rating_key: '999', media_type: 'show' }, [alice.id, bob.id])

    const r = await pipeline.processEvent(input) // input.username === 'alice'

    expect(r.ok).toBe(true)
    expect(r.fanout).toBe(2)
    expect(forwardToSeenr).toHaveBeenCalledTimes(2)

    const rows = db.listEvents(10)
    expect(rows).toHaveLength(2)
    expect(rows.map((row) => row.username).sort()).toEqual(['alice', 'bob'])
  })

  it('does not fan out when the trigger is not one of the shared profiles', async () => {
    const { db, pipeline } = await configured()
    const alice = db.upsertMapping('alice', 'tok-alice', 1, 1, 1)
    const bob = db.upsertMapping('bob', 'tok-bob', 1, 1, 1)
    db.upsertMapping('charlie', 'tok-charlie', 1, 1, 1)
    // Shared profiles are alice + bob; charlie triggers the same show but isn't one of them.
    db.setSharedTitle({ rating_key: '999', media_type: 'show' }, [alice.id, bob.id])

    const r = await pipeline.processEvent({ ...input, username: 'charlie' })

    expect(r.ok).toBe(true)
    expect(r.fanout).toBe(1)
    expect(forwardToSeenr).toHaveBeenCalledTimes(1)

    const rows = db.listEvents(10)
    expect(rows).toHaveLength(1)
    expect(rows[0]!.username).toBe('charlie')
  })

  it('skips a disabled profile during fan-out', async () => {
    const { db, pipeline } = await configured()
    const alice = db.upsertMapping('alice', 'tok-alice', 1, 1, 1)
    const bob = db.upsertMapping('bob', 'tok-bob', 0, 1, 1) // disabled
    db.setSharedTitle({ rating_key: '999', media_type: 'show' }, [alice.id, bob.id])

    const r = await pipeline.processEvent(input)

    expect(r.ok).toBe(true)
    expect(r.fanout).toBe(1)
    expect(forwardToSeenr).toHaveBeenCalledTimes(1)

    const rows = db.listEvents(10)
    expect(rows).toHaveLength(1)
    expect(rows[0]!.username).toBe('alice')
  })

  it('delivers to a co-watcher even when the trigger has per-type sync off, and reports ok/fanout accordingly', async () => {
    const { db, pipeline } = await configured()
    const alice = db.upsertMapping('alice', 'tok-alice', 1, 1, 0) // episode sync off
    const bob = db.upsertMapping('bob', 'tok-bob', 1, 1, 1)
    db.setSharedTitle({ rating_key: '999', media_type: 'show' }, [alice.id, bob.id])

    const r = await pipeline.processEvent(input) // input.username === 'alice', an episode

    expect(r.ok).toBe(true)
    expect(r.skipped).toBeFalsy()
    expect(r.fanout).toBe(1)
    expect(r.reason).toContain('Episode sync is off')
    expect(forwardToSeenr).toHaveBeenCalledTimes(1)

    const rows = db.listEvents(10)
    expect(rows).toHaveLength(1)
    expect(rows[0]!.username).toBe('bob')
  })
})

describe('backfillSharedTitle', () => {
  const movieMeta = { ...meta, media_type: 'movie', rating_key: '500', grandparent_rating_key: '' }

  it('delivers a movie once per assigned profile', async () => {
    const { db, pipeline } = await configured()
    const alice = db.upsertMapping('alice', 'tok-alice', 1, 1, 1)
    const bob = db.upsertMapping('bob', 'tok-bob', 1, 1, 1)
    db.setSharedTitle({ rating_key: '500', media_type: 'movie' }, [alice.id, bob.id])
    getMetadata.mockImplementation(async () => movieMeta)

    const r = await pipeline.backfillSharedTitle('500')

    expect(r.ok).toBe(true)
    expect(r.items).toBe(1)
    expect(r.profiles).toBe(2)
    expect(r.delivered).toBe(2)
    expect(r.ok_count).toBe(2)
    expect(r.fail_count).toBe(0)
    expect(forwardToSeenr).toHaveBeenCalledTimes(2)

    const rows = db.listEvents(10)
    expect(rows).toHaveLength(2)
    expect(rows.every((row) => row.rating_key === '500')).toBe(true)
    expect(rows.map((row) => row.username).sort()).toEqual(['alice', 'bob'])
  })

  it('delivers once per watched episode per assigned profile for a show', async () => {
    const { db, pipeline } = await configured()
    const alice = db.upsertMapping('alice', 'tok-alice', 1, 1, 1)
    const bob = db.upsertMapping('bob', 'tok-bob', 1, 1, 1)
    db.setSharedTitle({ rating_key: '999', media_type: 'show' }, [alice.id, bob.id])
    getWatchedEpisodeKeys.mockImplementation(async () => ['101', '102'])

    const r = await pipeline.backfillSharedTitle('999')

    expect(r.ok).toBe(true)
    expect(r.items).toBe(2) // watched episodes, not the whole series
    expect(r.profiles).toBe(2)
    expect(r.delivered).toBe(4)
    expect(r.ok_count).toBe(4)
    expect(r.fail_count).toBe(0)
    expect(forwardToSeenr).toHaveBeenCalledTimes(4)

    const rows = db.listEvents(10)
    expect(rows).toHaveLength(4)
    expect(rows.map((row) => row.rating_key).sort()).toEqual(['101', '101', '102', '102'])
  })

  it('refuses cleanly when the title is not shared', async () => {
    const { pipeline } = await configured()
    const r = await pipeline.backfillSharedTitle('no-such-key')

    expect(r.ok).toBe(false)
    expect(r.reason).toBe('Title is not shared')
    expect(forwardToSeenr).not.toHaveBeenCalled()
  })

  it('refuses cleanly when the shared title has no profiles assigned', async () => {
    const { db, pipeline } = await configured()
    // setSharedTitle with an empty profile list deletes the share row entirely,
    // so this defensive state (a shared_titles row with no linked profiles) is
    // reached directly through the raw handle rather than the public helper.
    db.useDb()
      .prepare(
        'INSERT INTO shared_titles (rating_key, media_type, title, year, image, created) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run('777', 'movie', null, null, null, Date.now())

    const r = await pipeline.backfillSharedTitle('777')

    expect(r.ok).toBe(false)
    expect(r.reason).toBe('No profiles assigned to this title')
    expect(forwardToSeenr).not.toHaveBeenCalled()
  })

  it('refuses cleanly when forwarding is disabled in settings', async () => {
    const { db, pipeline } = await configured()
    const alice = db.upsertMapping('alice', 'tok-alice', 1, 1, 1)
    db.setSharedTitle({ rating_key: '500', media_type: 'movie' }, [alice.id])
    db.saveSettings({ forward_enabled: 0 })

    const r = await pipeline.backfillSharedTitle('500')

    expect(r.ok).toBe(false)
    expect(r.reason).toBe('Forwarding is disabled in settings')
    expect(forwardToSeenr).not.toHaveBeenCalled()
  })
})
