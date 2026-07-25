import type { Settings, Mapping, EventRow, Stats, TestResult } from './types';

async function req<T>(url: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(t || `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  getSettings: () => req<Settings>('/api/settings'),
  saveSettings: (s: Partial<Settings>) => req<Settings>('/api/settings', { method: 'PUT', body: JSON.stringify(s) }),
  testTautulli: (s?: Partial<Settings>) =>
    req<{ ok: boolean; message: string }>('/api/settings/test-tautulli', { method: 'POST', body: JSON.stringify(s || {}) }),

  getMappings: () => req<Mapping[]>('/api/mappings'),
  saveMapping: (m: { username: string; seenr_token: string; enabled: boolean }) =>
    req<Mapping>('/api/mappings', { method: 'POST', body: JSON.stringify(m) }),
  deleteMapping: (id: number) => req<{ ok: boolean }>(`/api/mappings/${id}`, { method: 'DELETE' }),

  getEvents: (limit = 100) => req<EventRow[]>(`/api/events?limit=${limit}`),
  getStats: () => req<Stats>('/api/stats'),

  test: (body: { rating_key: string; username: string; action?: string; dryRun?: boolean }) =>
    req<TestResult>('/api/test', { method: 'POST', body: JSON.stringify(body) }),
};
