import { getSettings, getMappingByUsername, insertEvent } from './db';
import { getMetadata } from './tautulli';
import { buildPayload } from './scrobble';
import { forwardToSeenr } from './seenr';

export interface IncomingEvent {
  action: string;
  rating_key: string;
  username: string;
}

export interface ProcessResult {
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

// Full pipeline: enrich a Tautulli event with the item's real IDs and forward to seenr.
// When dryRun is true the payload is built but not sent (used by the "preview" test).
export async function processEvent(input: IncomingEvent, opts: { dryRun?: boolean; record?: boolean } = {}): Promise<ProcessResult> {
  const record = opts.record !== false;
  const settings = getSettings();
  const now = Date.now();

  const fail = (reason: string, extra: Partial<ProcessResult> = {}): ProcessResult => {
    if (record)
      insertEvent({
        ts: now, action: input.action, event: extra.event ?? null as any, username: input.username,
        media_type: extra.media_type ?? null as any, title: extra.title ?? null as any, rating_key: input.rating_key,
        ids: extra.ids ? JSON.stringify(extra.ids) : null, seenr_status: extra.seenr_status ?? null,
        ok: 0, error: reason, payload: extra.payload ? JSON.stringify(extra.payload) : null,
      });
    return { ok: false, reason, ...extra };
  };

  if (!settings.tautulli_url || !settings.tautulli_apikey)
    return fail('Tautulli connection not configured');

  const mapping = getMappingByUsername(input.username);
  if (!mapping)
    return { ok: false, skipped: true, reason: `No seenr mapping for user "${input.username}"` };
  if (!mapping.enabled)
    return { ok: false, skipped: true, reason: `Mapping for "${input.username}" is disabled` };

  let meta;
  try {
    meta = await getMetadata(settings.tautulli_url, settings.tautulli_apikey, input.rating_key);
  } catch (e: any) {
    return fail(`Metadata lookup failed: ${e?.message || e}`);
  }

  const built = buildPayload(meta, input.action, input.username);
  const common = { event: built.event, ids: built.ids, title: built.title, media_type: meta.media_type, payload: built.payload };

  if (opts.dryRun) return { ok: true, ...common };

  if (!settings.forward_enabled)
    return fail('Forwarding is disabled in settings', common);

  let status: number, respBody: string;
  try {
    const r = await forwardToSeenr(settings.seenr_base_url, mapping.seenr_token, built.payload);
    status = r.status; respBody = r.body;
  } catch (e: any) {
    return fail(`Forward to seenr failed: ${e?.message || e}`, common);
  }

  const ok = status >= 200 && status < 300;
  if (record)
    insertEvent({
      ts: now, action: input.action, event: built.event, username: input.username, media_type: meta.media_type,
      title: built.title, rating_key: input.rating_key, ids: JSON.stringify(built.ids), seenr_status: status,
      ok: ok ? 1 : 0, error: ok ? null : `seenr HTTP ${status} ${respBody?.slice(0, 200)}`.trim(),
      payload: JSON.stringify(built.payload),
    });

  return { ok, seenr_status: status, ...common };
}
