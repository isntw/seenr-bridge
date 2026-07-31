/**
 * Whether the running service worker should be replaced.
 *
 * Extracted so the decision is testable without a browser: the plugin around it is
 * all platform API. An empty `reported` means the worker never answered, which is
 * what a worker predating the version handler does — and that is precisely the case
 * that must update, so it cannot be treated as "no answer, assume fine".
 */
export function workerNeedsUpdate(reported: string, appVersion: string): boolean {
  return reported !== appVersion
}
