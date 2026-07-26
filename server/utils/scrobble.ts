import type { TautulliMetadata } from '../../shared/types'

// Map a Tautulli notify action to the Plex webhook event name seenr expects.
export function mapEvent(action: string): string {
  const a = (action || '').toLowerCase().replace(/^on_/, '')
  switch (a) {
    case 'play': return 'media.play'
    case 'resume': return 'media.resume'
    case 'pause': return 'media.pause'
    case 'stop': return 'media.stop'
    case 'watched':
    case 'scrobble': return 'media.scrobble'
    default: return 'media.scrobble'
  }
}

export interface BuiltPayload {
  event: string
  ids: string[]
  title: string
  payload: Record<string, unknown>
}

// Build a Plex `media.scrobble`-style payload using the item's OWN external
// IDs. For episodes, m.guids are the episode's real tmdb/tvdb/imdb ids —
// exactly what the Tautulli webhook template cannot provide.
export function buildPayload(
  m: TautulliMetadata,
  action: string,
  username: string,
): BuiltPayload {
  const event = mapEvent(action)
  const isEpisode = m.media_type === 'episode'
  const ids = Array.isArray(m.guids) ? m.guids : []

  const metadata: Record<string, unknown> = {
    type: m.media_type,
    title: m.title,
    year: String(m.year ?? ''),
    duration: String(m.duration ?? ''),
    guid: m.guid,
    Guid: ids.map((id) => ({ id })),
  }

  if (isEpisode) {
    metadata.grandparentTitle = m.grandparent_title
    metadata.grandparentGuid = m.grandparent_guid
    metadata.parentIndex = String(m.parent_media_index ?? '')
    metadata.index = String(m.media_index ?? '')
  }

  const payload = {
    event,
    user: true,
    owner: true,
    Account: { title: username },
    Metadata: metadata,
  }

  return { event, ids, title: m.title, payload }
}
