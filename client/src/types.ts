export interface Settings {
  tautulli_url: string;
  tautulli_apikey: string;
  seenr_base_url: string;
  forward_enabled: boolean;
}

export interface Mapping {
  id: number;
  username: string;
  seenr_token: string;
  enabled: boolean;
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
