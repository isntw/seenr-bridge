import { getSettings } from '../../utils/db'
import { getActivity } from '../../utils/tautulli'
import type { ActivitySession } from '../../../shared/types'

export default defineEventHandler(async (): Promise<ActivitySession[]> => {
  const s = getSettings()
  if (!s.tautulli_url || !s.tautulli_apikey) return []
  try {
    return await getActivity(s.tautulli_url, s.tautulli_apikey)
  } catch {
    return []
  }
})
