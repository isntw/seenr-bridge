// Plex client. Two very different servers live behind this one module: the local
// Plex Media Server (watched state) and plex.tv (per-user tokens, OAuth).
//
// The load-bearing fact: watched state in Plex belongs to an ACCOUNT, not to an
// item, and the X-Plex-Token on a request is the only thing that selects which
// account. So the token passed to markWatched() is not authentication — it is the
// choice of whose copy is marked. There is no admin impersonation parameter.

// Tautulli wraps every reply in the same envelope; only `data` varies by command.
interface TautulliResponse<T> {
  response?: {
    result?: string
    message?: string
    data?: T
  }
}

interface PmsServerInfo {
  pms_identifier?: string
  pms_url?: string
  pms_ip?: string
  pms_port?: string | number
  pms_ssl?: string | number
}

export interface PlexServer {
  /** Base URL of the Plex Media Server, no trailing slash. */
  url: string
  /** The PMS machineIdentifier — plex.tv keys shared_servers on it. */
  machineId: string
}

function base(url: string): string {
  return url.replace(/\/+$/, '')
}

// Derived from Tautulli rather than configured: the bridge already holds a working
// Tautulli connection, and get_server_info reports both the PMS address and its
// machineIdentifier — so this feature asks the operator for no new URL.
export async function getPlexServer(tautulliUrl: string, apiKey: string): Promise<PlexServer> {
  const u = `${base(tautulliUrl)}/api/v2?apikey=${encodeURIComponent(apiKey)}&cmd=get_server_info`
  const res = await fetch(u)
  if (!res.ok) throw new Error(`Tautulli HTTP ${res.status}`)

  const json = (await res.json()) as TautulliResponse<PmsServerInfo>
  const d = json?.response?.data

  const machineId = d?.pms_identifier ? String(d.pms_identifier) : ''
  if (!machineId) throw new Error('Tautulli did not report the Plex machine identifier')

  // pms_url is present on current Tautulli; rebuild from the parts if it is not.
  const url = d?.pms_url
    ? base(String(d.pms_url))
    : `${Number(d?.pms_ssl) ? 'https' : 'http'}://${d?.pms_ip ?? ''}:${d?.pms_port ?? 32400}`
  if (!/^https?:\/\/[^:/]+(:\d+)?$/.test(url))
    throw new Error('Tautulli did not report a usable Plex address')

  return { url, machineId }
}

/** Mark one item watched for the account the token belongs to. Returns the HTTP
 *  status rather than throwing on a non-2xx, so the caller can record it on the
 *  event row instead of losing it. */
export async function markWatched(plexUrl: string, token: string, ratingKey: string): Promise<number> {
  const u = `${base(plexUrl)}/:/scrobble?key=${encodeURIComponent(ratingKey)}&identifier=com.plexapp.plugins.library`
  const res = await fetch(u, {
    headers: { 'X-Plex-Token': token, accept: 'application/json' },
  })
  return res.status
}

const PLEX_TV = 'https://plex.tv'

/** plex.tv answers shared_servers in XML — the only XML this codebase parses. Taken
 *  apart with a regex over the SharedServer open tags rather than pulling in an XML
 *  dependency for one endpoint.
 *
 *  Keys are lowercased because mapping usernames are matched COLLATE NOCASE in
 *  SQLite, so the two lookups must agree on case. Entries with no username are
 *  skipped: those are home/managed profiles, which plex.tv does not name here and
 *  which rely on the per-mapping manual override instead. */
export function parseSharedServers(xml: string): Map<string, string> {
  const out = new Map<string, string>()
  for (const tag of xml.match(/<SharedServer\b[^>]*>/g) ?? []) {
    const username = /\busername="([^"]*)"/.exec(tag)?.[1] ?? ''
    const token = /\baccessToken="([^"]*)"/.exec(tag)?.[1] ?? ''
    if (username && token) out.set(username.toLowerCase(), token)
  }
  return out
}

export async function getSharedTokens(
  machineId: string,
  ownerToken: string,
): Promise<Map<string, string>> {
  const u = `${PLEX_TV}/api/servers/${encodeURIComponent(machineId)}/shared_servers?X-Plex-Token=${encodeURIComponent(ownerToken)}`
  const res = await fetch(u, { headers: { accept: 'application/xml' } })
  if (!res.ok) throw new Error(`plex.tv HTTP ${res.status}`)
  return parseSharedServers(await res.text())
}

/** The username of the account a token belongs to. Needed because the OWNER never
 *  appears in shared_servers — you do not share a server with yourself — so without
 *  this the owner is indistinguishable from a user who has no token at all. */
export async function getPlexAccount(ownerToken: string): Promise<{ username: string }> {
  const res = await fetch(`${PLEX_TV}/api/v2/user`, {
    headers: { accept: 'application/json', 'X-Plex-Token': ownerToken },
  })
  if (!res.ok) throw new Error(`plex.tv HTTP ${res.status}`)
  const u = (await res.json()) as { username?: string }
  return { username: String(u?.username ?? '') }
}

// Discovered tokens are cached IN MEMORY and never written to SQLite: they are other
// people's Plex credentials, and the only thing a restart costs is one plex.tv call.
// Same shape as the library-refresh cooldown in tautulli.ts.
const TOKEN_TTL_MS = 10 * 60_000
let tokenCache: { at: number; owner: string; tokens: Map<string, string> } | null = null

/** Test seam only — module state would otherwise leak between specs. */
export function resetPlexTokenCache(): void {
  tokenCache = null
}

/** The Plex token to act as `username`, in precedence order:
 *    1. the operator's manual override
 *    2. the owner's own token, when `username` IS the signed-in account
 *    3. the discovery cache / one plex.tv lookup
 *
 *  Step 2 is not a nicety. shared_servers lists who the server is shared WITH, so the
 *  owner is absent from it by definition — and the owner is very often one of the
 *  co-watchers. Without this the bridge would report "No Plex token for <owner>" while
 *  holding that exact token in settings.
 *
 *  Returns null rather than throwing when the user genuinely has no token — that is a
 *  recordable skip ("no Plex token for Ana"), not a failure of the bridge. */
export async function resolvePlexToken(
  username: string,
  override: string,
  machineId: string,
  ownerToken: string,
): Promise<string | null> {
  if (override) return override
  if (!ownerToken) return null

  if (!tokenCache || Date.now() - tokenCache.at > TOKEN_TTL_MS) {
    // Both lookups share one TTL: they are refreshed together or not at all, so the
    // owner's name can never go stale against the token map it is compared with.
    const [account, tokens] = await Promise.all([
      getPlexAccount(ownerToken),
      getSharedTokens(machineId, ownerToken),
    ])
    tokenCache = { at: Date.now(), owner: account.username.toLowerCase(), tokens }
  }

  const wanted = username.toLowerCase()
  if (tokenCache.owner && wanted === tokenCache.owner) return ownerToken
  return tokenCache.tokens.get(wanted) ?? null
}
