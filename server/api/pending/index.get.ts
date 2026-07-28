import { listPendingWatches } from '../../utils/db'
import type { PendingWatchEntry } from '../../../shared/types'

export default defineEventHandler((): PendingWatchEntry[] => listPendingWatches())
