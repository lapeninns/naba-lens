import { MANAGER_COPY } from "@/components/nabalens/manager/copy"
import { ManagerWorkspaceLoading } from "@/components/nabalens/manager/workspace-loading"

/** Your photos loading. */
export default function Loading() {
  return <ManagerWorkspaceLoading label={MANAGER_COPY.uploads.loadingPage} />
}
