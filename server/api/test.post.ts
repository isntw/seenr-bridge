import { processEvent } from '../utils/pipeline'
import type { TestResult } from '../../shared/types'

export default defineEventHandler(async (event): Promise<TestResult> => {
  const b = await readBody<Record<string, unknown>>(event)
  const rating_key = b?.rating_key
  const username = b?.username

  if (!rating_key || !username) {
    throw createError({ statusCode: 400, statusMessage: 'rating_key and username required' })
  }

  const dryRun = !!b.dryRun
  return await processEvent(
    {
      action: String(b.action || 'watched'),
      rating_key: String(rating_key),
      username: String(username),
    },
    { dryRun, record: !dryRun },
  )
})
