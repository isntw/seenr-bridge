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
  section_id: '1',
  library_name: 'Movies',
  rating_key: '555',
  title: 'The Matrix',
  year: 1999,
  grandparent_title: '',
  art: '/library/metadata/555/art/1',
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
  icon?: string
  image?: string
  mute?: { subject_key: string; title: string; media_type: string }
  join?: { rating_key: string; title: string }
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

  it('notifies for the signed-in account without it being listed', async () => {
    const { db, notify } = await load()
    db.createUser('isntw', 'x:y')
    enable(db, [])

    const r = await notify.handlePlaybackStart({ ...play, username: 'isntw' })

    expect(r.notified).toBe(true)
    expect(sendToAll).toHaveBeenCalledTimes(1)
  })

  it('matches the signed-in account case-insensitively', async () => {
    const { db, notify } = await load()
    db.createUser('IsntW', 'x:y')
    enable(db, [])

    const r = await notify.handlePlaybackStart({ ...play, username: 'isntw' })

    expect(r.notified).toBe(true)
  })

  it('notifies for the linked Plex username too', async () => {
    const { db, notify } = await load()
    db.createUserFromPlex('bridge-admin', { id: '1', username: 'plexguy', thumb: '' })
    enable(db, [])

    const r = await notify.handlePlaybackStart({ ...play, username: 'plexguy' })

    expect(r.notified).toBe(true)
  })

  it('still ignores a stranger when an account exists', async () => {
    const { db, notify } = await load()
    db.createUser('isntw', 'x:y')
    enable(db, [])

    const r = await notify.handlePlaybackStart({ ...play, username: 'someoneelse' })

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

  it('suppresses a repeat inside the item window', async () => {
    const { db, notify } = await load()
    enable(db)

    const first = await notify.handlePlaybackStart(play, { now: 1_000_000 })
    const second = await notify.handlePlaybackStart(play, { now: 1_000_000 + 60_000 })

    expect(first.notified).toBe(true)
    expect(second.notified).toBe(false)
    expect(sendToAll).toHaveBeenCalledTimes(1)
  })

  it('suppresses a repeat without asking Tautulli again', async () => {
    const { db, notify } = await load()
    enable(db)

    await notify.handlePlaybackStart(play, { now: 1_000_000 })
    getMetadata.mockClear()
    await notify.handlePlaybackStart(play, { now: 1_000_000 + 60_000 })

    expect(getMetadata).not.toHaveBeenCalled()
  })

  it('still suppresses past the item window, because the show window holds', async () => {
    const { db, notify } = await load()
    enable(db)

    await notify.handlePlaybackStart(play, { now: 1_000_000 })
    const later = await notify.handlePlaybackStart(play, { now: 1_000_000 + 31 * 60 * 1000 })

    expect(later.notified).toBe(false)
    expect(later.reason).toBe('Already notified for Breaking Bad recently')
    expect(sendToAll).toHaveBeenCalledTimes(1)
  })

  it('notifies again once the show window has passed', async () => {
    const { db, notify } = await load()
    enable(db)

    await notify.handlePlaybackStart(play, { now: 1_000_000 })
    const later = await notify.handlePlaybackStart(play, {
      now: 1_000_000 + 6 * 60 * 60 * 1000 + 60_000,
    })

    expect(later.notified).toBe(true)
    expect(sendToAll).toHaveBeenCalledTimes(2)
  })

  it('suppresses the next episode of the same show', async () => {
    const { db, notify } = await load()
    enable(db)

    await notify.handlePlaybackStart(play, { now: 1_000_000 })
    getMetadata.mockImplementation(async () => ({
      ...episode,
      rating_key: '12346',
      media_index: '15',
      title: 'Granite State',
    }))
    const next = await notify.handlePlaybackStart(
      { ...play, rating_key: '12346' },
      { now: 1_000_000 + 45 * 60 * 1000 },
    )

    expect(next.notified).toBe(false)
    expect(sendToAll).toHaveBeenCalledTimes(1)
  })

  it('slides the show window while a binge continues', async () => {
    const { db, notify } = await load()
    enable(db)
    const hour = 60 * 60 * 1000

    // Three episodes five hours apart: a fixed six-hour window would lapse before
    // the third and buzz again, a sliding one never does.
    await notify.handlePlaybackStart(play, { now: 0 })
    getMetadata.mockImplementation(async () => ({ ...episode, rating_key: '12346' }))
    await notify.handlePlaybackStart({ ...play, rating_key: '12346' }, { now: 5 * hour })
    getMetadata.mockImplementation(async () => ({ ...episode, rating_key: '12347' }))
    const third = await notify.handlePlaybackStart(
      { ...play, rating_key: '12347' },
      { now: 10 * hour },
    )

    expect(third.notified).toBe(false)
    expect(sendToAll).toHaveBeenCalledTimes(1)
  })

  it('still notifies for a different show inside the window', async () => {
    const { db, notify } = await load()
    enable(db)

    await notify.handlePlaybackStart(play, { now: 1_000_000 })
    getMetadata.mockImplementation(async () => ({
      ...episode,
      rating_key: '777',
      grandparent_rating_key: '888',
      grandparent_title: 'Severance',
    }))
    const other = await notify.handlePlaybackStart(
      { ...play, rating_key: '777' },
      { now: 1_000_000 + 60_000 },
    )

    expect(other.notified).toBe(true)
    expect(sendToAll).toHaveBeenCalledTimes(2)
  })

  it('skips a muted show and says so', async () => {
    const { db, notify } = await load()
    enable(db)
    db.addNotifyMute('999', 'Breaking Bad', 'show')

    const r = await notify.handlePlaybackStart(play)

    expect(r.notified).toBe(false)
    expect(r.reason).toBe('Muted: Breaking Bad')
    expect(sendToAll).not.toHaveBeenCalled()
  })

  it('mutes a movie by its own key', async () => {
    const { db, notify } = await load()
    enable(db)
    getMetadata.mockImplementation(async () => movie)
    db.addNotifyMute('555', 'The Matrix', 'movie')

    const r = await notify.handlePlaybackStart({ ...play, rating_key: '555' })

    expect(r.notified).toBe(false)
    expect(r.reason).toBe('Muted: The Matrix')
  })

  it('reports the mute, not the library, when both would skip', async () => {
    const { db, notify } = await load()
    enable(db, ['alice'], { libraries: JSON.stringify(['1']) })
    db.addNotifyMute('999', 'Breaking Bad', 'show')

    const r = await notify.handlePlaybackStart(play)

    expect(r.reason).toBe('Muted: Breaking Bad')
  })

  it('notifies again once a show is unmuted', async () => {
    const { db, notify } = await load()
    enable(db)
    db.addNotifyMute('999', 'Breaking Bad', 'show')

    await notify.handlePlaybackStart(play, { now: 1_000_000 })
    db.deleteNotifyMute('999')
    const after = await notify.handlePlaybackStart(play, { now: 1_000_000 + 60_000 })

    expect(after.notified).toBe(true)
    expect(sendToAll).toHaveBeenCalledTimes(1)
  })

  it('writes no events row for a muted show', async () => {
    const { db, notify } = await load()
    enable(db)
    db.addNotifyMute('999', 'Breaking Bad', 'show')

    await notify.handlePlaybackStart(play)

    expect(db.listEvents(50)).toHaveLength(0)
  })

  it('tags by show so the OS replaces rather than stacks', async () => {
    const { db, notify } = await load()
    enable(db)

    await notify.handlePlaybackStart(play)

    expect(sendToAll.mock.calls[0]![0].tag).toBe('alice:show:999')
  })

  it('sends the episode still as the wide image', async () => {
    const { db, notify } = await load()
    enable(db)

    await notify.handlePlaybackStart(play)

    const payload = sendToAll.mock.calls[0]![0]
    expect(payload.image).toContain('/api/push/poster?')
    expect(payload.image).toContain(encodeURIComponent('/library/metadata/12345/thumb/1'))
  })

  // The icon slot is square and the platform stretches whatever it holds, so a
  // poster there is squashed however carefully it is fetched. 2.6.3 and 2.6.5 both
  // learned this the hard way; the app icon stays and the art goes in the wide row.
  it('sends no icon at all, leaving the app icon in that slot', async () => {
    const { db, notify } = await load()
    enable(db)

    await notify.handlePlaybackStart(play)

    expect(sendToAll.mock.calls[0]![0]).not.toHaveProperty('icon')
  })

  it('signs the art URL so an unauthenticated fetch can serve it', async () => {
    const { db, notify } = await load()
    const poster = await import('../server/utils/poster')
    enable(db)

    await notify.handlePlaybackStart(play, { now: 1_000_000 })

    const q = new URLSearchParams(sendToAll.mock.calls[0]![0].image!.split('?')[1])
    expect(
      poster.verifiedPosterBox(
        q.get('path')!, q.get('w')!, q.get('h')!, q.get('exp')!, q.get('sig')!, 1_000_000,
      ),
    ).toEqual({ w: 1280, h: 720 })
  })

  it('asks for 16:9, the shape the wide row wants', async () => {
    const { db, notify } = await load()
    enable(db)

    await notify.handlePlaybackStart(play)

    expect(sendToAll.mock.calls[0]![0].image).toContain('w=1280&h=720')
  })

  // A movie's thumb is its 2:3 poster, which the wide row would crop to a strip;
  // art is Plex's backdrop and the only 16:9 image a film has.
  it('uses the backdrop for a movie, not its poster', async () => {
    const { db, notify } = await load()
    enable(db)
    getMetadata.mockImplementation(async () => movie)

    await notify.handlePlaybackStart({ ...play, rating_key: '555' })

    const image = sendToAll.mock.calls[0]![0].image!
    expect(image).toContain(encodeURIComponent('/library/metadata/555/art/1'))
    expect(image).not.toContain(encodeURIComponent('/library/metadata/12345/thumb/1'))
  })

  it('falls back to the backdrop when an episode has no still', async () => {
    const { db, notify } = await load()
    enable(db)
    getMetadata.mockImplementation(async () => ({ ...episode, thumb: '' }))

    await notify.handlePlaybackStart(play)

    expect(sendToAll.mock.calls[0]![0].image).toContain(
      encodeURIComponent('/library/metadata/999/art/1'),
    )
  })

  it('sends no image for an item with no art at all', async () => {
    const { db, notify } = await load()
    enable(db)
    getMetadata.mockImplementation(async () => ({ ...episode, thumb: '', art: '' }))

    await notify.handlePlaybackStart(play)

    expect(sendToAll.mock.calls[0]![0].image).toBe('')
  })

  it('says "you" when the watcher is the signed-in account', async () => {
    const { db, notify } = await load()
    db.createUser('isntw', 'x:y')
    enable(db, [])

    await notify.handlePlaybackStart({ ...play, username: 'isntw' })

    expect(sendToAll.mock.calls[0]![0].body).toBe('Started by you · Watch together')
  })

  it('says "you" for the linked Plex username too', async () => {
    const { db, notify } = await load()
    db.createUserFromPlex('bridge-admin', { id: '1', username: 'plexguy', thumb: '' })
    enable(db, [])

    await notify.handlePlaybackStart({ ...play, username: 'plexguy' })

    expect(sendToAll.mock.calls[0]![0].body).toBe('Started by you · Watch together')
  })

  it('offers "count me in" for someone else’s playback', async () => {
    const { db, notify } = await load()
    db.createUser('isntw', 'x:y')
    enable(db)

    await notify.handlePlaybackStart(play)

    expect(sendToAll.mock.calls[0]![0].join).toEqual({
      rating_key: '12345',
      title: 'Breaking Bad',
    })
  })

  // Counting your own watch for yourself is what the bridge already does unaided.
  it('does not offer it for your own playback', async () => {
    const { db, notify } = await load()
    db.createUser('isntw', 'x:y')
    enable(db, [])

    await notify.handlePlaybackStart({ ...play, username: 'isntw' })

    expect(sendToAll.mock.calls[0]![0].join).toBeUndefined()
  })

  it('carries what the mute action needs', async () => {
    const { db, notify } = await load()
    enable(db)

    await notify.handlePlaybackStart(play)

    expect(sendToAll.mock.calls[0]![0].mute).toEqual({
      subject_key: '999',
      title: 'Breaking Bad',
      media_type: 'show',
    })
  })

  it('offers a movie its own key and type', async () => {
    const { db, notify } = await load()
    enable(db)
    getMetadata.mockImplementation(async () => movie)

    await notify.handlePlaybackStart({ ...play, rating_key: '555' })

    expect(sendToAll.mock.calls[0]![0].mute).toEqual({
      subject_key: '555',
      title: 'The Matrix',
      media_type: 'movie',
    })
  })

  it('dedupes per subject, not per user', async () => {
    const { db, notify } = await load()
    enable(db)

    await notify.handlePlaybackStart(play, { now: 1_000_000 })
    getMetadata.mockImplementation(async () => movie)
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

  it('names the show and episode in the title', async () => {
    const { db, notify } = await load()
    enable(db)

    await notify.handlePlaybackStart(play)

    const payload = sendToAll.mock.calls[0]![0]
    expect(payload.title).toBe('Breaking Bad — S5·E14 · Ozymandias')
    expect(payload.body).toBe('Started by alice · Watch together')
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
    expect(payload.title).toBe('The Matrix — 1999')
    expect(payload.body).toBe('Started by alice · Watch together')
  })

  it('omits the dash when a movie has no year', async () => {
    const { db, notify } = await load()
    enable(db)
    getMetadata.mockImplementation(async () => ({ ...movie, year: '' }))

    await notify.handlePlaybackStart({ ...play, rating_key: '555' })

    expect(sendToAll.mock.calls[0]![0].title).toBe('The Matrix')
  })
})
