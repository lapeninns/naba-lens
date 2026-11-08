import { MANAGER_COPY } from "@/components/nabalens/manager/copy"
import { ManagerWorkspaceLoading } from "@/components/nabalens/manager/workspace-loading"

/** Review loading. */
export default function ManagerReviewLoading() {
  return <ManagerWorkspaceLoading label={MANAGER_COPY.review.loading} />
}
