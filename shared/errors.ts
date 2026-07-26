// $fetch (ofetch) rejects with an object shaped like { data: { statusMessage } }
// for any H3 createError() thrown server-side. This is the one place that
// cast lives, instead of being duplicated at every catch block.
export function apiErrorMessage(e: unknown, fallback: string): string {
  const err = e as { data?: { statusMessage?: string } }
  return err?.data?.statusMessage || fallback
}
