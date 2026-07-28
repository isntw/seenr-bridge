import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  getPlexServer,
  markWatched,
  parseSharedServers,
  getSharedTokens,
  getPlexAccount,
  resolvePlexToken,
  resetPlexTokenCache,
  startPinLogin,
  pollPinLogin,
  plexAuthUrl,
} from '../server/utils/plex'

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

// plex.tv answers this endpoint in XML — the only XML in this codebase.
const SHARED_SERVERS_XML = `<?xml version="1.0" encoding="UTF-8"?>
<MediaContainer friendlyName="myPlex" identifier="com.plexapp.plugins.myplex">
  <SharedServer id="1" username="Ana" email="ana@example.com" userID="111" accessToken="ana-tok" acceptedAt="1600000000">
    <Section id="10" key="1" title="Movies" type="movie" shared="1"/>
  </SharedServer>
  <SharedServer id="2" username="mihai" email="m@example.com" userID="222" accessToken="mihai-tok">
    <Section id="11" key="2" title="TV Shows" type="show" shared="1"/>
  </SharedServer>
  <SharedServer id="3" username="" email="" userID="333" accessToken="managed-tok"/>
  <SharedServer id="4" username="notoken" email="n@example.com" userID="444" accessToken=""/>
</MediaContainer>`

describe('parseSharedServers', () => {
  it('maps usernames to access tokens, lowercased', () => {
    const out = parseSharedServers(SHARED_SERVERS_XML)

    // Lowercased because mapping usernames match COLLATE NOCASE in SQLite.
    expect(out.get('ana')).toBe('ana-tok')
    expect(out.get('mihai')).toBe('mihai-tok')
  })

  it('drops entries with no username — home profiles rely on the manual override', () => {
    expect([...parseSharedServers(SHARED_SERVERS_XML).values()]).not.toContain('managed-tok')
  })

  it('drops entries with an empty accessToken', () => {
    expect(parseSharedServers(SHARED_SERVERS_XML).has('notoken')).toBe(false)
  })

  it('returns an empty map for XML with no shared users', () => {
    expect(parseSharedServers('<MediaContainer size="0"/>').size).toBe(0)
  })

  it('returns an empty map for junk input rather than throwing', () => {
    expect(parseSharedServers('not xml at all').size).toBe(0)
  })
})

describe('getSharedTokens', () => {
  it('requests shared_servers for the machine id with the owner token', async () => {
    fetchMock.mockResolvedValue({ ok: true, text: async () => SHARED_SERVERS_XML } as unknown as Response)

    const out = await getSharedTokens('abc123machine', 'owner-tok')

    expect(String(fetchMock.mock.calls[0]![0])).toBe(
      'https://plex.tv/api/servers/abc123machine/shared_servers?X-Plex-Token=owner-tok',
    )
    expect(out.get('ana')).toBe('ana-tok')
  })

  it('throws on an HTTP error from plex.tv', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 401 } as unknown as Response)

    await expect(getSharedTokens('m', 'bad')).rejects.toThrow('plex.tv HTTP 401')
  })
})

describe('getPlexAccount', () => {
  it('returns the username of the account the token belongs to', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        id: 9566164,
        username: 'isntw',
        email: 'owner@example.com',
        thumb: 'https://plex.tv/users/2fa8bb540581852d/avatar',
      }),
    } as unknown as Response)

    await expect(getPlexAccount('owner-tok')).resolves.toEqual({
      id: '9566164',
      username: 'isntw',
      thumb: 'https://plex.tv/users/2fa8bb540581852d/avatar',
    })

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://plex.tv/api/v2/user')
    expect((init.headers as Record<string, string>)['X-Plex-Token']).toBe('owner-tok')
  })

  it('throws on an HTTP error from plex.tv', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 401 } as unknown as Response)

    await expect(getPlexAccount('bad')).rejects.toThrow('plex.tv HTTP 401')
  })
})

describe('resolvePlexToken', () => {
  beforeEach(() => resetPlexTokenCache())

  // resolvePlexToken makes TWO plex.tv calls, so the stub dispatches on URL rather
  // than answering everything with the same body.
  function plexTvReplies(ownerUsername = 'isntw') {
    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).includes('/api/v2/user'))
        return { ok: true, json: async () => ({ username: ownerUsername }) } as unknown as Response
      return { ok: true, text: async () => SHARED_SERVERS_XML } as unknown as Response
    })
  }

  it('prefers a manual override without calling plex.tv at all', async () => {
    plexTvReplies()

    await expect(resolvePlexToken('ana', 'manual-tok', 'm', 'owner')).resolves.toBe('manual-tok')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('discovers a token by username, case-insensitively', async () => {
    plexTvReplies()

    await expect(resolvePlexToken('ANA', '', 'm', 'owner')).resolves.toBe('ana-tok')
  })

  // The owner is absent from shared_servers by definition, and is very often a
  // co-watcher. Without this they would be reported as having no token while the
  // bridge holds theirs in settings.
  it('returns the owner token when the username IS the signed-in account', async () => {
    plexTvReplies('isntw')

    await expect(resolvePlexToken('isntw', '', 'm', 'owner-tok')).resolves.toBe('owner-tok')
  })

  it('matches the owner case-insensitively too', async () => {
    plexTvReplies('isntw')

    await expect(resolvePlexToken('ISNTW', '', 'm', 'owner-tok')).resolves.toBe('owner-tok')
  })

  it('still prefers an explicit override over the owner token', async () => {
    plexTvReplies('isntw')

    await expect(resolvePlexToken('isntw', 'manual', 'm', 'owner-tok')).resolves.toBe('manual')
  })

  it('does not hand the owner token to a user who merely has no share', async () => {
    plexTvReplies('isntw')

    // 'nobody' is neither the owner nor in shared_servers: null, never a fallback to
    // the owner's token, which would mark the WRONG person's copy watched.
    await expect(resolvePlexToken('nobody', '', 'm', 'owner-tok')).resolves.toBeNull()
  })

  it('returns null for a user plex.tv does not list', async () => {
    plexTvReplies()

    await expect(resolvePlexToken('nobody', '', 'm', 'owner')).resolves.toBeNull()
  })

  it('returns null without a lookup when no owner token is configured', async () => {
    await expect(resolvePlexToken('ana', '', 'm', '')).resolves.toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('caches both lookups across users, so a fan-out costs two plex.tv calls', async () => {
    plexTvReplies()

    await resolvePlexToken('ana', '', 'm', 'owner')
    await resolvePlexToken('mihai', '', 'm', 'owner')

    // One /api/v2/user + one shared_servers, for the pair — not per user.
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('re-fetches after the cache is reset', async () => {
    plexTvReplies()

    await resolvePlexToken('ana', '', 'm', 'owner')
    resetPlexTokenCache()
    await resolvePlexToken('ana', '', 'm', 'owner')

    expect(fetchMock).toHaveBeenCalledTimes(4)
  })

  // The guard on `tokenCache.owner` being non-empty: if plex.tv returns no username,
  // nobody may match "the owner", least of all a user whose name is also empty.
  // Without the guard this hands out the owner's token and marks the WRONG copy watched.
  it('never treats anyone as the owner when plex.tv reports no username', async () => {
    plexTvReplies('')

    await expect(resolvePlexToken('', '', 'm', 'owner-tok')).resolves.toBeNull()
    await expect(resolvePlexToken('nobody', '', 'm', 'owner-tok')).resolves.toBeNull()
    // A genuinely shared user still resolves normally — the guard must not break discovery.
    await expect(resolvePlexToken('ana', '', 'm', 'owner-tok')).resolves.toBe('ana-tok')
  })
})

describe('OAuth PIN login', () => {
  it('creates a strong PIN with the client identifier and product', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ id: 12345, code: 'ABCD', authToken: null }),
    } as unknown as Response)

    const pin = await startPinLogin('client-uuid')

    expect(pin).toEqual({ id: '12345', code: 'ABCD' })
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://plex.tv/api/v2/pins?strong=true')
    expect(init.method).toBe('POST')
    const headers = init.headers as Record<string, string>
    expect(headers['X-Plex-Client-Identifier']).toBe('client-uuid')
    expect(headers['X-Plex-Product']).toBe('Seenr Bridge')
  })

  it('throws when plex.tv rejects the PIN request', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500 } as unknown as Response)

    await expect(startPinLogin('c')).rejects.toThrow('plex.tv HTTP 500')
  })

  it('returns null while the PIN is still unclaimed', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ id: 12345, code: 'ABCD', authToken: null }),
    } as unknown as Response)

    await expect(pollPinLogin('client-uuid', '12345')).resolves.toBeNull()
  })

  it('returns the token once the PIN is claimed, polling with the SAME client id', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ id: 12345, code: 'ABCD', authToken: 'owner-token' }),
    } as unknown as Response)

    await expect(pollPinLogin('client-uuid', '12345')).resolves.toBe('owner-token')

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://plex.tv/api/v2/pins/12345')
    // A different identifier here than the one that created the PIN never returns a token.
    expect((init.headers as Record<string, string>)['X-Plex-Client-Identifier']).toBe('client-uuid')
  })

  it('builds the sign-in URL the operator visits', () => {
    expect(plexAuthUrl('client-uuid', 'ABCD')).toBe(
      'https://app.plex.tv/auth#?clientID=client-uuid&code=ABCD&context%5Bdevice%5D%5Bproduct%5D=Seenr+Bridge',
    )
  })
})
