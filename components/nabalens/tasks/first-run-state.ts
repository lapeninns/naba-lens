import type { MyTasksView } from "./types"

/** Set (client-side) once a new starter has left the first-run screen. */
export const FIRST_RUN_COOKIE = "nl_first_run"

/**
 * A starter who has not sent or been reviewed on anything this month. Home
 * uses it, with the cookie, to offer the first-run screen; it never redirects.
 */
export function isNewStarter(tasks: MyTasksView): boolean {
  const { monthly } = tasks
  return (
    !monthly ||
    monthly.accepted + monthly.pending + monthly.needsAnotherPhoto === 0
  )
}
