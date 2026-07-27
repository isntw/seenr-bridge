
export interface SharedTitlePayload {
  rating_key: string
  media_type: string
  title: string | null
  year: string | null
  image: string | null
  section_id?: string
  library_name?: string
  profiles: number[]
  syncPrevious: boolean
  plex_sync: boolean
}

export interface SharedRow {
  rating_key: string
  media_type: string
  title: string | null
  year: string | null
  image: string | null
  poster: string | null
  section_id: string | null
  library_name: string | null
  isShow: boolean
  profiles: number[]
  isShared: boolean
  plex_sync: boolean
}
