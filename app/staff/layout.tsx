import { requireActiveStaff, uploadBlockReason } from "@/lib/auth"
import { SessionGuardHost } from "@/components/nabalens/session-guard-host"
import { getLoginCaptchaConfig } from "@/lib/auth/captcha"
import { contributionEntry } from "@/lib/config/contribution-entry"
import { getCoverageActor } from "@/lib/server/coverage"
import type { EntryMenu } from "@/lib/work-client/entry"

import { AddHost } from "./_shell/add-host"
import { myContributionEntry } from "./_shell/shell-status"

// Add is on every staff page, and its finaliseUpload Server Action decodes
// HEIC/images; keep the bound explicit and below
// MEDIA_LIMITS.staleProcessingMinutes.
export const maxDuration = 120

/** The shared entry's choices, never rejecting: null keeps today's Add. */
async function entryFor(venueName: string): Promise<EntryMenu | null> {
  try {
    const auth = await getCoverageActor()
    return auth.ok ? await myContributionEntry(auth.actor, venueName) : null
  } catch {
    return null
  }
}

/**
 * Early role gate for /staff: a real 307 for admins, inactive and profile-less
 * accounts before loading.tsx streams. Not the authorisation boundary (layouts
 * do not re-render on client navigation); the page and every Server Function
 * still call lib/auth. An ended session is met in place (Sign in again over
 * the page); the upload sheet keeps its own, which resumes the uploads.
 *
 * The shared entry's choices are read without holding the page back: Add
 * receives the read in flight and waits for it only when opened.
 */
export default async function StaffLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const profile = await requireActiveStaff()
  const reason = uploadBlockReason(profile)
  const blocked =
    reason === "venue_inactive" && profile.venue
      ? { reason: "venue_inactive" as const, venueName: profile.venue.name }
      : reason
        ? { reason: "no_venue" as const }
        : null
  const entry =
    !blocked && profile.venue && contributionEntry(profile.venueId) === "b02"
      ? entryFor(profile.venue.name)
      : null
  const captcha = getLoginCaptchaConfig()
  return (
    <SessionGuardHost
      captchaRequired={captcha.enabled}
      captchaSiteKey={captcha.siteKey}
    >
      <AddHost
        blocked={blocked}
        captchaRequired={captcha.enabled}
        captchaSiteKey={captcha.siteKey}
        entry={entry}
        venueName={profile.venue?.name ?? null}
      >
        {children}
      </AddHost>
    </SessionGuardHost>
  )
}
