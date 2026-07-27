import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { getPlexServer, markWatched } from '../server/utils/plex'

const fetchMock = vi.fn()

function tautulliOk(data: unknown) {
  return { ok: true, json: async () => ({ response: { result: 'success', data } }) } as unknown as Response
}

const SERVER_INFO = {
  pms_identifier: 'abc123machine',
  pms_url: 'http://10.0.0.5:32400',
  pms_ip: '10.0.0.5',
  pms_port: 32400,
  pms_ssl: 0,
}

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('getPlexServer', () => {
  it('reads the address and machine identifier from Tautulli', async () => {
    fetchMock.mockResolvedValue(tautulliOk(SERVER_INFO))

    await expect(getPlexServer('http://taut:8181', 'key')).resolves.toEqual({
      url: 'http://10.0.0.5:32400',
      machineId: 'abc123machine',
    })
  })

  it('asks Tautulli for get_server_info', async () => {
    fetchMock.mockResolvedValue(tautulliOk(SERVER_INFO))

    await getPlexServer('http://taut:8181/', 'k3y')

    expect(String(fetchMock.mock.calls[0]![0])).toContain('cmd=get_server_info')
    expect(String(fetchMock.mock.calls[0]![0])).toBe(
      'http://taut:8181/api/v2?apikey=k3y&cmd=get_server_info',
    )
  })

  it('strips a trailing slash from pms_url', async () => {
    fetchMock.mockResolvedValue(tautulliOk({ ...SERVER_INFO, pms_url: 'http://10.0.0.5:32400/' }))

    const s = await getPlexServer('http://taut:8181', 'key')
    expect(s.url).toBe('http://10.0.0.5:32400')
  })

  it('rebuilds the address from ip/port/ssl when pms_url is absent', async () => {
    fetchMock.mockResolvedValue(
      tautulliOk({ pms_identifier: 'm', pms_ip: '10.0.0.9', pms_port: 32400, pms_ssl: 1 }),
    )

    const s = await getPlexServer('http://taut:8181', 'key')
    expect(s.url).toBe('https://10.0.0.9:32400')
  })

  it('throws when Tautulli reports no machine identifier', async () => {
    fetchMock.mockResolvedValue(tautulliOk({ pms_url: 'http://10.0.0.5:32400' }))

    await expect(getPlexServer('http://taut:8181', 'key')).rejects.toThrow('machine identifier')
  })

  it('throws when the address is unusable', async () => {
    fetchMock.mockResolvedValue(tautulliOk({ pms_identifier: 'm', pms_ip: '', pms_port: '' }))

    await expect(getPlexServer('http://taut:8181', 'key')).rejects.toThrow('usable Plex address')
  })

  it('throws on an HTTP error from Tautulli', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 502 } as unknown as Response)

    await expect(getPlexServer('http://taut:8181', 'key')).rejects.toThrow('Tautulli HTTP 502')
  })
})

describe('markWatched', () => {
  it('calls /:/scrobble with the rating key, the library identifier and the token', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200 } as unknown as Response)

    const status = await markWatched('http://10.0.0.5:32400', 'ana-token', '12345')

    expect(status).toBe(200)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(
      'http://10.0.0.5:32400/:/scrobble?key=12345&identifier=com.plexapp.plugins.library',
    )
    // The token is not authentication here — it selects WHOSE copy is marked.
    expect((init.headers as Record<string, string>)['X-Plex-Token']).toBe('ana-token')
  })

  it('returns a non-2xx status instead of throwing, so it can be recorded', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 401 } as unknown as Response)

    await expect(markWatched('http://plex:32400', 'stale', '1')).resolves.toBe(401)
  })

  it('tolerates a trailing slash on the server address', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200 } as unknown as Response)

    await markWatched('http://plex:32400/', 'tok', '7')

    expect(String(fetchMock.mock.calls[0]![0])).toBe(
      'http://plex:32400/:/scrobble?key=7&identifier=com.plexapp.plugins.library',
    )
  })
})
