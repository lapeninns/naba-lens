import { StatusChip } from "./status-chip"
import type { StaffStatus } from "./types"

/** Account state. Active is quiet; only the exceptions take a tone. */
export function StaffStatusBadge({
  status,
  className,
}: {
  status: StaffStatus
  className?: string
}) {
  return <StatusChip state={status} className={className} />
}
