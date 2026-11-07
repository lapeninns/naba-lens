import { notFound } from "next/navigation"

import { MANAGER_COPY } from "@/components/nabalens/manager/copy"
import { managerHrefs } from "@/components/nabalens/manager/hrefs"
import { WorkspacePending } from "@/components/nabalens/manager/workspace-pending"
import { requireManagerVenue } from "@/lib/auth/manager"
import { isUuid } from "@/lib/server/coverage/validate"

export const metadata = { title: "Menu item · Naba-Lens" }

/** Item detail. Phase 1: a neutral note until item review is switched on. */
export default async function ManagerMenuItemPage({
  params,
}: {
  params: Promise<{ itemId: string }>
}) {
  const { venue } = await requireManagerVenue()
  const { itemId } = await params
  if (!isUuid(itemId)) notFound()
  const copy = MANAGER_COPY.item
  return (
    <WorkspacePending
      venueName={venue.name}
      title={copy.title}
      note={copy.pendingBody}
      back={{ href: managerHrefs.menu(), label: copy.back }}
    />
  )
}
