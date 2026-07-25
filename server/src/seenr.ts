// Forward a Plex-style scrobble payload to seenr, mimicking a Plex webhook:
// a form-urlencoded body with a single `payload` field holding the JSON.

function base(url: string): string {
  return url.replace(/\/+$/, '');
}

export async function forwardToSeenr(
  seenrBaseUrl: string,
  token: string,
  payload: Record<string, unknown>
): Promise<{ status: number; body: string }> {
  const url = `${base(seenrBaseUrl)}/${token}`;
  const body = new URLSearchParams({ payload: JSON.stringify(payload) }).toString();
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const text = await res.text().catch(() => '');
  return { status: res.status, body: text };
}
