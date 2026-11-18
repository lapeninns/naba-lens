import { MANAGER_COPY } from "@/components/nabalens/manager/copy"
import { ManagerWorkspaceLoading } from "@/components/nabalens/manager/workspace-loading"

/** S2-MGR: venue loading. */
export default function Loading() {
  return <ManagerWorkspaceLoading label={MANAGER_COPY.venue.loading} />
}
