import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { TautulliMetadata } from '../shared/types'

const episode: TautulliMetadata = {
  media_type: 'episode',
  section_id: '2',
  library_name: 'TV Shows',
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
  art: '/library/metadata/999/art/1',
}

const movie: TautulliMetadata = {
  ...episode,
  media_type: 'movie',
  rating_key: '555',
  title: 'The Matrix',
  grandparent_title: '',
  guid: 'plex://movie/xyz',
}

const getMetadata = vi.fn(async () => episode)
vi.mock('../server/utils/tautulli', () => ({
  getMetadata: (...a: unknown[]) => getMetadata(...(a as [])),
}))
vi.mock('../server/utils/push', () => ({ sendToAll: async () => ({ sent: 0, failed: 0, pruned: 0 }) }))

let tmp: string

async function load() {
  const db = await import('../server/utils/db')
  db.closeDb()
  return { db, notify: await import('../server/utils/notify') }
}

function configured(db: typeof import('../server/utils/db')) {
  db.saveSettings({ tautulli_url: 'http://tautulli:8181', tautulli_apikey: 'key' })
}

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-join-'))
  process.env.DATA_DIR = tmp
  getMetadata.mockClear()
  getMetadata.mockImplementation(async () => episode)
})

afterEach(async () => {
  const db = await import('../server/utils/db')
  db.closeDb()
  fs.rmSync(tmp, { recursive: true, force: true })
})

describe('joinSharedTitle', () => {
  it('shares the show with your own profile, Plex included', async () => {
    const { db, notify } = await load()
    configured(db)
    db.createUser('isntw', 'x:y')
    const mine = db.upsertMapping('isntw', 't', 1)

    const r = await notify.joinSharedTitle('12345')

    expect(r).toEqual({ ok: true, title: 'Breaking Bad' })
    const shares = db.listSharedTitles()
    expect(shares).toHaveLength(1)
    // Keyed on the show, not the episode, so future episodes count too.
    expect(shares[0]!.rating_key).toBe('999')
    expect(shares[0]!.media_type).toBe('show')
    expect(shares[0]!.title).toBe('Breaking Bad')
    expect(shares[0]!.plex_sync).toBe(true)
    expect(shares[0]!.profiles).toEqual([mine.id])
  })

  it('stores the show’s guid, which is what matches a watch from another library', async () => {
    const { db, notify } = await load()
    configured(db)
    db.createUser('isntw', 'x:y')
    db.upsertMapping('isntw', 't', 1)

    await notify.joinSharedTitle('12345')

    expect(db.listSharedTitles()[0]!.guid).toBe('plex://show/def')
  })

  // setSharedTitle replaces the profile set wholesale, so a blind write would drop
  // whoever was already sharing the title.
  it('keeps the profiles already on the title', async () => {
    const { db, notify } = await load()
    configured(db)
    db.createUser('isntw', 'x:y')
    const other = db.upsertMapping('alice', 'a', 1)
    const mine = db.upsertMapping('isntw', 't', 1)
    db.setSharedTitle({ rating_key: '999', media_type: 'show', title: 'Breaking Bad' }, [other.id])

    await notify.joinSharedTitle('12345')

    expect(db.listSharedTitles()[0]!.profiles.sort()).toEqual([other.id, mine.id].sort())
  })

  it('is idempotent — pressing twice leaves one membership', async () => {
    const { db, notify } = await load()
    configured(db)
    db.createUser('isntw', 'x:y')
    const mine = db.upsertMapping('isntw', 't', 1)

    await notify.joinSharedTitle('12345')
    await notify.joinSharedTitle('12345')

    expect(db.listSharedTitles()).toHaveLength(1)
    expect(db.listSharedTitles()[0]!.profiles).toEqual([mine.id])
  })

  it('uses the movie’s own key for a film', async () => {
    const { db, notify } = await load()
    configured(db)
    db.createUser('isntw', 'x:y')
    db.upsertMapping('isntw', 't', 1)
    getMetadata.mockImplementation(async () => movie)

    const r = await notify.joinSharedTitle('555')

    expect(r.title).toBe('The Matrix')
    const share = db.listSharedTitles()[0]!
    expect(share.rating_key).toBe('555')
    expect(share.media_type).toBe('movie')
  })

  it('matches your profile by the linked Plex username too', async () => {
    const { db, notify } = await load()
    configured(db)
    db.createUserFromPlex('bridge-admin', { id: '1', username: 'plexguy', thumb: '' })
    const mine = db.upsertMapping('plexguy', 't', 1)

    await notify.joinSharedTitle('12345')

    expect(db.listSharedTitles()[0]!.profiles).toEqual([mine.id])
  })

  it('refuses when no seenr profile matches your account, rather than sharing blind', async () => {
    const { db, notify } = await load()
    configured(db)
    db.createUser('isntw', 'x:y')
    db.upsertMapping('alice', 'a', 1)

    const r = await notify.joinSharedTitle('12345')

    expect(r.ok).toBe(false)
    expect(r.reason).toBe('No seenr profile matches your account')
    expect(db.listSharedTitles()).toHaveLength(0)
  })

  it('refuses when Tautulli is not configured', async () => {
    const { db, notify } = await load()
    db.createUser('isntw', 'x:y')
    db.upsertMapping('isntw', 't', 1)

    const r = await notify.joinSharedTitle('12345')

    expect(r.ok).toBe(false)
    expect(r.reason).toBe('Tautulli connection not configured')
  })

  it('reports a metadata failure without throwing', async () => {
    const { db, notify } = await load()
    configured(db)
    db.createUser('isntw', 'x:y')
    db.upsertMapping('isntw', 't', 1)
    getMetadata.mockImplementation(async () => {
      throw new Error('tautulli down')
    })

    const r = await notify.joinSharedTitle('12345')

    expect(r.ok).toBe(false)
    expect(r.reason).toContain('tautulli down')
    expect(db.listSharedTitles()).toHaveLength(0)
  })
})
