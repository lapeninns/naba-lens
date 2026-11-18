import { MANAGER_COPY } from "@/components/nabalens/manager/copy"
import { ManagerWorkspaceLoading } from "@/components/nabalens/manager/workspace-loading"

/** S3-R5: venueReports loading. */
export default function Loading() {
  return <ManagerWorkspaceLoading label={MANAGER_COPY.venueReports.loading} />
}
