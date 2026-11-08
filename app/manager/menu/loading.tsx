import { MANAGER_COPY } from "@/components/nabalens/manager/copy"
import { ManagerWorkspaceLoading } from "@/components/nabalens/manager/workspace-loading"

/** Menu loading. */
export default function ManagerMenuLoading() {
  return <ManagerWorkspaceLoading label={MANAGER_COPY.menu.loading} />
}
