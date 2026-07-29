import { ensureVapidKeys } from '../../utils/push'

export default defineEventHandler(() => ({ key: ensureVapidKeys().publicKey }))
