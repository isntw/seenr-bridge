import { Router } from 'express';
import {
  getSettings, saveSettings, listMappings, upsertMapping, deleteMapping,
  listEvents, getStats,
} from './db';
import { testConnection } from './tautulli';
import { processEvent } from './pipeline';

export const api = Router();

api.get('/health', (_req, res) => res.json({ ok: true }));

// ---- settings ----
api.get('/settings', (_req, res) => {
  const s = getSettings();
  res.json({ ...s, forward_enabled: !!s.forward_enabled });
});

api.put('/settings', (req, res) => {
  const b = req.body || {};
  const next = saveSettings({
    tautulli_url: typeof b.tautulli_url === 'string' ? b.tautulli_url.trim() : undefined,
    tautulli_apikey: typeof b.tautulli_apikey === 'string' ? b.tautulli_apikey.trim() : undefined,
    seenr_base_url: typeof b.seenr_base_url === 'string' ? b.seenr_base_url.trim() : undefined,
    forward_enabled: b.forward_enabled === undefined ? undefined : b.forward_enabled ? 1 : 0,
  });
  res.json({ ...next, forward_enabled: !!next.forward_enabled });
});

api.post('/settings/test-tautulli', async (req, res) => {
  const s = getSettings();
  const url = (req.body?.tautulli_url || s.tautulli_url || '').trim();
  const key = (req.body?.tautulli_apikey || s.tautulli_apikey || '').trim();
  if (!url || !key) return res.json({ ok: false, message: 'URL and API key required' });
  res.json(await testConnection(url, key));
});

// ---- mappings ----
api.get('/mappings', (_req, res) => res.json(listMappings().map((m) => ({ ...m, enabled: !!m.enabled }))));

api.post('/mappings', (req, res) => {
  const { username, seenr_token, enabled } = req.body || {};
  if (!username || !seenr_token) return res.status(400).json({ error: 'username and seenr_token required' });
  const m = upsertMapping(String(username).trim(), String(seenr_token).trim(), enabled === false ? 0 : 1);
  res.json({ ...m, enabled: !!m.enabled });
});

api.delete('/mappings/:id', (req, res) => {
  deleteMapping(Number(req.params.id));
  res.json({ ok: true });
});

// ---- events / stats ----
api.get('/events', (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 100, 500);
  res.json(listEvents(limit).map((e) => ({ ...e, ok: !!e.ok, ids: e.ids ? JSON.parse(e.ids) : [] })));
});

api.get('/stats', (_req, res) => res.json(getStats()));

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
