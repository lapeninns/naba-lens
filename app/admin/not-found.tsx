import { AppShell } from "@/components/nabalens/app-shell"
import { NotFoundCard } from "@/components/nabalens/not-found-card"
import { requireActiveAdmin } from "@/lib/auth"
import { ROUTES } from "@/lib/auth/routes"

/**
 * notFound() in the admin area (an unknown menu version or venue): the admin
 * navigation stays, and the way back is Content, the admin home.
 */
export default async function AdminNotFound() {
  const admin = await requireActiveAdmin()
  return (
    <AppShell variant="admin" active="content" userName={admin.displayName}>
      <div className="mx-auto flex w-full max-w-(--size-feed) flex-col gap-(--gutter)">
        <NotFoundCard backHref={ROUTES.adminHome} backLabel="Go to Content" />
      </div>
    </AppShell>
  )
}
