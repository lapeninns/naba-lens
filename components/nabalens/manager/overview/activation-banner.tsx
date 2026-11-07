import Link from "next/link"

import { formatDate } from "@/components/nabalens/format"
import { Notice } from "@/components/nabalens/notice"
import { buttonVariants } from "@/components/ui/button"

import type { ManagerOverview } from "@/lib/server/menu-photos/types"

import { MANAGER_COPY } from "../copy"
import { managerHrefs } from "../hrefs"

const BANNER_DAYS = 14
const DAY = 24 * 60 * 60 * 1000

/** "{title} · active since {date}", or the title alone without a date. */
export function menuMeta(menu: ManagerOverview["menu"]): string | null {
  if (!menu) return null
  if (!menu.activatedAt) return menu.title || null
  const since = `active since ${formatDate(menu.activatedAt)}`
  return menu.title ? `${menu.title} · ${since}` : since
}

/** A menu activated in the last 14 days that carried, rechecked or added items. */
export function showsActivationBanner(
  overview: ManagerOverview,
  now: string
): boolean {
  const at = overview.menu?.activatedAt
  if (!at) return false
  const age = Date.parse(now) - Date.parse(at)
  if (Number.isNaN(age) || age > BANNER_DAYS * DAY) return false
  return (
    overview.carriedItems + overview.needsRecheckItems + overview.newItems > 0
  )
}

/**
 * What a recent menu activation did to the photos: items that kept their
 * photo, items that need a new decision and new items. Shared by Overview and
 * Menu; renders nothing outside the 14-day window.
 */
export function ActivationBanner({
  overview,
  now,
}: {
  overview: ManagerOverview
  /** ISO instant of the render, so server and browser agree. */
  now: string
}) {
  if (!showsActivationBanner(overview, now) || !overview.menu?.activatedAt)
    return null
  const copy = MANAGER_COPY.overview
  return (
    <Notice
      tone="plain"
      role="status"
      data-slot="activation-banner"
      action={
        <Link
          href={managerHrefs.review({ status: "recheck" })}
          className={buttonVariants({ variant: "secondary", size: "sm" })}
        >
          {copy.reviewChanges}
        </Link>
      }
    >
      <p>
        {copy.banner(
          formatDate(overview.menu.activatedAt),
          overview.carriedItems,
          overview.needsRecheckItems,
          overview.newItems
        )}
      </p>
    </Notice>
  )
}
