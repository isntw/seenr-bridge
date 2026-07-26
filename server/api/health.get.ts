import { VERSION } from '../../shared/version'
import { useDb } from '../utils/db'

export default defineEventHandler(() => {
  const db = useDb()
  const { n } = db.prepare('SELECT 1 AS n').get() as { n: number }
  return { ok: n === 1, version: VERSION }
})
