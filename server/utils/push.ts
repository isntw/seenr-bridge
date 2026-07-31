import webpush from 'web-push'
import {
  deletePushSubscription,
  getVapidKeys,
  listPushSubscriptions,
  markPushFailed,
  markPushOk,
  setVapidKeys,
  type PushSubscriptionRow,
} from './db'

const VAPID_SUBJECT = 'https://github.com/isntw/seenr-bridge'

export interface PushPayload {
  title: string
  body: string
  url: string
  tag: string
  /**
   * Signed 16:9 art for the notification's wide image row; '' when there is none.
   * There is no `icon`: that slot is square and the platform stretches what it is
   * given, so the app icon stays there — see wideArt() in notify.ts.
   */
  image?: string
  /** Present when the notification offers a mute action; absent on the test push. */
  mute?: { subject_key: string; title: string; media_type: string }
}

export function ensureVapidKeys(): { publicKey: string; privateKey: string } {
  const existing = getVapidKeys()
  if (existing.publicKey && existing.privateKey) return existing

  const fresh = webpush.generateVAPIDKeys()
  setVapidKeys(fresh.publicKey, fresh.privateKey)
  return fresh
}

export interface SendResult {
  sent: number
  failed: number
  pruned: number
}

export async function sendToAll(payload: PushPayload): Promise<SendResult> {
  const subs = listPushSubscriptions()
  if (!subs.length) return { sent: 0, failed: 0, pruned: 0 }

  const { publicKey, privateKey } = ensureVapidKeys()
  webpush.setVapidDetails(VAPID_SUBJECT, publicKey, privateKey)

  const body = JSON.stringify(payload)
  let sent = 0
  let failed = 0
  let pruned = 0

  await Promise.all(
    subs.map(async (s: PushSubscriptionRow) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          body,
        )
        markPushOk(s.id)
        sent++
      } catch (e) {
        const err = e as { statusCode?: number; body?: string; message?: string }
        if (err.statusCode === 404 || err.statusCode === 410) {
          deletePushSubscription(s.id)
          pruned++
        } else {
          console.error('[push] delivery failed', {
            id: s.id,
            label: s.label,
            statusCode: err.statusCode,
            body: err.body?.slice(0, 300),
            message: err.message,
          })
          markPushFailed(s.id)
          failed++
        }
      }
    }),
  )

  return { sent, failed, pruned }
}
