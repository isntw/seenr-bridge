import { getPlexClientId } from '../../utils/db'
import { startPinLogin, plexAuthUrl } from '../../utils/plex'

export default defineEventHandler(async () => {
  const clientId = getPlexClientId()
  const pin = await startPinLogin(clientId)
  return { id: pin.id, code: pin.code, url: plexAuthUrl(clientId, pin.code) }
})
