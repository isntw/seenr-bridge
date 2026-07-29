export function safeRedirect(raw: unknown): string {
  const r = typeof raw === 'string' ? raw : ''
  if (!r.startsWith('/') || r.startsWith('//')) return '/dashboard'
  if (r === '/login' || r.startsWith('/login?')) return '/dashboard'
  return r
}
