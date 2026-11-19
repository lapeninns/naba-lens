/**
 * Staff Home names the check whose finding was just sent: the capture form
 * goes back to `/staff/home?finding_sent=<checkId>` and Today confirms the
 * check before it says so.
 */
export const FINDING_SENT_PARAM = "finding_sent"

/** Staff Home, the one page that reads the parameter. */
export const STAFF_HOME_PATH = "/staff/home"

/** `path` with the sent check added to its query. */
export function findingSentHref(path: string, checkId: string): string {
  const [base, hash = ""] = path.split("#", 2)
  const join = base.includes("?") ? "&" : "?"
  return `${base}${join}${FINDING_SENT_PARAM}=${encodeURIComponent(checkId)}${hash ? `#${hash}` : ""}`
}
