import { listMappings, mappingToWire } from '../../utils/db'
import type { Mapping } from '../../../shared/types'

export default defineEventHandler((): Mapping[] => listMappings().map(mappingToWire))
