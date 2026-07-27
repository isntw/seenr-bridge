import { listSharedTitles, setSharedTitleLibrary, getSettings } from '../../utils/db'
import { getMetadata } from '../../utils/tautulli'
import type { SharedTitle } from '../../../shared/types'

// Titles shared before shared_titles gained its library columns have none stored,
// and re-adding them by hand just to learn which library they came from would be a
// silly thing to ask. So look each unknown one up once, persist it, and serve the
// filled-in row — after which this loop finds nothing to do.
//
// Bounded on purpose: one Tautulli round-trip per still-unknown title, and a failure
// leaves the column NULL so the next request retries rather than caching a blank.
// A key Plex no longer resolves therefore stays NULL forever, which is correct — it
// has no library, and the UI says so.
async function backfillLibraries(titles: SharedTitle[]): Promise<void> {
  const missing = titles.filter((t) => !t.library_name)
  if (!missing.length) return

  const s = getSettings()
  if (!s.tautulli_url || !s.tautulli_apikey) return

  await Promise.all(
    missing.map(async (t) => {
      try {
        const meta = await getMetadata(s.tautulli_url, s.tautulli_apikey, t.rating_key)
        const section = meta.section_id != null ? String(meta.section_id) : ''
        if (!section || !meta.library_name) return
        setSharedTitleLibrary(t.rating_key, section, meta.library_name)
        t.section_id = section
        t.library_name = meta.library_name
      } catch {
        // Tautulli down or the key is gone — leave it NULL and try again next time.
      }
    }),
  )
}

export default defineEventHandler(async (): Promise<SharedTitle[]> => {
  const titles = listSharedTitles()
  await backfillLibraries(titles)
  return titles
})
