// A small centred window for plex.tv's sign-in, closed for the operator once the PIN is
// approved.
//
// The opener closes it, rather than plex.tv redirecting back to a page that closes
// itself: a script may close a window it opened even cross-origin, and that works
// wherever the bridge is reachable. A `forwardUrl` round trip would need plex.tv to be
// able to send the browser back to this bridge, which is a LAN address on most installs.
//
// The window is NAMED, so reopening — after an accidental close, or a popup blocker —
// reuses the same one instead of stacking duplicates.
const POPUP_NAME = 'seenr-bridge-plex'
const WIDTH = 620
const HEIGHT = 740

export interface PlexPopup {
  /** Bring the existing window forward, or open it if it is gone. */
  reopen: () => void
  close: () => void
  /** True when the operator closed it themselves — worth telling them why nothing is
   *  happening rather than polling silently to the deadline. */
  closedByUser: () => boolean
}

export function openPlexPopup(url: string): PlexPopup {
  let win: Window | null = null

  const open = () => {
    // Centre on the screen the browser is actually on, not the primary one.
    const dualLeft = window.screenLeft ?? window.screenX ?? 0
    const dualTop = window.screenTop ?? window.screenY ?? 0
    const w = window.outerWidth || document.documentElement.clientWidth || WIDTH
    const h = window.outerHeight || document.documentElement.clientHeight || HEIGHT
    const left = Math.max(0, dualLeft + (w - WIDTH) / 2)
    const top = Math.max(0, dualTop + (h - HEIGHT) / 2)

    win = window.open(
      url,
      POPUP_NAME,
      `popup=yes,width=${WIDTH},height=${HEIGHT},left=${Math.round(left)},top=${Math.round(top)}`,
    )
    win?.focus()
  }

  open()

  return {
    reopen: () => {
      // A live window just needs focus; a closed or blocked one needs opening again.
      if (win && !win.closed) win.focus()
      else open()
    },
    close: () => {
      try {
        if (win && !win.closed) win.close()
      } catch {
        // Nothing actionable: the sign-in already succeeded or failed on its own merits,
        // and a window we cannot close is a cosmetic problem, not a failure.
      }
      win = null
    },
    // `null` means a popup blocker stopped it — not something the operator closed, and
    // it is the reopen button's job to recover from that.
    closedByUser: () => !!win && win.closed,
  }
}
