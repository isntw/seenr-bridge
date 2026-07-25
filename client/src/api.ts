import type { Settings, Mapping, EventRow, Stats, TestResult, SyncResult, Status, AuthStatus } from './types';

async function req<T>(url: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    let msg = t;
    try {
      msg = JSON.parse(t).error || t;
    } catch {
      /* not json */
    }
    const err = new Error(msg || `HTTP ${res.status}`);
    (err as any).status = res.status;
    throw err;
  }
  return res.json() as Promise<T>;
}

export const api = {
  getSettings: () => req<Settings>('/api/settings'),
  saveSettings: (s: Partial<Settings>) => req<Settings>('/api/settings', { method: 'PUT', body: JSON.stringify(s) }),
  testTautulli: (s?: Partial<Settings>) =>
    req<{ ok: boolean; message: string }>('/api/settings/test-tautulli', { method: 'POST', body: JSON.stringify(s || {}) }),

  getMappings: () => req<Mapping[]>('/api/mappings'),
  saveMapping: (m: { username: string; seenr_token: string; enabled: boolean; sync_movies?: boolean; sync_episodes?: boolean }) =>
    req<Mapping>('/api/mappings', { method: 'POST', body: JSON.stringify(m) }),
  deleteMapping: (id: number) => req<{ ok: boolean }>(`/api/mappings/${id}`, { method: 'DELETE' }),

  getEvents: (limit = 100) => req<EventRow[]>(`/api/events?limit=${limit}`),
  getStats: () => req<Stats>('/api/stats'),
  getStatus: () => req<Status>('/api/status'),

  getVersion: () => req<{ version: string }>('/api/version'),
  authStatus: () => req<AuthStatus>('/api/auth/status'),
  login: (username: string, password: string) =>
    req<AuthStatus>('/api/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) }),
  register: (username: string, password: string) =>
    req<AuthStatus>('/api/auth/register', { method: 'POST', body: JSON.stringify({ username, password }) }),
  logout: () => req<{ ok: boolean }>('/api/auth/logout', { method: 'POST' }),
  changePassword: (current_password: string, new_password: string) =>
    req<{ ok: boolean }>('/api/auth/change-password', { method: 'POST', body: JSON.stringify({ current_password, new_password }) }),

  test: (body: { rating_key: string; username: string; action?: string; dryRun?: boolean }) =>
    req<TestResult>('/api/test', { method: 'POST', body: JSON.stringify(body) }),

  syncWebhook: (triggers: string[]) =>
    req<SyncResult>('/api/tautulli/sync-webhook', { method: 'POST', body: JSON.stringify({ triggers }) }),
};
