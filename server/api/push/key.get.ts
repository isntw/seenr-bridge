import { vapidPublicKey } from '../../utils/push'

export default defineEventHandler(() => ({ key: vapidPublicKey() }))
