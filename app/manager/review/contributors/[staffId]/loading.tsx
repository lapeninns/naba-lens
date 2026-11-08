import { MANAGER_COPY } from "@/components/nabalens/manager/copy"
import { ManagerWorkspaceLoading } from "@/components/nabalens/manager/workspace-loading"

/** Contributor loading. */
export default function ManagerContributorLoading() {
  return <ManagerWorkspaceLoading label={MANAGER_COPY.contributor.loading} />
}
