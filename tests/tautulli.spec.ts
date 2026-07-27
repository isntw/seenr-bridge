import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { getChildren } from '../server/utils/tautulli'

const fetchMock = vi.fn()

// Tautulli wraps every reply in the same envelope; only `data` varies by command.
function ok(data: unknown) {
  return { ok: true, json: async () => ({ response: { result: 'success', data } }) } as unknown as Response
}

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
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
