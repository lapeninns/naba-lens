import type { MenuVersionStatus } from "@/lib/menus/types"
import { cn } from "@/lib/utils"

import { MENU_STATUS_DESCRIPTION, MENU_STATUS_LABEL } from "./copy"

const TONE: Record<MenuVersionStatus, string> = {
  draft: "bg-info-surface text-info",
  active: "bg-positive-surface text-positive",
  retired: "bg-muted text-muted-foreground",
  discarded: "bg-muted text-muted-foreground line-through decoration-1",
}

type MenuVersionStatusBadgeProps = {
  status: MenuVersionStatus
  /** Show what the status means next to the badge (always for "active" pages). */
  withDescription?: boolean
  className?: string
}

/** Version status. "Active" means available for labelling, nothing more. */
export function MenuVersionStatusBadge({
  status,
  withDescription = false,
  className,
}: MenuVersionStatusBadgeProps) {
  const badge = (
    <span
      className={cn(
        "inline-flex h-5 shrink-0 items-center rounded-sm px-1.5 text-xs font-medium",
        TONE[status],
        !withDescription && className
      )}
    >
      {MENU_STATUS_LABEL[status]}
      {status === "active" && !withDescription ? (
        <span className="sr-only">, available for labelling only</span>
      ) : null}
    </span>
  )
  if (!withDescription) return badge
  return (
    <span
      className={cn("inline-flex flex-wrap items-baseline gap-2", className)}
    >
      {badge}
      <span className="text-sm text-muted-foreground">
        {MENU_STATUS_DESCRIPTION[status]}
      </span>
    </span>
  )
}
