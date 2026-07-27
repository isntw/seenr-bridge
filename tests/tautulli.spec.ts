import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { getChildren, getLibraryItems, resetLibraryRefreshCooldown } from '../server/utils/tautulli'

const fetchMock = vi.fn()

// Tautulli wraps every reply in the same envelope; only `data` varies by command.
function ok(data: unknown) {
  return { ok: true, json: async () => ({ response: { result: 'success', data } }) } as unknown as Response
}

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
  resetLibraryRefreshCooldown()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('getChildren', () => {
  it('maps children_list rows onto LibraryChild', async () => {
    fetchMock.mockResolvedValue(
      ok({
        children_count: '2',
        children_list: [
          {
            rating_key: 301,
            title: 'Season 1',
            media_index: 1,
            media_type: 'season',
            thumb: '/library/metadata/301/thumb/1',
          },
          { rating_key: 302, title: 'Season 2', media_index: 2, media_type: 'season' },
        ],
      }),
    )

    const out = await getChildren('http://tautulli:8181', 'key', '300')

    expect(out).toEqual([
      {
        rating_key: '301',
        title: 'Season 1',
        index: '1',
        media_type: 'season',
        image: '/library/metadata/301/thumb/1',
      },
      { rating_key: '302', title: 'Season 2', index: '2', media_type: 'season', image: '' },
    ])
  })

  it('coerces numeric rating_key and media_index to strings', async () => {
    fetchMock.mockResolvedValue(
      ok({ children_list: [{ rating_key: 25419, title: 'Children', media_index: 5, media_type: 'episode' }] }),
    )

    const [ep] = await getChildren('http://tautulli:8181', 'key', '3010')

    expect(ep).toEqual({
      rating_key: '25419',
      title: 'Children',
      index: '5',
      media_type: 'episode',
      image: '',
    })
  })

  it('returns [] when children_list is absent', async () => {
    fetchMock.mockResolvedValue(ok({ children_count: '0' }))
    await expect(getChildren('http://tautulli:8181', 'key', '300')).resolves.toEqual([])
  })

  it('drops rows with no usable rating_key', async () => {
    fetchMock.mockResolvedValue(
      ok({ children_list: [{ rating_key: '', title: 'ghost' }, { rating_key: '7', title: 'real' }] }),
    )

    const out = await getChildren('http://tautulli:8181', 'key', '300')

    expect(out.map((c) => c.rating_key)).toEqual(['7'])
  })

  it('throws with Tautulli\'s message when the API reports failure', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ response: { result: 'error', message: 'Invalid rating_key' } }),
    } as unknown as Response)

    await expect(getChildren('http://tautulli:8181', 'key', 'nope')).rejects.toThrow('Invalid rating_key')
  })

  it('sends the rating_key as get_children_metadata', async () => {
    fetchMock.mockResolvedValue(ok({ children_list: [] }))

    await getChildren('http://tautulli:8181/', 'k3y', '300')

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('http://tautulli:8181/api/v2')
    expect(String(init.body)).toContain('cmd=get_children_metadata')
    expect(String(init.body)).toContain('rating_key=300')
  })
})

// Tautulli's media-info table is a cache that only rebuilds on demand, so a stale
// section silently hides titles and offers rating_keys Plex no longer resolves.
// getLibraryItems detects that by comparing recordsTotal against the library row's
// own count, which does track Plex.
describe('getLibraryItems staleness refresh', () => {
  const LIBS = [{ section_id: '1', section_name: 'Movies', section_type: 'movie', count: 308 }]

  function mediaInfo(rows: { rating_key: string; title: string }[], recordsTotal: number) {
    return ok({ recordsTotal, recordsFiltered: rows.length, data: rows })
  }

  /** The bodies of every get_library_media_info call, in order. */
  function mediaInfoBodies() {
    return fetchMock.mock.calls
      .map((c) => String((c[1] as RequestInit | undefined)?.body ?? ''))
      .filter((b) => b.includes('cmd=get_library_media_info'))
  }

  it('re-requests with refresh=true when the cached total is short of the library count', async () => {
    fetchMock
      .mockResolvedValueOnce(ok(LIBS))
      .mockResolvedValueOnce(mediaInfo([{ rating_key: '4159', title: 'Avatar' }], 99))
      .mockResolvedValueOnce(mediaInfo([{ rating_key: '12266', title: 'Avatar: The Way of Water' }], 308))

    const out = await getLibraryItems('http://tautulli:8181', 'key', { type: 'movie' })

    const bodies = mediaInfoBodies()
    expect(bodies).toHaveLength(2)
    expect(bodies[0]).not.toContain('refresh=true')
    expect(bodies[1]).toContain('refresh=true')
    // The refreshed reply wins, so the ghost row is gone.
    expect(out.items.map((i) => i.rating_key)).toEqual(['12266'])
    expect(out.total).toBe(1)
  })

  it('does not refresh when the counts already agree', async () => {
    fetchMock
      .mockResolvedValueOnce(ok(LIBS))
      .mockResolvedValueOnce(mediaInfo([{ rating_key: '12266', title: 'Way of Water' }], 308))

    await getLibraryItems('http://tautulli:8181', 'key', { type: 'movie' })

    expect(mediaInfoBodies()).toHaveLength(1)
  })

  it('refreshes at most once per section inside the cooldown', async () => {
    // Every reply stays short, so without a cooldown each call would rebuild —
    // once per keystroke of a debounced search.
    fetchMock.mockImplementation(async (_url: string, init?: RequestInit) => {
      const body = String(init?.body ?? '')
      return body.includes('cmd=get_libraries') ? ok(LIBS) : mediaInfo([], 99)
    })

    await getLibraryItems('http://tautulli:8181', 'key', { type: 'movie', search: 'av' })
    await getLibraryItems('http://tautulli:8181', 'key', { type: 'movie', search: 'ava' })
    await getLibraryItems('http://tautulli:8181', 'key', { type: 'movie', search: 'avat' })

    expect(mediaInfoBodies().filter((b) => b.includes('refresh=true'))).toHaveLength(1)
  })

  it('keeps the search term on the refreshed request', async () => {
    fetchMock
      .mockResolvedValueOnce(ok(LIBS))
      .mockResolvedValueOnce(mediaInfo([], 99))
      .mockResolvedValueOnce(mediaInfo([{ rating_key: '12266', title: 'Way of Water' }], 308))

    await getLibraryItems('http://tautulli:8181', 'key', { type: 'movie', search: 'avata' })

    const [, refreshed] = mediaInfoBodies()
    expect(refreshed).toContain('search=avata')
    expect(refreshed).toContain('refresh=true')
  })

  it('applies the cooldown per section, not globally', async () => {
    const twoSections = [
      { section_id: '1', section_name: 'Movies', section_type: 'movie', count: 308 },
      { section_id: '5', section_name: 'Filme', section_type: 'movie', count: 308 },
    ]
    fetchMock.mockImplementation(async (_url: string, init?: RequestInit) => {
      const body = String(init?.body ?? '')
      return body.includes('cmd=get_libraries') ? ok(twoSections) : mediaInfo([], 99)
    })

    await getLibraryItems('http://tautulli:8181', 'key', { type: 'movie' })

    expect(mediaInfoBodies().filter((b) => b.includes('refresh=true'))).toHaveLength(2)
  })
})
