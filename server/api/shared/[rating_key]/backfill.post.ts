import { backfillSharedTitle } from '../../../utils/pipeline'
import type { BackfillResult } from '../../../../shared/types'

export default defineEventHandler(async (event): Promise<BackfillResult> => {
  const ratingKey = String(getRouterParam(event, 'rating_key') || '')
  if (!ratingKey) {
    throw createError({ statusCode: 400, statusMessage: 'rating_key required' })
  }

  try {
    return await backfillSharedTitle(ratingKey)
  } catch (e: unknown) {
    throw createError({
      statusCode: 500,
      statusMessage: e instanceof Error ? e.message : String(e),
    })
  }
})
