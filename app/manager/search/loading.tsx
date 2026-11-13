import { SEARCH_COPY } from "@/components/nabalens/search/search-copy"
import { ManagerWorkspaceLoading } from "@/components/nabalens/manager/workspace-loading"

/** Search loading. */
export default function ManagerSearchLoading() {
  return <ManagerWorkspaceLoading label={SEARCH_COPY.searching} />
}
