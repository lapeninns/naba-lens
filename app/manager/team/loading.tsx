import { MANAGER_COPY } from "@/components/nabalens/manager/copy"
import { ManagerWorkspaceLoading } from "@/components/nabalens/manager/workspace-loading"

/** Team targets loading. */
export default function ManagerTeamLoading() {
  return <ManagerWorkspaceLoading label={MANAGER_COPY.team.loading} />
}
