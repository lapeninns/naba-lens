import { MANAGER_COPY } from "@/components/nabalens/manager/copy"
import { ManagerTabs } from "@/components/nabalens/manager/manager-tabs"
import { ManagerWorkspaceLoading } from "@/components/nabalens/manager/workspace-loading"

/** Venue › Team loading, with the real title and tabs. */
export default function ManagerTeamLoading() {
  return (
    <ManagerWorkspaceLoading
      label={MANAGER_COPY.team.loading}
      title={MANAGER_COPY.venue.title}
      tabs={<ManagerTabs section="venue" active="team" />}
    />
  )
}
