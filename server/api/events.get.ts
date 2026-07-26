import { listEvents, eventToWire } from '../utils/db'
import type { ScrobbleEvent } from '../../shared/types'

export default defineEventHandler((event): ScrobbleEvent[] => {
  const limit = Math.min(Number(getQuery(event).limit) || 25, 1000)
  return listEvents(limit).map(eventToWire)
})
