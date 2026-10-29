import { cn } from "@/lib/utils"

import type { StaffStatus } from "./types"

const LABEL: Record<StaffStatus, string> = {
  active: "Active",
  invited: "Invited",
  inactive: "Inactive",
}

const TONE: Record<StaffStatus, string> = {
  active: "bg-positive-surface text-positive",
  invited: "bg-info-surface text-info",
  inactive: "bg-muted text-muted-foreground",
}

export function StaffStatusBadge({
  status,
  className,
}: {
  status: StaffStatus
  className?: string
}) {
  return (
    <span
      className={cn(
        "inline-flex h-5 items-center rounded-sm px-1.5 text-xs font-medium",
        TONE[status],
        className
      )}
    >
      {LABEL[status]}
    </span>
  )
}
