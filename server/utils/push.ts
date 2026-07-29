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

const VAPID_SUBJECT = 'mailto:seenr-bridge@localhost'

export interface PushPayload {
  title: string
  body: string
  url: string
  /** Collapses repeats of the same session instead of stacking them. */
  tag: string
}

export function ensureVapidKeys(): { publicKey: string; privateKey: string } {
  const existing = getVapidKeys()
  if (existing.publicKey && existing.privateKey) return existing

  const fresh = webpush.generateVAPIDKeys()
  setVapidKeys(fresh.publicKey, fresh.privateKey)
  return fresh
}

export function vapidPublicKey(): string {
  return ensureVapidKeys().publicKey
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
        // 404/410 means the endpoint is permanently gone: drop it, don't retry.
        const status = (e as { statusCode?: number }).statusCode
        if (status === 404 || status === 410) {
          deletePushSubscription(s.id)
          pruned++
        } else {
          markPushFailed(s.id)
          failed++
        }
      }
    }),
  )

  return { sent, failed, pruned }
}
