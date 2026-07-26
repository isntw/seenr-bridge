import { upsertMapping, mappingToWire } from '../../utils/db'
import type { Mapping } from '../../../shared/types'

export default defineEventHandler(async (event): Promise<Mapping> => {
  const b = await readBody<Record<string, unknown>>(event)
  const username = String(b?.username || '').trim()
  const token = String(b?.seenr_token || '').trim()

  if (!username || !token) {
    throw createError({ statusCode: 400, statusMessage: 'username and seenr_token required' })
  }

  return mappingToWire(
    upsertMapping(
      username,
      token,
      b.enabled === false ? 0 : 1,
      b.sync_movies === false ? 0 : 1,
      b.sync_episodes === false ? 0 : 1,
    ),
  )
})
