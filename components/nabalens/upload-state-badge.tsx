import { StatusChip } from "./status-chip"
import type { UploadState } from "./types"

/**
 * Technical pipeline state. Never an approval status, and ready media carries
 * no mark at all, so ready can never be mistaken for accepted.
 */
export function UploadStateBadge({
  state,
  className,
}: {
  state: UploadState
  className?: string
}) {
  if (state === "ready") return null
  return <StatusChip state={state} className={className} />
}
