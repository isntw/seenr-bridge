import { getPlexClientId, saveSettings } from '../../../utils/db'
import { pollPinLogin, resetPlexTokenCache } from '../../../utils/plex'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'pin id required' })

  const token = await pollPinLogin(getPlexClientId(), id)
  if (!token) return { pending: true }

  // Saved server-side and NEVER returned to the browser: the settings PUT can carry
  // a token when an operator pastes one, but there is no reason to ship this one out.
  saveSettings({ plex_token: token })
  // A new account means the cached per-user tokens belong to the old one.
  resetPlexTokenCache()
  return { pending: false }
})
