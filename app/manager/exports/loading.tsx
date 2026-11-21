import { MANAGER_COPY } from "@/components/nabalens/manager/copy"
import { ManagerWorkspaceLoading } from "@/components/nabalens/manager/workspace-loading"

/** Venue › Exports loading. */
export default function Loading() {
  return <ManagerWorkspaceLoading label={MANAGER_COPY.exports.loading} />
}
