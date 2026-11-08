import Link from "next/link"

import { AppShell, EmptyState } from "@/components/nabalens"
import { PageHeader } from "@/components/nabalens/page-header"
import { buttonVariants } from "@/components/ui/button"
import { requireActiveAdmin } from "@/lib/auth"

export default async function StaffMemberNotFound() {
  const admin = await requireActiveAdmin()
  return (
    <AppShell variant="admin" active="staff" userName={admin.displayName}>
      <div className="grid gap-5">
        <PageHeader
          venueScope
          scope="All venues"
          title="Staff member"
          className="pb-0 md:pb-0"
        />
        <EmptyState
          title="This account no longer exists."
          description="It may have been removed during setup. Their uploads, if any, are still in Content."
          action={
            <Link
              href="/admin/staff"
              className={buttonVariants({
                variant: "secondary",
                size: "touch",
              })}
            >
              Back to Staff
            </Link>
          }
        />
      </div>
    </AppShell>
  )
}
