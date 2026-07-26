import { getCookie } from 'h3'
import { SESSION_COOKIE, clearSession } from '../../utils/auth'
import { deleteSession } from '../../utils/db'

export default defineEventHandler((event) => {
  const token = getCookie(event, SESSION_COOKIE)
  if (token) deleteSession(token)
  clearSession(event)
  return { ok: true }
})
