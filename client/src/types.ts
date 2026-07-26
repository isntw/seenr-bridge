export interface Settings {
  tautulli_url: string;
  tautulli_apikey: string;
  seenr_base_url: string;
  forward_enabled: boolean;
  bridge_url: string;
  sync_movies: boolean;
  sync_episodes: boolean;
}

export interface Status {
  tautulli: { ok: boolean; message: string };
  webhook: boolean;
  users: number;
}

export interface AuthStatus {
  authenticated: boolean;
  username: string | null;
  needsSetup: boolean;
}

export interface SyncResult {
  ok: boolean;
  webhookUrl?: string;
  notifier_id?: number;
  created?: boolean;
  error?: string;
}

export interface Mapping {
  id: number;
  username: string;
  seenr_token: string;
  enabled: boolean;
  sync_movies: boolean;
  sync_episodes: boolean;
}

export interface EventRow {
  id: number;
  ts: number;
  action: string | null;
  event: string | null;
  username: string | null;
  media_type: string | null;
  title: string | null;
  rating_key: string | null;
  ids: string[];
  image: string | null;
  seenr_status: number | null;
  ok: boolean;
  error: string | null;
  payload: string | null;
}

export interface Stats {
  total: number;
  ok: number;
  failed: number;
  last: number | null;
  episodes: number;
  movies: number;
  users: number;
}

export interface LibraryItem {
  rating_key: string;
  title: string;
  year: string;
  media_type: string; // 'show' | 'movie'
  image: string;
}

export interface SharedTitle {
  rating_key: string;
  media_type: string;
  title: string | null;
  year: string | null;
  image: string | null;
  profiles: number[]; // mapping ids
}

export interface BackfillResult {
  ok: boolean;
  reason?: string;
  media_type?: string;
  title?: string;
  items: number;
  profiles: number;
  delivered: number;
  ok_count: number;
  fail_count: number;
}

export interface TestResult {
  ok: boolean;
  skipped?: boolean;
  reason?: string;
  event?: string;
  ids?: string[];
  title?: string;
  media_type?: string;
  seenr_status?: number;
  payload?: Record<string, unknown>;
}
