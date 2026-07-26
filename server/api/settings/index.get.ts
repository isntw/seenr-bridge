import { getSettings, settingsToWire } from '../../utils/db'
import type { Settings } from '../../../shared/types'

export default defineEventHandler((): Settings => settingsToWire(getSettings()))
