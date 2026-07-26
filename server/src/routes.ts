import { Router } from 'express';
import {
  getSettings, saveSettings, listMappings, upsertMapping, deleteMapping,
  listEvents, getStats, listSharedTitles, setSharedTitle,
} from './db';
import { testConnection, syncSeenrWebhook, fetchImage, bridgeWebhookExists, getUsers, getLibraryItems } from './tautulli';
import { processEvent, backfillSharedTitle } from './pipeline';
import { requireAuth } from './auth';
import { VERSION } from './version';

export const api = Router();

// The Tautulli webhook, health check, and version are public (Tautulli posts without a
// session, and the version shows on the login screen); everything else requires a login.
const PUBLIC_PATHS = new Set(['/health', '/webhook/tautulli', '/version']);
api.use((req, res, next) => (PUBLIC_PATHS.has(req.path) ? next() : requireAuth(req, res, next)));

api.get('/health', (_req, res) => res.json({ ok: true, version: VERSION }));
api.get('/version', (_req, res) => res.json({ version: VERSION }));

// ---- settings ----
const settingsToJson = (s: ReturnType<typeof getSettings>) => ({
  ...s,
  forward_enabled: !!s.forward_enabled,
  sync_movies: !!s.sync_movies,
  sync_episodes: !!s.sync_episodes,
});

api.get('/settings', (_req, res) => res.json(settingsToJson(getSettings())));

// Readiness summary for the setup page's status line.
api.get('/status', async (_req, res) => {
  const s = getSettings();
  const configured = !!(s.tautulli_url && s.tautulli_apikey);
  const tautulli = configured ? await testConnection(s.tautulli_url, s.tautulli_apikey) : { ok: false, message: 'not configured' };
  let webhook = false;
  if (tautulli.ok) {
    try {
      webhook = await bridgeWebhookExists(s.tautulli_url, s.tautulli_apikey);
    } catch {
      webhook = false;
    }
  }
  res.json({ tautulli, webhook, users: listMappings().length });
});

api.put('/settings', (req, res) => {
  const b = req.body || {};
  const next = saveSettings({
    tautulli_url: typeof b.tautulli_url === 'string' ? b.tautulli_url.trim() : undefined,
    tautulli_apikey: typeof b.tautulli_apikey === 'string' ? b.tautulli_apikey.trim() : undefined,
    seenr_base_url: typeof b.seenr_base_url === 'string' ? b.seenr_base_url.trim() : undefined,
    forward_enabled: b.forward_enabled === undefined ? undefined : b.forward_enabled ? 1 : 0,
    bridge_url: typeof b.bridge_url === 'string' ? b.bridge_url.trim() : undefined,
    sync_movies: b.sync_movies === undefined ? undefined : b.sync_movies ? 1 : 0,
    sync_episodes: b.sync_episodes === undefined ? undefined : b.sync_episodes ? 1 : 0,
  });
  res.json(settingsToJson(next));
});

api.post('/settings/test-tautulli', async (req, res) => {
  const s = getSettings();
  const url = (req.body?.tautulli_url || s.tautulli_url || '').trim();
  const key = (req.body?.tautulli_apikey || s.tautulli_apikey || '').trim();
  if (!url || !key) return res.json({ ok: false, message: 'URL and API key required' });
  res.json(await testConnection(url, key));
});

// The Plex users Tautulli knows about — used to populate the username dropdown.
api.get('/tautulli/users', async (_req, res) => {
  const s = getSettings();
  if (!s.tautulli_url || !s.tautulli_apikey) return res.json({ ok: false, users: [] });
  try {
    res.json({ ok: true, users: await getUsers(s.tautulli_url, s.tautulli_apikey) });
  } catch (e: any) {
    res.json({ ok: false, users: [], error: e?.message || String(e) });
  }
});

// Create/update the single Webhook notifier in Tautulli, pointed back at this bridge.
api.post('/tautulli/sync-webhook', async (req, res) => {
  const s = getSettings();
  if (!s.tautulli_url || !s.tautulli_apikey) return res.status(400).json({ ok: false, error: 'Configure and save the Tautulli connection first.' });

  let baseUrl = (s.bridge_url || '').trim().replace(/\/+$/, '');
  if (!baseUrl) {
    const proto = (req.headers['x-forwarded-proto'] as string) || req.protocol;
    baseUrl = `${proto}://${req.get('host')}`;
  }
  const webhookUrl = `${baseUrl}/api/webhook/tautulli`;

  try {
    const triggers = Array.isArray(req.body?.triggers) ? req.body.triggers.filter((t: any) => typeof t === 'string') : undefined;
    const r = await syncSeenrWebhook(s.tautulli_url, s.tautulli_apikey, webhookUrl, { triggers });
    res.json({ ok: true, webhookUrl, ...r });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: e?.message || String(e), webhookUrl });
  }
});

// ---- mappings ----
const mappingToJson = (m: ReturnType<typeof upsertMapping>) => ({
  ...m,
  enabled: !!m.enabled,
  sync_movies: !!m.sync_movies,
  sync_episodes: !!m.sync_episodes,
});

api.get('/mappings', (_req, res) => res.json(listMappings().map(mappingToJson)));

api.post('/mappings', (req, res) => {
  const { username, seenr_token, enabled, sync_movies, sync_episodes } = req.body || {};
  if (!username || !seenr_token) return res.status(400).json({ error: 'username and seenr_token required' });
  const m = upsertMapping(
    String(username).trim(),
    String(seenr_token).trim(),
    enabled === false ? 0 : 1,
    sync_movies === false ? 0 : 1,
    sync_episodes === false ? 0 : 1
  );
  res.json(mappingToJson(m));
});

api.delete('/mappings/:id', (req, res) => {
  deleteMapping(Number(req.params.id));
  res.json({ ok: true });
});

// ---- library browse + shared (co-watched) titles ----
api.get('/tautulli/library', async (req, res) => {
  const s = getSettings();
  if (!s.tautulli_url || !s.tautulli_apikey) return res.json({ ok: false, items: [], total: 0 });
  const type = req.query.type === 'movie' ? 'movie' : 'show';
  try {
    const r = await getLibraryItems(s.tautulli_url, s.tautulli_apikey, {
      type,
      search: typeof req.query.search === 'string' ? req.query.search : '',
      start: Number(req.query.start) || 0,
      length: Math.min(Number(req.query.length) || 50, 200),
    });
    res.json({ ok: true, ...r });
  } catch (e: any) {
    res.json({ ok: false, items: [], total: 0, error: e?.message || String(e) });
  }
});

api.get('/shared', (_req, res) => res.json(listSharedTitles()));

api.put('/shared', (req, res) => {
  const b = req.body || {};
  if (!b.rating_key || !b.media_type) return res.status(400).json({ error: 'rating_key and media_type required' });
  const profiles = Array.isArray(b.profiles) ? b.profiles.map((n: any) => Number(n)).filter((n: number) => Number.isInteger(n)) : [];
  setSharedTitle(
    { rating_key: String(b.rating_key), media_type: String(b.media_type), title: b.title, year: b.year, image: b.image },
    profiles
  );
  res.json({ ok: true, profiles });
});

api.post('/shared/:rating_key/backfill', async (req, res) => {
  try {
    res.json(await backfillSharedTitle(String(req.params.rating_key)));
  } catch (e: any) {
    res.status(500).json({ ok: false, reason: e?.message || String(e) });
  }
});

// ---- events / stats ----
api.get('/events', (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 25, 1000);
  res.json(listEvents(limit).map((e) => ({ ...e, ok: !!e.ok, ids: e.ids ? JSON.parse(e.ids) : [] })));
});

api.get('/stats', (_req, res) => res.json(getStats()));

// Proxy poster/thumb art from Tautulli (keeps the API key server-side).
api.get('/image', async (req, res) => {
  const path = String(req.query.path || '');
  if (!path.startsWith('/library/metadata/')) return res.status(400).end();
  const s = getSettings();
  if (!s.tautulli_url || !s.tautulli_apikey) return res.status(404).end();
  try {
    const img = await fetchImage(s.tautulli_url, s.tautulli_apikey, path);
    if (!img) return res.status(404).end();
    res.setHeader('Content-Type', img.contentType);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    return res.end(img.buffer);
  } catch {
    return res.status(502).end();
  }
});

// ---- test scrobble (preview builds payload; send actually forwards) ----
api.post('/test', async (req, res) => {
  const { rating_key, username, action, dryRun } = req.body || {};
  if (!rating_key || !username) return res.status(400).json({ error: 'rating_key and username required' });
  const result = await processEvent(
    { action: action || 'watched', rating_key: String(rating_key), username: String(username) },
    { dryRun: !!dryRun, record: !dryRun }
  );
  res.json(result);
});

// ---- the webhook Tautulli posts to ----
api.post('/webhook/tautulli', async (req, res) => {
  const b = req.body || {};
  const rating_key = b.rating_key ?? b.ratingKey;
  const username = b.username ?? b.user;
  const action = b.action ?? b.notify_action ?? 'watched';
  if (!rating_key || !username) {
    return res.status(400).json({ error: 'Missing rating_key or username in webhook payload', received: b });
  }
  // Respond fast; process in the background so Tautulli never waits.
  res.status(202).json({ accepted: true });
  processEvent({ action: String(action), rating_key: String(rating_key), username: String(username) }).catch(() => {});
});
