// No fetch handler on purpose — caching a live dashboard would serve stale data.
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))
