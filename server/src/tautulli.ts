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
  guids: string[]; // the item's OWN external ids: ["imdb://tt..","tmdb://..","tvdb://.."]
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
