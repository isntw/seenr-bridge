import { listSharedTitles } from '../../utils/db'
import type { SharedTitle } from '../../../shared/types'

export default defineEventHandler((): SharedTitle[] => listSharedTitles())
