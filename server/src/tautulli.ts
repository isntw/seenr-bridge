// Minimal Tautulli API client. Used to look up an item's REAL external IDs by
// rating_key — the piece the Tautulli webhook template cannot provide for episodes.

export interface TautulliMetadata {
  media_type: string;
  rating_key: string;
  title: string;
  grandparent_title: string;
  parent_media_index: string; // season number
  media_index: string; // episode number
  year: string | number;
  duration: string | number; // milliseconds
  guid: string; // plex://episode/... or plex://movie/...
  grandparent_guid: string;
  grandparent_rating_key: string; // the show's key (episodes) — used to count distinct series
  guids: string[]; // the item's OWN external ids: ["imdb://tt..","tmdb://..","tvdb://.."]
  thumb: string; // /library/metadata/<key>/thumb/<ts>
  grandparent_thumb: string; // show poster for episodes
}

function base(url: string): string {
  return url.replace(/\/+$/, '');
}

export async function getMetadata(url: string, apiKey: string, ratingKey: string): Promise<TautulliMetadata> {
  const u = `${base(url)}/api/v2?apikey=${encodeURIComponent(apiKey)}&cmd=get_metadata&rating_key=${encodeURIComponent(ratingKey)}`;
  const res = await fetch(u);
  if (!res.ok) throw new Error(`Tautulli HTTP ${res.status}`);
  const json = (await res.json()) as any;
  const data = json?.response?.data;
  if (!data || !data.rating_key) throw new Error('Tautulli returned no metadata for rating_key ' + ratingKey);
  return data as TautulliMetadata;
}

const WEBHOOK_AGENT_ID = 25;
const BRIDGE_FRIENDLY_NAME = 'Seenr Bridge';

// Generic Tautulli API call (POST form-encoded so long JSON bodies are safe).
async function tautulliApi(url: string, apiKey: string, cmd: string, params: Record<string, string> = {}): Promise<any> {
  const form = new URLSearchParams({ apikey: apiKey, cmd, ...params });
  const res = await fetch(`${base(url)}/api/v2`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
  });
  if (!res.ok) throw new Error(`Tautulli HTTP ${res.status}`);
  const json = (await res.json()) as any;
  if (json?.response?.result !== 'success') throw new Error(json?.response?.message || 'Tautulli API error');
  return json.response.data;
}

// Create (or update) a single Webhook notifier in Tautulli pointed at the bridge.
// No username condition → it fires for every user; the bridge routes by username.
export async function syncSeenrWebhook(
  url: string,
  apiKey: string,
  webhookUrl: string,
  opts: { triggers?: string[] } = {}
): Promise<{ notifier_id: number; created: boolean }> {
  const triggers = opts.triggers && opts.triggers.length ? opts.triggers : ['watched'];
  const notifiers = await tautulliApi(url, apiKey, 'get_notifiers');
  const existing = Array.isArray(notifiers)
    ? notifiers.find((n: any) => n.friendly_name === BRIDGE_FRIENDLY_NAME && n.agent_name === 'webhook')
    : undefined;

  let notifier_id: number;
  let created = false;
  if (existing) {
    notifier_id = Number(existing.id);
  } else {
    const added = await tautulliApi(url, apiKey, 'add_notifier_config', { agent_id: String(WEBHOOK_AGENT_ID) });
    notifier_id = Number(added?.notifier_id ?? added);
    if (!notifier_id) throw new Error('Failed to create notifier in Tautulli');
    created = true;
  }

  const jsonData = JSON.stringify({ action: '{action}', rating_key: '{rating_key}', username: '{username}' });
  const jsonHeaders = JSON.stringify({ 'Content-Type': 'application/json' });

  const params: Record<string, string> = {
    notifier_id: String(notifier_id),
    agent_id: String(WEBHOOK_AGENT_ID),
    friendly_name: BRIDGE_FRIENDLY_NAME,
    webhook_hook: webhookUrl,
    webhook_method: 'POST',
  };
  // Enable exactly the chosen triggers (0 disables, so re-syncing is authoritative);
  // populate body + headers for every action so any trigger works if enabled later.
  for (const a of ['play', 'stop', 'pause', 'resume', 'watched']) {
    params[`on_${a}`] = triggers.includes(a) ? '1' : '0';
    params[`on_${a}_body`] = jsonData;
    params[`on_${a}_subject`] = jsonHeaders;
  }

  await tautulliApi(url, apiKey, 'set_notifier_config', params);
  return { notifier_id, created };
}

// Proxy a Plex image (poster/thumb) through Tautulli so the API key stays server-side.
export async function fetchImage(
  url: string,
  apiKey: string,
  imgPath: string,
  width = 92,
  height = 138
): Promise<{ contentType: string; buffer: Buffer } | null> {
  const u = `${base(url)}/api/v2?apikey=${encodeURIComponent(apiKey)}&cmd=pms_image_proxy&img=${encodeURIComponent(imgPath)}&width=${width}&height=${height}&fallback=poster`;
  const res = await fetch(u);
  if (!res.ok) return null;
  const contentType = res.headers.get('content-type') || 'image/jpeg';
  if (!contentType.startsWith('image/')) return null;
  const buffer = Buffer.from(await res.arrayBuffer());
  return { contentType, buffer };
}

// Whether a "Seenr Bridge" webhook notifier already exists in Tautulli.
export async function bridgeWebhookExists(url: string, apiKey: string): Promise<boolean> {
  const notifiers = await tautulliApi(url, apiKey, 'get_notifiers');
  return Array.isArray(notifiers) && notifiers.some((n: any) => n.friendly_name === BRIDGE_FRIENDLY_NAME && n.agent_name === 'webhook');
}

// Pull the list of Plex users Tautulli knows about, so the UI can offer them as
// a dropdown instead of a free-text field. Skips the synthetic "Local" account.
export async function getUsers(url: string, apiKey: string): Promise<string[]> {
  const data = await tautulliApi(url, apiKey, 'get_users');
  if (!Array.isArray(data)) return [];
  const names = data
    .map((u: any) => String(u?.username || '').trim())
    .filter((name: string) => name && name.toLowerCase() !== 'local');
  return Array.from(new Set(names)).sort((a, b) => a.localeCompare(b));
}

export async function testConnection(url: string, apiKey: string): Promise<{ ok: boolean; message: string }> {
  try {
    const u = `${base(url)}/api/v2?apikey=${encodeURIComponent(apiKey)}&cmd=get_server_info`;
    const res = await fetch(u);
    if (!res.ok) return { ok: false, message: `HTTP ${res.status}` };
    const json = (await res.json()) as any;
    const name = json?.response?.data?.pms_name;
    if (json?.response?.result === 'success') return { ok: true, message: `Connected to "${name || 'Plex'}"` };
    return { ok: false, message: json?.response?.message || 'Unexpected response' };
  } catch (e: any) {
    return { ok: false, message: e?.message || String(e) };
  }
}
