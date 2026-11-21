import { MANAGER_COPY } from "@/components/nabalens/manager/copy"
import { ManagerTabs } from "@/components/nabalens/manager/manager-tabs"
import { ManagerWorkspaceLoading } from "@/components/nabalens/manager/workspace-loading"

/** Album › Menu loading: the real title and tabs, sunken chips and rows. */
export default function ManagerMenuLoading() {
  return (
    <ManagerWorkspaceLoading
      label={MANAGER_COPY.menu.loading}
      title={MANAGER_COPY.menu.title}
      tabs={<ManagerTabs section="album" active="menu" />}
      chips={5}
    />
  )
}
