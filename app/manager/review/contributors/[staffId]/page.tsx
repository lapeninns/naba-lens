import { notFound } from "next/navigation"

import { MANAGER_COPY } from "@/components/nabalens/manager/copy"
import { managerHrefs } from "@/components/nabalens/manager/hrefs"
import { WorkspacePending } from "@/components/nabalens/manager/workspace-pending"
import { requireManagerVenue } from "@/lib/auth/manager"
import { isUuid } from "@/lib/server/coverage/validate"

export const metadata = { title: "Contributor · Naba-Lens" }

/** Contributor view. Phase 1: a neutral note until item review is switched on. */
export default async function ManagerContributorPage({
  params,
}: {
  params: Promise<{ staffId: string }>
}) {
  const { venue } = await requireManagerVenue()
  const { staffId } = await params
  if (!isUuid(staffId)) notFound()
  const copy = MANAGER_COPY.contributor
  return (
    <WorkspacePending
      venueName={venue.name}
      title={copy.title}
      note={copy.pendingBody}
      back={{ href: managerHrefs.review(), label: MANAGER_COPY.review.title }}
    />
  )
}
