import { saveSettings } from '../../utils/db'
import { resetPlexTokenCache } from '../../utils/plex'

// Forget the linked Plex account. Its own endpoint rather than a settings PUT with an
// empty string, because the in-memory per-user token cache must be dropped in the same
// breath — otherwise the bridge keeps writing to Plex with tokens discovered under an
// account the operator has just disconnected.
//
// Shares keep their plex_sync flag: disconnecting is "stop acting for now", not "undo
// what I configured", and re-linking should not mean re-ticking every title.
export default defineEventHandler(() => {
  saveSettings({ plex_token: '' })
  resetPlexTokenCache()
  return { ok: true }
})
