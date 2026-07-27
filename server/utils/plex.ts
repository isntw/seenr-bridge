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
