import { deletePushSubscription } from '../../../utils/db'

export default defineEventHandler((event) => {
  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isInteger(id) || id <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid device id' })
  }

  deletePushSubscription(id)
  return { ok: true }
})
