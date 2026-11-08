import { logout } from "@/app/_media/actions"
import { AppShell } from "@/components/nabalens/app-shell"
import { NotFoundCard } from "@/components/nabalens/not-found-card"
import { requireActiveStaff } from "@/lib/auth"
import { ROUTES } from "@/lib/auth/routes"

/**
 * notFound() in the staff area (legacy Manage, a removed record): the staff
 * navigation stays, and the way back is Home. The layout has already checked
 * the account; this read is the same cached one.
 */
export default async function StaffNotFound() {
  const profile = await requireActiveStaff()
  return (
    <AppShell
      variant="staff"
      userName={profile.displayName}
      logoutAction={logout}
    >
      <div className="mx-auto flex w-full max-w-(--size-feed) flex-col gap-(--gutter)">
        <NotFoundCard backHref={ROUTES.staffLanding} backLabel="Go to Home" />
      </div>
    </AppShell>
  )
}
