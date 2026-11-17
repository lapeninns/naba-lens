/**
 * Set (client-side) by earlier app versions once a starter had left the
 * welcome screen. It is no longer written; a browser that still has it counts
 * as dismissed, so people who already saw the welcome are not shown it again.
 */
export const FIRST_RUN_COOKIE = "nl_first_run"

/**
 * Whether Home offers Start here. Only someone who has not dismissed the
 * welcome (in the database or, before that, by cookie) and has no photos of
 * their own yet sees it. It is an offer: Home never redirects to the welcome.
 */
export function showWelcomeEntry({
  dismissedAt,
  legacyCookie,
  hasOwnMedia,
}: {
  /** `staff_work_profiles.welcome_dismissed_at`, null when never dismissed. */
  dismissedAt: string | null | undefined
  /** The old `nl_first_run` cookie is present. */
  legacyCookie: boolean
  /** Any own photo or video (unknown counts as true, so the card stays away). */
  hasOwnMedia: boolean
}): boolean {
  return !dismissedAt && !legacyCookie && !hasOwnMedia
}
