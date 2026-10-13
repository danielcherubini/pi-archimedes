/**
 * A tiny change bus for the VCS facts the footer displays (git status counts,
 * linked-worktree answer, jj bookmark and changed-file count).
 *
 * Those facts are refreshed in the background (`execFile`) so a render never
 * blocks, but a background reply has no way to say "the value you painted is
 * now wrong": pi draws a frame only when the host requests one, so the footer
 * would keep showing the stale number until unrelated activity repaints it.
 * The utils that own a cache publish here when a refresh actually changed the
 * visible value, and the footer subscribes and requests a render.
 *
 * Listeners are notified only on a *change* — a refresh that returns the same
 * value stays silent, otherwise the 2s cache TTL would drive a render every
 * two seconds forever.
 */

export type VcsChangeListener = () => void;

const listeners = new Set<VcsChangeListener>();

/** Subscribe to visible VCS changes. Returns an unsubscribe function. */
export function onVcsChange(listener: VcsChangeListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Tell subscribers the displayed VCS facts changed. Never throws. */
export function notifyVcsChange(): void {
  for (const listener of [...listeners]) {
    try {
      listener();
    } catch {
      /* a listener must not break the refresh callback that published */
    }
  }
}
