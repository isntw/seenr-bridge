import { listNotifyMutes } from '../../../utils/db'
import type { NotifyMute } from '../../../../shared/types'

export default defineEventHandler((): NotifyMute[] => listNotifyMutes())
