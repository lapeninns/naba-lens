import { MANAGER_COPY } from "@/components/nabalens/manager/copy"
import { ManagerWorkspaceLoading } from "@/components/nabalens/manager/workspace-loading"

/** Overview loading (pages with their own loading state name their content). */
export default function ManagerLoading() {
  return <ManagerWorkspaceLoading label={MANAGER_COPY.overview.loading} />
}
