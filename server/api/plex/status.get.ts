import { getSettings, listMappings, getPlexClientId } from '../../utils/db'
import { getPlexServer, getSharedTokens, getPlexAccount, getPlexResource } from '../../utils/plex'
import type { PlexLinkStatus } from '../../../shared/types'

// What the Plex step in Settings shows: which account is connected, which server it
// resolves to, and which mapped users the bridge can actually act as. The last one is
// the operationally important part — a user with no reachable token is a silent no-op
// at 2am unless it is visible here first.
//
// Named `status`, not `users`, because it answers more than "who" now.
export default defineEventHandler(async (): Promise<PlexLinkStatus> => {
  const s = getSettings()
  if (!s.plex_token) return { connected: false, matched: [], unmatched: [] }

  const mappings = listMappings()
  try {
    const { machineId, url } = await getPlexServer(s.tautulli_url, s.tautulli_apikey)
    // The resource lookup is the only optional one: it is decoration, so a failure
    // there must not cost the caller the matched/unmatched report it came for.
    const [tokens, account, resource] = await Promise.all([
      getSharedTokens(machineId, s.plex_token),
      getPlexAccount(s.plex_token),
      getPlexResource(s.plex_token, getPlexClientId(), machineId).catch(() => null),
    ])

    const owner = account.username.toLowerCase()
    // The owner is never in shared_servers, but the bridge holds their token — so they
    // count as matched. Mirrors resolvePlexToken's precedence exactly; if the two ever
    // disagree, Settings reports a state the pipeline does not act on.
    const has = (username: string, override: string) =>
      !!override || username.toLowerCase() === owner || tokens.has(username.toLowerCase())

    return {
      connected: true,
      account: account.username,
      server: {
        name: resource?.name || '',
        machineId,
        url,
        product: resource ? `${resource.product} ${resource.productVersion}`.trim() : '',
        platform: resource ? [resource.platform, resource.device].filter(Boolean).join(' · ') : '',
        owned: resource ? resource.owned : null,
      },
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
