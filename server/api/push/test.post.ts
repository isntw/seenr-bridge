import { sendToAll } from '../../utils/push'

export default defineEventHandler(async () => {
  const send = await sendToAll({
    title: 'Seenr Bridge',
    body: 'Notifications are working. This is a test.',
    url: '/dashboard',
    tag: 'seenr-bridge-test',
  })

  if (!send.sent && !send.failed && !send.pruned) {
    throw createError({ statusCode: 400, statusMessage: 'No devices are subscribed yet' })
  }
  return send
})
