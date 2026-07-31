import { deleteNotifyMute } from '../../../utils/db'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ subject_key?: string }>(event)

  const subject_key = String(body?.subject_key ?? '').trim()
  if (!subject_key) throw createError({ statusCode: 400, statusMessage: 'subject_key is required' })

  deleteNotifyMute(subject_key)
  return { ok: true }
})
