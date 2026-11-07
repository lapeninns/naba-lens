import type { MenuVersionStatus } from "@/lib/menus/types"
import { cn } from "@/lib/utils"

import { StatusChip, type ChipStateKey } from "../status-chip"

import { MENU_STATUS_DESCRIPTION, MENU_STATUS_LABEL } from "./copy"

const STATE: Record<MenuVersionStatus, ChipStateKey> = {
  draft: "draft",
  active: "active_menu",
  retired: "retired_menu",
  discarded: "discarded",
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
    <StatusChip
      state={STATE[status]}
      className={cn("shrink-0", !withDescription && className)}
    >
      {MENU_STATUS_LABEL[status]}
    </StatusChip>
  )
  if (!withDescription) return badge
  return (
    <span
      className={cn("inline-flex flex-wrap items-baseline gap-2", className)}
    >
      {badge}
      <span className="text-meta text-ink-muted">
        {MENU_STATUS_DESCRIPTION[status]}
      </span>
    </span>
  )
}
