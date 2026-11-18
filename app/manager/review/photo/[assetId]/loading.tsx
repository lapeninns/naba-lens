import { INBOX_COPY } from "@/components/nabalens/manager/review/inbox-copy"
import { ManagerWorkspaceLoading } from "@/components/nabalens/manager/workspace-loading"

/** Photo review loading. */
export default function ManagerReviewPhotoLoading() {
  return <ManagerWorkspaceLoading label={`${INBOX_COPY.title}…`} />
}
