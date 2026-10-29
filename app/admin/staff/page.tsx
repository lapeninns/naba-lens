import type { Metadata } from "next"

import { AppShell } from "@/components/nabalens"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { requireActiveAdmin } from "@/lib/auth"
import { MEDIA_LIMITS } from "@/lib/config/media"
import { listAssignableVenues, listStaffDirectory } from "@/lib/server/accounts"
import { accountsContext } from "@/lib/server/accounts/request"

import { signOutAction } from "./actions"
import { StaffDirectory } from "./staff-directory"

export const metadata: Metadata = { title: "Staff · NabaLens" }

export default async function StaffDirectoryPage() {
  const admin = await requireActiveAdmin()
  const ctx = await accountsContext()
  const [directory, venues] = await Promise.all([
    listStaffDirectory(ctx),
    listAssignableVenues(ctx),
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
          maxAvatarBytes={MEDIA_LIMITS.maxAvatarBytes}
        />
      ) : (
        <Alert variant="destructive">
          <AlertDescription>
            The staff list could not be loaded. Reload the page to try again.
          </AlertDescription>
        </Alert>
      )}
    </AppShell>
  )
}
