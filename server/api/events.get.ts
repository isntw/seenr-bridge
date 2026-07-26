import { listEvents, eventToWire } from '../utils/db'
import type { ScrobbleEvent } from '../../shared/types'

export default defineEventHandler((event): ScrobbleEvent[] => {
  const limit = Math.min(Math.max(Number(getQuery(event).limit) || 25, 1), 1000)
  return listEvents(limit).map(eventToWire)
})
