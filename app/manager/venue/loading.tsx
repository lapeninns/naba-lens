import { MANAGER_COPY } from "@/components/nabalens/manager/copy"
import { ManagerTabs } from "@/components/nabalens/manager/manager-tabs"
import { ManagerWorkspaceLoading } from "@/components/nabalens/manager/workspace-loading"

/** S2-MGR: Venue › Details loading, with the real title and tabs. */
export default function Loading() {
  return (
    <ManagerWorkspaceLoading
      label={MANAGER_COPY.venue.loading}
      title={MANAGER_COPY.venue.title}
      tabs={<ManagerTabs section="venue" active="details" />}
    />
  )
}
