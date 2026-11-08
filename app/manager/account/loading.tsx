import { MANAGER_COPY } from "@/components/nabalens/manager/copy"
import { ManagerWorkspaceLoading } from "@/components/nabalens/manager/workspace-loading"

/** Account loading. */
export default function ManagerAccountLoading() {
  return <ManagerWorkspaceLoading label={MANAGER_COPY.accountPage.loading} />
}
