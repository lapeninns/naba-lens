import { AppShell } from "@/components/nabalens/app-shell"
import { BackLink } from "@/components/nabalens/back-link"
import { NOT_FOUND_COPY } from "@/components/nabalens/not-found-card"
import { PageHeader } from "@/components/nabalens/page-header"
import { LinkButton } from "@/components/ui/link-button"
import { requireActiveAdmin } from "@/lib/auth"

const ADMIN_NOT_FOUND_COPY = {
  title: "This page isn't available",
  back: "Overview",
  action: "Go to Overview",
} as const

/**
 * notFound() in the admin area, and any unmatched /admin URL: the admin
 * navigation stays, and the way back is Overview, where admins land
 * (redesign R5, ia.md decision 12), not Library.
 */
export default async function AdminNotFound() {
  const admin = await requireActiveAdmin()
  return (
    <AppShell variant="admin" active="overview" userName={admin.displayName}>
      <div className="flex max-w-reading flex-col gap-1">
        <BackLink href="/admin/overview" compact>
          {ADMIN_NOT_FOUND_COPY.back}
        </BackLink>
        <PageHeader
          title={ADMIN_NOT_FOUND_COPY.title}
          summary={<p>{NOT_FOUND_COPY.body}</p>}
          actions={
            <LinkButton href="/admin/overview" variant="primary">
              {ADMIN_NOT_FOUND_COPY.action}
            </LinkButton>
          }
        />
      </div>
    </AppShell>
  )
}
