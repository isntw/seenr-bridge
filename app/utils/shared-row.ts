// View model for one co-watched title on the Shared page. Kept out of
// `shared/types` on purpose: that file is the wire contract between `app/` and
// `server/`, and this is a client-side projection of `SharedTitle`.

/** What the add/edit modal hands back — a complete row for the /api/shared PUT,
 *  so the page has one write path for both modes. */
export interface SharedTitlePayload {
  rating_key: string
  media_type: string
  title: string | null
  year: string | null
  image: string | null
  /** Only the add flow knows these — it picked the title out of a named library.
   *  Editing sends neither, and the server keeps what it already has. */
  section_id?: string
  library_name?: string
  profiles: number[]
  /** Run the retroactive backfill after the share lands. */
  syncPrevious: boolean
}

export interface SharedRow {
  rating_key: string
  media_type: string
  title: string | null
  year: string | null
  /** Plex art path as Tautulli reports it, before proxying. */
  image: string | null
  /** `image` routed through /api/image, which proxies Plex art via Tautulli so
   *  the API key never reaches the browser. Null when the title has no art. */
  poster: string | null
  /** Null when unknown — either shared before the column existed and not yet
   *  backfilled, or a rating_key Tautulli can no longer resolve. */
  section_id: string | null
  library_name: string | null
  isShow: boolean
  /** Mapping ids this title is shared with. */
  profiles: number[]
  isShared: boolean
}
