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
}

const movie: TautulliMetadata = {
  ...episode,
  media_type: 'movie',
  section_id: '1',
  library_name: 'Movies',
  rating_key: '555',
  title: 'The Matrix',
  year: 1999,
  grandparent_title: '',
}

const getMetadata = vi.fn(async () => episode)
vi.mock('../server/utils/tautulli', () => ({
  getMetadata: (...a: unknown[]) => getMetadata(...(a as [])),
}))

interface SentPayload {
  title: string
  body: string
  url: string
  tag: string
}
const sendToAll = vi.fn(async (_payload: SentPayload) => ({ sent: 1, failed: 0, pruned: 0 }))
vi.mock('../server/utils/push', () => ({
  sendToAll: (...a: unknown[]) => sendToAll(...(a as [SentPayload])),
}))

let tmp: string

async function load() {
  const db = await import('../server/utils/db')
  db.closeDb()
  const notify = await import('../server/utils/notify')
  notify.resetNotifyDedupe()
  return { db, notify }
}

function enable(
  db: typeof import('../server/utils/db'),
  who: string[] = ['alice'],
  extra: Record<string, unknown> = {},
) {
  db.saveSettings({
    tautulli_url: 'http://tautulli:8181',
    tautulli_apikey: 'key',
    notify_enabled: 1,
    notify_users: JSON.stringify(who),
    ...extra,
  })
}

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-notify-'))
  process.env.DATA_DIR = tmp
  getMetadata.mockClear()
  getMetadata.mockImplementation(async () => episode)
  sendToAll.mockClear()
  sendToAll.mockImplementation(async () => ({ sent: 1, failed: 0, pruned: 0 }))
})

afterEach(async () => {
  const db = await import('../server/utils/db')
  db.closeDb()
  fs.rmSync(tmp, { recursive: true, force: true })
})

const play = { action: 'play', rating_key: '12345', username: 'alice' }

describe('handlePlaybackStart', () => {
  it('notifies for a listed user', async () => {
    const { db, notify } = await load()
    enable(db)

    const r = await notify.handlePlaybackStart(play)

    expect(r.notified).toBe(true)
    expect(sendToAll).toHaveBeenCalledTimes(1)
  })

  it('does nothing when notifications are off', async () => {
    const { db, notify } = await load()
    enable(db)
    db.saveSettings({ notify_enabled: 0 })

    const r = await notify.handlePlaybackStart(play)

    expect(r.notified).toBe(false)
    expect(sendToAll).not.toHaveBeenCalled()
  })

  it('notifies nobody when the user list is empty', async () => {
    const { db, notify } = await load()
    enable(db, [])

    const r = await notify.handlePlaybackStart(play)

    expect(r.notified).toBe(false)
    expect(sendToAll).not.toHaveBeenCalled()
  })

  it('ignores a user who is not listed', async () => {
    const { db, notify } = await load()
    enable(db, ['bob'])

    const r = await notify.handlePlaybackStart(play)

    expect(r.notified).toBe(false)
    expect(sendToAll).not.toHaveBeenCalled()
  })

  it('matches the listed username case-insensitively', async () => {
    const { db, notify } = await load()
    enable(db, ['ALICE'])

    const r = await notify.handlePlaybackStart(play)

    expect(r.notified).toBe(true)
  })

  it('notifies for a user with no seenr mapping at all', async () => {
    const { db, notify } = await load()
    enable(db)
    expect(db.listMappings()).toHaveLength(0)

    const r = await notify.handlePlaybackStart(play)

    expect(r.notified).toBe(true)
  })

  it('writes no events row', async () => {
    const { db, notify } = await load()
    enable(db)

    await notify.handlePlaybackStart(play)

    expect(db.listEvents(50)).toHaveLength(0)
  })

  it('suppresses a repeat inside the dedupe window', async () => {
    const { db, notify } = await load()
    enable(db)

    const first = await notify.handlePlaybackStart(play, { now: 1_000_000 })
    const second = await notify.handlePlaybackStart(play, { now: 1_000_000 + 60_000 })

    expect(first.notified).toBe(true)
    expect(second.notified).toBe(false)
    expect(sendToAll).toHaveBeenCalledTimes(1)
  })

  it('notifies again once the dedupe window has passed', async () => {
    const { db, notify } = await load()
    enable(db)

    await notify.handlePlaybackStart(play, { now: 1_000_000 })
    const later = await notify.handlePlaybackStart(play, { now: 1_000_000 + 31 * 60 * 1000 })

    expect(later.notified).toBe(true)
    expect(sendToAll).toHaveBeenCalledTimes(2)
  })

  it('dedupes per item, not per user', async () => {
    const { db, notify } = await load()
    enable(db)
    getMetadata.mockImplementation(async () => movie)

    await notify.handlePlaybackStart(play, { now: 1_000_000 })
    const other = await notify.handlePlaybackStart(
      { ...play, rating_key: '555' },
      { now: 1_000_000 },
    )

    expect(other.notified).toBe(true)
    expect(sendToAll).toHaveBeenCalledTimes(2)
  })

  it('resetNotifyDedupe clears the window', async () => {
    const { db, notify } = await load()
    enable(db)

    await notify.handlePlaybackStart(play, { now: 1_000_000 })
    notify.resetNotifyDedupe()
    const again = await notify.handlePlaybackStart(play, { now: 1_000_000 })

    expect(again.notified).toBe(true)
  })

  it('respects the library selection', async () => {
    const { db, notify } = await load()
    enable(db, ['alice'], { libraries: JSON.stringify(['1']) })

    const r = await notify.handlePlaybackStart(play)

    expect(r.notified).toBe(false)
    expect(r.reason).toContain('TV Shows')
    expect(sendToAll).not.toHaveBeenCalled()
  })

  it('notifies when the item is in a selected library', async () => {
    const { db, notify } = await load()
    enable(db, ['alice'], { libraries: JSON.stringify(['2']) })

    const r = await notify.handlePlaybackStart(play)

    expect(r.notified).toBe(true)
  })

  it('reports a metadata failure without throwing', async () => {
    const { db, notify } = await load()
    enable(db)
    getMetadata.mockImplementation(async () => {
      throw new Error('tautulli down')
    })

    const r = await notify.handlePlaybackStart(play)

    expect(r.notified).toBe(false)
    expect(r.reason).toContain('tautulli down')
    expect(sendToAll).not.toHaveBeenCalled()
  })

  it('names the show and episode for a series', async () => {
    const { db, notify } = await load()
    enable(db)

    await notify.handlePlaybackStart(play)

    const payload = sendToAll.mock.calls[0]![0]
    expect(payload.title).toBe('alice started Breaking Bad')
    expect(payload.body).toContain('S5·E14')
    expect(payload.body).toContain('Ozymandias')
  })

  it('deep-links to the watch-together dialog', async () => {
    const { db, notify } = await load()
    enable(db)

    await notify.handlePlaybackStart(play)

    const payload = sendToAll.mock.calls[0]![0]
    expect(payload.url).toBe('/dashboard?watch=12345&user=alice')
  })

  it('names the film and year for a movie', async () => {
    const { db, notify } = await load()
    enable(db)
    getMetadata.mockImplementation(async () => movie)

    await notify.handlePlaybackStart({ ...play, rating_key: '555' })

    const payload = sendToAll.mock.calls[0]![0]
    expect(payload.title).toBe('alice started The Matrix')
    expect(payload.body).toContain('1999')
  })
})
