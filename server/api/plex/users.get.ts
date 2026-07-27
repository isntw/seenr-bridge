import { getSettings, listMappings } from '../../utils/db'
import { getPlexServer, getSharedTokens, getPlexAccount } from '../../utils/plex'
import type { PlexLinkStatus } from '../../../shared/types'

// Which mapped users the bridge can actually act as. Surfaced in Settings so a
// missing token is visible now, rather than as a silent no-op at 2am.
export default defineEventHandler(async (): Promise<PlexLinkStatus> => {
  const s = getSettings()
  if (!s.plex_token) return { connected: false, matched: [], unmatched: [] }

  const mappings = listMappings()
  try {
    const { machineId } = await getPlexServer(s.tautulli_url, s.tautulli_apikey)
    const [tokens, account] = await Promise.all([
      getSharedTokens(machineId, s.plex_token),
      getPlexAccount(s.plex_token),
    ])
    const owner = account.username.toLowerCase()
    // The owner is never in shared_servers, but the bridge holds their token — so they
    // count as matched. Mirrors resolvePlexToken's precedence exactly; if the two ever
    // disagree, Settings reports a state the pipeline does not act on.
    const has = (username: string, override: string) =>
      !!override || username.toLowerCase() === owner || tokens.has(username.toLowerCase())

    return {
      connected: true,
      matched: mappings.filter((m) => has(m.username, m.plex_token)).map((m) => m.username),
      unmatched: mappings.filter((m) => !has(m.username, m.plex_token)).map((m) => m.username),
    }
  } catch (e) {
    return {
      connected: true,
      matched: [],
      unmatched: mappings.map((m) => m.username),
      error: e instanceof Error ? e.message : String(e),
    }
  }
})
