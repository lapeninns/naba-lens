import type { Metadata } from "next"

import { AppShell } from "@/components/nabalens"
import { ERROR_COPY, ErrorState } from "@/components/nabalens/error-state"
import { PageHeader } from "@/components/nabalens/page-header"
import { requireActiveAdmin } from "@/lib/auth"
import { MEDIA_LIMITS } from "@/lib/config/media"
import { listAssignableVenues, listStaffDirectory } from "@/lib/server/accounts"
import { accountsContext } from "@/lib/server/accounts/request"

import { signOutAction } from "./actions"
import { AuthDetailsNotice } from "./auth-details-notice"
import { effectiveGrants, loadManagerGrants } from "./manager-grants"
import { RetryButton } from "./retry-button"
import { STAFF_SUMMARY } from "./copy"
import { StaffDirectory } from "./staff-directory"

export const metadata: Metadata = { title: "Staff · Naba-Lens" }

export default async function StaffDirectoryPage() {
  const admin = await requireActiveAdmin()
  const ctx = await accountsContext()
  const [directory, venues, grants] = await Promise.all([
    listStaffDirectory(ctx),
    listAssignableVenues(ctx),
    loadManagerGrants(),
  ])

  return (
    <AppShell
      variant="admin"
      active="staff"
      userName={admin.displayName}
      logoutAction={signOutAction}
    >
      {directory.ok && venues.ok ? (
        <StaffDirectory
          staff={directory.staff}
          venues={venues.venues}
          grants={effectiveGrants(grants)}
          maxAvatarBytes={MEDIA_LIMITS.maxAvatarBytes}
          notices={
            directory.authDetails === "unavailable" ? (
              <AuthDetailsNotice />
            ) : null
          }
        />
      ) : (
        <div className="grid gap-5">
          <PageHeader
            venueScope
            scope="All venues"
            title="Staff"
            summary={STAFF_SUMMARY}
            className="pb-0 md:pb-0"
          />
          <ErrorState
            title="We couldn't load the staff list"
            action={<RetryButton label={ERROR_COPY.tryAgain} />}
          >
            {ERROR_COPY.checkConnection} Nothing has changed.
          </ErrorState>
        </div>
      )}
    </AppShell>
  )
}
