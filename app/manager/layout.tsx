import { ManagerShell } from "@/components/nabalens/manager/manager-shell"
import { VenueAccessUnavailablePage } from "@/components/nabalens/manager/venue-access-unavailable"
import { SessionGuardHost } from "@/components/nabalens/session-guard-host"
import { getLoginCaptchaConfig } from "@/lib/auth/captcha"
import { getManagerWorkspace } from "@/lib/auth/manager"
import { knowledgeServices } from "@/lib/knowledge-client/services"
import { getAmenityActor } from "@/lib/server/amenities"

import { loadManagerOverview } from "./load-overview"

/**
 * Early gate for /manager: non-manager accounts are redirected to their own
 * home, and a manager without an effective venue grant sees Venue access
 * unavailable with no nav. Not the authorisation boundary (layouts do not
 * re-render on client navigation, and pages render regardless): every page
 * and Server Function checks the workspace again. The Review badge is the
 * overview's `pendingPhotos`; when that read fails the badge is left out and
 * the page shows the failure. An ended session is met in place (Sign in
 * again over the page) rather than by losing the page.
 */
/** Amenity findings waiting for this manager; undefined when unreadable. */
async function confirmCount(): Promise<number | undefined> {
  try {
    const auth = await getAmenityActor()
    if (!auth.ok) return undefined
    const result = await knowledgeServices.listToConfirm(auth.actor, {})
    return result.ok ? result.view.count : undefined
  } catch {
    return undefined
  }
}

export default async function ManagerLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const workspace = await getManagerWorkspace()
  if (workspace.status !== "available") {
    return <VenueAccessUnavailablePage reason={workspace.reason} />
  }
  const [read, toConfirm] = await Promise.all([
    loadManagerOverview().catch(() => null),
    confirmCount(),
  ])
  const captcha = getLoginCaptchaConfig()
  return (
    <SessionGuardHost
      captchaRequired={captcha.enabled}
      captchaSiteKey={captcha.siteKey}
    >
      <ManagerShell
        venueName={workspace.venue.name}
        userName={workspace.profile.displayName}
        reviewCount={read?.ok ? read.overview.pendingPhotos : undefined}
        confirmCount={toConfirm}
      >
        {children}
      </ManagerShell>
    </SessionGuardHost>
  )
}
