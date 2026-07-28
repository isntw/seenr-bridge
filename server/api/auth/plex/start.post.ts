import { getPlexClientId } from '../../../utils/db'
import { startPinLogin, plexAuthUrl } from '../../../utils/plex'

// PUBLIC — it has to be, since signing in happens before there is a session.
//
// Begins the Plex sign-in PIN flow. Creating a PIN grants nothing on its own: every
// authorisation decision lives in /api/auth/plex/poll.
export default defineEventHandler(async () => {
  const clientId = getPlexClientId()
  const pin = await startPinLogin(clientId)
  return { id: pin.id, code: pin.code, url: plexAuthUrl(clientId, pin.code) }
})
