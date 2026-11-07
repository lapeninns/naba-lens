import { MANAGER_COPY } from "@/components/nabalens/manager/copy"
import { WorkspacePending } from "@/components/nabalens/manager/workspace-pending"
import { requireManagerVenue } from "@/lib/auth/manager"

export const metadata = { title: "Menu · Naba-Lens" }

/** Menu. Phase 1: a neutral note until item review is switched on. */
export default async function ManagerMenuPage() {
  const { venue } = await requireManagerVenue()
  const copy = MANAGER_COPY.menu
  return (
    <WorkspacePending
      venueName={venue.name}
      title={copy.title}
      noteTitle={copy.pendingTitle}
      note={copy.pendingBody}
    />
  )
}
