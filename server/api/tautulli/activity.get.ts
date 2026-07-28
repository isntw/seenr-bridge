import { getSettings } from '../../utils/db'
import { getActivity } from '../../utils/tautulli'
import type { ActivitySession } from '../../../shared/types'

// Polled by the Dashboard while it is open. An unconfigured or unreachable Tautulli
// yields [] rather than an error: the card is an extra on a page that must keep
// rendering its history, and a 500 here would break the whole Dashboard fetch.
export default defineEventHandler(async (): Promise<ActivitySession[]> => {
  const s = getSettings()
  if (!s.tautulli_url || !s.tautulli_apikey) return []
  try {
    return await getActivity(s.tautulli_url, s.tautulli_apikey)
  } catch {
    return []
  }
})
