import { listPushSubscriptions } from '../../../utils/db'
import type { PushDevice } from '../../../../shared/types'

export default defineEventHandler((): PushDevice[] =>
  listPushSubscriptions().map((s) => ({
    id: s.id,
    label: s.label,
    created: s.created,
    last_ok: s.last_ok,
    fail_count: s.fail_count,
  })),
)
