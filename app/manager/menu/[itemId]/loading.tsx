import { MANAGER_COPY } from "@/components/nabalens/manager/copy"
import { ManagerWorkspaceLoading } from "@/components/nabalens/manager/workspace-loading"

/** Menu item loading. */
export default function ManagerMenuItemLoading() {
  return <ManagerWorkspaceLoading label={MANAGER_COPY.item.loading} />
}
