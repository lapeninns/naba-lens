import { AppShell } from "@/components/nabalens/app-shell"
import { NotFoundCard } from "@/components/nabalens/not-found-card"
import { requireActiveStaff } from "@/lib/auth"
import { ROUTES } from "@/lib/auth/routes"

import { currentStaffShell } from "./_shell/shell-status"

/**
 * notFound() in the staff area (legacy Manage, a removed record): the staff
 * navigation stays, and the way back is Home. The layout has already checked
 * the account; this read is the same cached one. The shell status never
 * throws, so a failed read only leaves the counts out.
 */
export default async function StaffNotFound() {
  const [profile, shell] = await Promise.all([
    requireActiveStaff(),
    currentStaffShell(),
  ])
  return (
    <AppShell variant="staff" {...shell} userName={profile.displayName}>
      <div className="mx-auto flex w-full max-w-(--size-feed) flex-col gap-(--gutter)">
        <NotFoundCard backHref={ROUTES.staffLanding} backLabel="Go to Home" />
      </div>
    </AppShell>
  )
}
