import { setSessionCookie } from '../../../utils/auth'
import {
  getPlexClientId, countUsers, createUserFromPlex, getSettings,
  firstUser, recordPlexAccount,
} from '../../../utils/db'
import { pollPinLogin, getPlexAccount, getPlexServer, getPlexResource } from '../../../utils/plex'
import type { AuthStatus } from '../../../../shared/types'

// PUBLIC — signing in happens before there is a session.
//
// The PIN id travels in the BODY, not the path. PUBLIC_API_PATHS is an exact-match set
// on purpose: a dynamic `/poll/<id>` segment would need prefix matching, and Nitro
// decodes %2e%2e before routing, so `/api/auth/plex/poll/%2e%2e/settings` would reach
// the settings handler while the gate still saw the encoded path. A static path closes
// that off entirely.
//
// Authorisation is by ROLE, not by a stored link: whoever OWNS the Plex server this
// bridge watches may sign in. Same approach Tautulli takes for its own admin sign-in
// (HTTP_PLEX_ADMIN + is_admin), and it holds here for the same reason — the bridge
// exists to serve that server's owner and already holds a Tautulli API key over the
// same data, so owning the server is at least as strong as knowing the panel password.
//
// A user merely SHARED with the server is refused: access is not ownership.
export default defineEventHandler(async (event): Promise<AuthStatus> => {
  const body = await readBody<{ id?: string }>(event)
  const id = String(body?.id || '').trim()
  if (!id) throw createError({ statusCode: 400, statusMessage: 'pin id required' })

  const token = await pollPinLogin(getPlexClientId(), id)
  // Still unapproved. Not an error — the client polls until it flips.
  if (!token) return { authenticated: false, username: null, needsSetup: countUsers() === 0 }

  const account = await getPlexAccount(token)
  if (!account.id) throw createError({ statusCode: 502, statusMessage: 'Plex returned no account id' })

  // First run: no account, and no Tautulli connection either (that page is behind the
  // login), so there is no server to check ownership against. Whoever reaches a
  // brand-new bridge first claims it — exactly what register.post.ts already allows,
  // and this route at least proves control of a real Plex account and records which.
  if (countUsers() === 0) {
    const created = createUserFromPlex(account.username || 'plex', account)
    setSessionCookie(event, created.id)
    return { authenticated: true, username: created.username, needsSetup: false }
  }

  const s = getSettings()
  if (!s.tautulli_url || !s.tautulli_apikey)
    throw createError({
      statusCode: 403,
      statusMessage: 'Plex sign-in needs the Tautulli connection to know which server to check. Sign in with your password.',
    })

  let owned = false
  try {
    const { machineId } = await getPlexServer(s.tautulli_url, s.tautulli_apikey)
    const resource = await getPlexResource(token, getPlexClientId(), machineId)
    owned = !!resource?.owned
  } catch {
    throw createError({
      statusCode: 503,
      statusMessage: 'Could not reach Plex to verify the server. Sign in with your password.',
    })
  }

  if (!owned)
    throw createError({
      statusCode: 403,
      statusMessage: 'That Plex account does not own this Plex server, so it cannot sign in here.',
    })

  // Single-admin panel: the one account IS the admin, and ownership just proved this is
  // its operator. Stamp the account so Settings can show which Plex identity signs in.
  const user = firstUser()
  if (!user) throw createError({ statusCode: 500, statusMessage: 'No account to sign in as' })
  recordPlexAccount(user.id, account)

  setSessionCookie(event, user.id)
  return { authenticated: true, username: user.username, needsSetup: false }
})
