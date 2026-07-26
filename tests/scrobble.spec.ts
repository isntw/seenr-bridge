import { describe, it, expect } from 'vitest'
import { mapEvent, buildPayload } from '../server/utils/scrobble'
import type { TautulliMetadata } from '../shared/types'

const episode: TautulliMetadata = {
  media_type: 'episode',
  rating_key: '12345',
  title: 'Ozymandias',
  grandparent_title: 'Breaking Bad',
  parent_media_index: '5',
  media_index: '14',
  year: 2013,
  duration: 2880000,
  guid: 'plex://episode/5d9c0876e98e47001eb0d74e',
  grandparent_guid: 'plex://show/5d9c081e8ba7be001e343e2a',
  grandparent_rating_key: '999',
  // The episode's OWN ids — the whole point of the bridge.
  guids: ['imdb://tt2301455', 'tmdb://62161', 'tvdb://4589350'],
  thumb: '/library/metadata/12345/thumb/1700000000',
  grandparent_thumb: '/library/metadata/999/thumb/1700000000',
}

const movie: TautulliMetadata = {
  ...episode,
  media_type: 'movie',
  rating_key: '777',
  title: 'Sicario',
  grandparent_title: '',
  parent_media_index: '',
  media_index: '',
  year: 2015,
  guid: 'plex://movie/5d776b1f9ab5437c19540b1f',
  grandparent_guid: '',
  grandparent_rating_key: '',
  guids: ['imdb://tt3397884', 'tmdb://273481'],
}

describe('mapEvent', () => {
  it('maps every Tautulli action to its Plex event name', () => {
    expect(mapEvent('play')).toBe('media.play')
    expect(mapEvent('resume')).toBe('media.resume')
    expect(mapEvent('pause')).toBe('media.pause')
    expect(mapEvent('stop')).toBe('media.stop')
    expect(mapEvent('watched')).toBe('media.scrobble')
    expect(mapEvent('scrobble')).toBe('media.scrobble')
  })

  it('strips the on_ prefix Tautulli sometimes sends', () => {
    expect(mapEvent('on_watched')).toBe('media.scrobble')
    expect(mapEvent('on_play')).toBe('media.play')
  })

  it('falls back to media.scrobble for unknown actions', () => {
    expect(mapEvent('nonsense')).toBe('media.scrobble')
    expect(mapEvent('')).toBe('media.scrobble')
  })
})

describe('buildPayload for episodes', () => {
  it("carries the episode's own ids, not the show's", () => {
    const built = buildPayload(episode, 'watched', 'alice')
    const guids = (built.payload.Metadata as any).Guid

    expect(guids).toEqual([
      { id: 'imdb://tt2301455' },
      { id: 'tmdb://62161' },
      { id: 'tvdb://4589350' },
    ])
    expect(built.ids).toEqual(episode.guids)
    // The show's guid must never appear in the Guid array.
    expect(JSON.stringify(guids)).not.toContain('5d9c081e8ba7be001e343e2a')
  })

  it('includes show title and season/episode indices', () => {
    const meta = buildPayload(episode, 'watched', 'alice').payload.Metadata as any
    expect(meta.grandparentTitle).toBe('Breaking Bad')
    expect(meta.grandparentGuid).toBe('plex://show/5d9c081e8ba7be001e343e2a')
    expect(meta.parentIndex).toBe('5')
    expect(meta.index).toBe('14')
    expect(meta.type).toBe('episode')
  })

  it('sets the event and account from the action and username', () => {
    const built = buildPayload(episode, 'watched', 'alice')
    expect(built.payload.event).toBe('media.scrobble')
    expect(built.payload.Account).toEqual({ title: 'alice' })
    expect(built.event).toBe('media.scrobble')
    expect(built.title).toBe('Ozymandias')
  })
})

describe('buildPayload for movies', () => {
  it('carries the movie ids and omits episode-only fields', () => {
    const built = buildPayload(movie, 'watched', 'bob')
    const meta = built.payload.Metadata as any

    expect(meta.type).toBe('movie')
    expect(meta.Guid).toEqual([
      { id: 'imdb://tt3397884' },
      { id: 'tmdb://273481' },
    ])
    expect(meta.grandparentTitle).toBeUndefined()
    expect(meta.parentIndex).toBeUndefined()
    expect(meta.index).toBeUndefined()
  })
})

describe('buildPayload edge cases', () => {
  it('tolerates missing guids without throwing', () => {
    const built = buildPayload({ ...episode, guids: undefined as any }, 'watched', 'alice')
    expect(built.ids).toEqual([])
    expect((built.payload.Metadata as any).Guid).toEqual([])
  })
})
