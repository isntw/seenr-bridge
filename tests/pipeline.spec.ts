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

const getPlexServer = vi.fn(async (..._a: unknown[]) => ({
  url: 'http://plex:32400',
  machineId: 'mach',
}))
const resolvePlexToken = vi.fn(async (...a: unknown[]): Promise<string | null> => `tok-${String(a[0])}`)
const markWatched = vi.fn(async (..._a: unknown[]) => 200)

vi.mock('../server/utils/plex', () => ({
  getPlexServer: (...a: unknown[]) => getPlexServer(...(a as [])),
  resolvePlexToken: (...a: unknown[]) => resolvePlexToken(...(a as [])),
  markWatched: (...a: unknown[]) => markWatched(...(a as [])),
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
  getPlexServer.mockClear()
  getPlexServer.mockImplementation(async () => ({ url: 'http://plex:32400', machineId: 'mach' }))
  resolvePlexToken.mockClear()
  resolvePlexToken.mockImplementation(async (...a: unknown[]) => `tok-${String(a[0])}`)
  markWatched.mockClear()
  markWatched.mockImplementation(async () => 200)
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

describe('processEvent library gate', () => {
  // The fixture metadata carries no section_id by default, so each test sets the
  // one it needs. Empty selection must behave as "all libraries" — that is what
  // keeps an upgrade from silently stopping every scrobble.
  it('forwards everything when no libraries are selected', async () => {
    const { db, pipeline } = await configured()
    db.upsertMapping('alice', 'tok', 1, 1, 1)
    getMetadata.mockImplementation(async () => ({ ...meta, section_id: '5' }))

    const r = await pipeline.processEvent(input)

    expect(r.ok).toBe(true)
    expect(forwardToSeenr).toHaveBeenCalledOnce()
  })

  it('forwards when the item is in a selected library', async () => {
    const { db, pipeline } = await configured()
    db.upsertMapping('alice', 'tok', 1, 1, 1)
    db.saveSettings({ libraries: JSON.stringify(['5', '2']) })
    getMetadata.mockImplementation(async () => ({ ...meta, section_id: '2' }))

    const r = await pipeline.processEvent(input)

    expect(r.ok).toBe(true)
    expect(forwardToSeenr).toHaveBeenCalledOnce()
  })

  it('does NOT forward when the item is in an unselected library', async () => {
    const { db, pipeline } = await configured()
    db.upsertMapping('alice', 'tok', 1, 1, 1)
    db.saveSettings({ libraries: JSON.stringify(['2']) })
    getMetadata.mockImplementation(async () => ({ ...meta, section_id: '5', library_name: 'Filme' }))

    const r = await pipeline.processEvent(input)

    expect(r.ok).toBe(false)
    expect(forwardToSeenr).not.toHaveBeenCalled()
  })

  it('RECORDS the skip, so a mis-ticked library is visible on the Dashboard', async () => {
    const { db, pipeline } = await configured()
    db.upsertMapping('alice', 'tok', 1, 1, 1)
    db.saveSettings({ libraries: JSON.stringify(['2']) })
    getMetadata.mockImplementation(async () => ({ ...meta, section_id: '5', library_name: 'Filme' }))

    await pipeline.processEvent(input)

    const rows = db.listEvents(10)
    expect(rows).toHaveLength(1)
    expect(rows[0]!.ok).toBe(0)
    expect(rows[0]!.error).toContain('Filme')
    expect(rows[0]!.error).toContain('not selected')
  })

  it('names the section when Tautulli gives no library_name', async () => {
    const { db, pipeline } = await configured()
    db.upsertMapping('alice', 'tok', 1, 1, 1)
    db.saveSettings({ libraries: JSON.stringify(['2']) })
    getMetadata.mockImplementation(async () => ({ ...meta, section_id: '9' }))

    const r = await pipeline.processEvent(input)

    expect(r.reason).toContain('section 9')
  })

  it('treats a numeric section_id as matching its string form', async () => {
    const { db, pipeline } = await configured()
    db.upsertMapping('alice', 'tok', 1, 1, 1)
    db.saveSettings({ libraries: JSON.stringify(['5']) })
    // Tautulli returns section_id as a number in some responses.
    getMetadata.mockImplementation(async () => ({ ...meta, section_id: 5 }))

    const r = await pipeline.processEvent(input)

    expect(r.ok).toBe(true)
  })

  it('lets dryRun short-circuit ahead of the gate, so Preview still works', async () => {
    const { db, pipeline } = await configured()
    db.upsertMapping('alice', 'tok', 1, 1, 1)
    db.saveSettings({ libraries: JSON.stringify(['2']) })
    getMetadata.mockImplementation(async () => ({ ...meta, section_id: '5' }))

    const r = await pipeline.processEvent(input, { dryRun: true, record: false })

    // Preview is a diagnostic — it must not be blocked by a forwarding rule, and
    // must not record anything either.
    expect(r.ok).toBe(true)
    expect(forwardToSeenr).not.toHaveBeenCalled()
    expect(db.listEvents(10)).toHaveLength(0)
  })
})

// Plex writes are per shared title and opt-in. The trigger user is never written to:
// they pressed play, so Plex already has their copy right.
describe('processEvent Plex marking', () => {
  async function sharedWithPlex(plex_sync: number) {
    const { db, pipeline } = await configured()
    db.saveSettings({ plex_token: 'owner-tok' })
    const alice = db.upsertMapping('alice', 'tok-alice', 1, 1, 1)
    const bob = db.upsertMapping('bob', 'tok-bob', 1, 1, 1)
    db.setSharedTitle({ rating_key: '999', media_type: 'show', plex_sync }, [alice.id, bob.id])
    return { db, pipeline }
  }

  it('marks the co-watcher in Plex but not the trigger', async () => {
    const { pipeline } = await sharedWithPlex(1)

    await pipeline.processEvent(input) // input.username === 'alice'

    expect(markWatched).toHaveBeenCalledOnce()
    expect(markWatched).toHaveBeenCalledWith('http://plex:32400', 'tok-bob', '12345')
  })

  it('marks the EPISODE key, not the show key the share is filed under', async () => {
    const { pipeline } = await sharedWithPlex(1)

    await pipeline.processEvent(input)

    // '999' is the share key; '12345' is the episode actually watched.
    expect(markWatched.mock.calls[0]![2]).toBe('12345')
  })

  it('records the Plex status on the co-watcher row and leaves the trigger row null', async () => {
    const { db, pipeline } = await sharedWithPlex(1)

    await pipeline.processEvent(input)

    const rows = db.listEvents(10)
    expect(rows.find((r) => r.username === 'bob')!.plex_status).toBe(200)
    expect(rows.find((r) => r.username === 'alice')!.plex_status).toBeNull()
  })

  it('does nothing in Plex when the share has plex_sync off', async () => {
    const { pipeline } = await sharedWithPlex(0)

    await pipeline.processEvent(input)

    expect(markWatched).not.toHaveBeenCalled()
    expect(getPlexServer).not.toHaveBeenCalled()
  })

  it('does not touch Plex for an unshared watch', async () => {
    const { db, pipeline } = await configured()
    db.saveSettings({ plex_token: 'owner-tok' })
    db.upsertMapping('alice', 'tok-alice', 1, 1, 1)

    await pipeline.processEvent(input)

    expect(getPlexServer).not.toHaveBeenCalled()
    expect(markWatched).not.toHaveBeenCalled()
  })

  it('records why nothing was marked when no Plex account is connected', async () => {
    const { db, pipeline } = await configured()
    const alice = db.upsertMapping('alice', 'tok-alice', 1, 1, 1)
    const bob = db.upsertMapping('bob', 'tok-bob', 1, 1, 1)
    db.setSharedTitle({ rating_key: '999', media_type: 'show', plex_sync: 1 }, [alice.id, bob.id])

    const r = await pipeline.processEvent(input)

    expect(markWatched).not.toHaveBeenCalled()
    // seenr still succeeded — Plex is the extra, not the job.
    expect(r.ok).toBe(true)
    const bobRow = db.listEvents(10).find((row) => row.username === 'bob')!
    expect(bobRow.ok).toBe(1)
    expect(bobRow.error).toContain('No Plex account connected')
  })

  it('records the reason when a co-watcher has no discoverable token', async () => {
    const { db, pipeline } = await sharedWithPlex(1)
    resolvePlexToken.mockImplementation(async () => null)

    await pipeline.processEvent(input)

    const bobRow = db.listEvents(10).find((r) => r.username === 'bob')!
    expect(bobRow.ok).toBe(1)
    expect(bobRow.error).toContain('No Plex token for bob')
  })

  it('leaves ok=1 when the Plex write fails but seenr succeeded', async () => {
    const { db, pipeline } = await sharedWithPlex(1)
    markWatched.mockImplementation(async () => 401)

    const r = await pipeline.processEvent(input)

    expect(r.ok).toBe(true)
    const bobRow = db.listEvents(10).find((row) => row.username === 'bob')!
    expect(bobRow.ok).toBe(1)
    expect(bobRow.plex_status).toBe(401)
    expect(bobRow.error).toContain('Plex HTTP 401')
  })

  it('survives a thrown Plex error and records it', async () => {
    const { db, pipeline } = await sharedWithPlex(1)
    markWatched.mockImplementation(async () => {
      throw new Error('ECONNREFUSED')
    })

    const r = await pipeline.processEvent(input)

    expect(r.ok).toBe(true)
    expect(db.listEvents(10).find((row) => row.username === 'bob')!.error).toContain('ECONNREFUSED')
  })

  it('records a server-lookup failure without blocking the seenr fan-out', async () => {
    const { db, pipeline } = await sharedWithPlex(1)
    getPlexServer.mockImplementation(async () => {
      throw new Error('Tautulli HTTP 502')
    })

    const r = await pipeline.processEvent(input)

    expect(r.fanout).toBe(2)
    expect(forwardToSeenr).toHaveBeenCalledTimes(2)
    expect(markWatched).not.toHaveBeenCalled()
    expect(db.listEvents(10).find((row) => row.username === 'bob')!.error).toContain('Tautulli HTTP 502')
  })

  it('still marks Plex when the seenr forward fails — separate destinations', async () => {
    const { db, pipeline } = await sharedWithPlex(1)
    forwardToSeenr.mockImplementation(async () => {
      throw new Error('seenr down')
    })

    await pipeline.processEvent(input)

    expect(markWatched).toHaveBeenCalledOnce()
    const bobRow = db.listEvents(10).find((row) => row.username === 'bob')!
    expect(bobRow.ok).toBe(0)
    expect(bobRow.plex_status).toBe(200)
  })

  it('does not mark Plex for a profile whose per-type sync is off', async () => {
    const { db, pipeline } = await configured()
    db.saveSettings({ plex_token: 'owner-tok' })
    const alice = db.upsertMapping('alice', 'tok-alice', 1, 1, 1)
    const bob = db.upsertMapping('bob', 'tok-bob', 1, 1, 0) // episode sync off
    db.setSharedTitle({ rating_key: '999', media_type: 'show', plex_sync: 1 }, [alice.id, bob.id])

    await pipeline.processEvent(input)

    expect(markWatched).not.toHaveBeenCalled()
  })

  it('passes a per-mapping override through to token resolution', async () => {
    const { db, pipeline } = await configured()
    db.saveSettings({ plex_token: 'owner-tok' })
    const alice = db.upsertMapping('alice', 'tok-alice', 1, 1, 1)
    const bob = db.upsertMapping('bob', 'tok-bob', 1, 1, 1, 'bob-manual')
    db.setSharedTitle({ rating_key: '999', media_type: 'show', plex_sync: 1 }, [alice.id, bob.id])

    await pipeline.processEvent(input)

    expect(resolvePlexToken).toHaveBeenCalledWith('bob', 'bob-manual', 'mach', 'owner-tok')
  })
})

describe('backfillSharedTitle Plex marking', () => {
  it('marks every assigned profile — a backfill has no trigger user', async () => {
    const { db, pipeline } = await configured()
    db.saveSettings({ plex_token: 'owner-tok' })
    const alice = db.upsertMapping('alice', 'tok-alice', 1, 1, 1)
    const bob = db.upsertMapping('bob', 'tok-bob', 1, 1, 1)
    db.setSharedTitle({ rating_key: '999', media_type: 'show', plex_sync: 1 }, [alice.id, bob.id])
    getWatchedEpisodeKeys.mockImplementation(async () => ['101', '102'])

    await pipeline.backfillSharedTitle('999')

    // 2 episodes x 2 profiles, nobody excluded.
    expect(markWatched).toHaveBeenCalledTimes(4)
    expect(markWatched.mock.calls.map((c) => c[2]).sort()).toEqual(['101', '101', '102', '102'])
  })

  it('resolves the Plex server once for the whole backfill', async () => {
    const { db, pipeline } = await configured()
    db.saveSettings({ plex_token: 'owner-tok' })
    const alice = db.upsertMapping('alice', 'tok-alice', 1, 1, 1)
    db.setSharedTitle({ rating_key: '999', media_type: 'show', plex_sync: 1 }, [alice.id])
    getWatchedEpisodeKeys.mockImplementation(async () => ['101', '102', '103'])

    await pipeline.backfillSharedTitle('999')

    expect(getPlexServer).toHaveBeenCalledOnce()
  })

  it('does not touch Plex when the share has plex_sync off', async () => {
    const { db, pipeline } = await configured()
    db.saveSettings({ plex_token: 'owner-tok' })
    const alice = db.upsertMapping('alice', 'tok-alice', 1, 1, 1)
    db.setSharedTitle({ rating_key: '500', media_type: 'movie', plex_sync: 0 }, [alice.id])
    getMetadata.mockImplementation(async () => ({ ...meta, media_type: 'movie', rating_key: '500' }))

    await pipeline.backfillSharedTitle('500')

    expect(markWatched).not.toHaveBeenCalled()
  })
})
