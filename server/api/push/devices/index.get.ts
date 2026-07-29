import crypto from 'node:crypto'
import { listPushSubscriptions } from '../../../utils/db'
import type { PushDevice } from '../../../../shared/types'

export function fingerprint(endpoint: string): string {
  return crypto.createHash('sha256').update(endpoint).digest('hex').slice(0, 16)
}

export default defineEventHandler((): PushDevice[] =>
  listPushSubscriptions().map((s) => ({
    id: s.id,
    label: s.label,
    fingerprint: fingerprint(s.endpoint),
    created: s.created,
    last_ok: s.last_ok,
    fail_count: s.fail_count,
  })),
)
