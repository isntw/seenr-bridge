import { getStats } from '../utils/db'
import type { Stats } from '../../shared/types'

export default defineEventHandler((): Stats => getStats())
