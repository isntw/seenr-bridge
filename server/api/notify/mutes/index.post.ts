import { addNotifyMute } from '../../../utils/db'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ subject_key?: string; title?: string; media_type?: string }>(event)

  const subject_key = String(body?.subject_key ?? '').trim()
  if (!subject_key) throw createError({ statusCode: 400, statusMessage: 'subject_key is required' })

  // The title only labels the Settings row, and this endpoint is also called by
  // the service worker from a payload that may predate a rename — a mute with an
  // ugly label beats one that failed.
  addNotifyMute(
    subject_key,
    String(body?.title ?? '').trim() || subject_key,
    String(body?.media_type ?? '').trim() || 'show',
  )

  return { ok: true }
})
