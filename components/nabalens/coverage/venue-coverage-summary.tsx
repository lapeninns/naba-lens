import Link from "next/link"
import {
  CheckCircleIcon,
  ClockCountdownIcon,
  ForkKnifeIcon,
  ListChecksIcon,
  UserSwitchIcon,
  WarningIcon,
} from "@phosphor-icons/react/dist/ssr"

import { cn } from "@/lib/utils"

import { MENU_STATE_LABEL, labelFor, plural } from "./copy"
import type { ManageHrefs } from "./manage-nav"
import type { MenuState, VenueCoverageSummary as Summary } from "./types"

function Tile({
  href,
  title,
  value,
  detail,
  icon,
  attention,
  textValue,
}: {
  href: string
  title: string
  value: string
  detail?: string | null
  icon: React.ReactNode
  attention?: boolean
  /** The value is words, not a number. */
  textValue?: boolean
}) {
  return (
    <li>
      <Link
        href={href}
        className={cn(
          "flex h-full flex-col gap-2 rounded-xl border bg-card p-4 transition-colors outline-none hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50",
          attention && "border-warning/50"
        )}
      >
        <span className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
          {icon}
          {title}
        </span>
        <span
          className={cn(
            "font-semibold",
            textValue ? "text-base" : "text-2xl tabular-nums"
          )}
        >
          {value}
        </span>
        {detail ? (
          <span className="text-sm text-muted-foreground">{detail}</span>
        ) : null}
      </Link>
    </li>
  )
}

/** Menu states that keep the venue from showing current menu coverage. */
export function menuNeedsAttention(state: MenuState): boolean {
  return state !== "current" && state !== "no_menu"
}

/** "Menu changed — review coverage" with a link to the menu page. */
export function MenuChangedBanner({
  state,
  href,
}: {
  state: MenuState
  href?: string
}) {
  if (state !== "menu_changed" && state !== "reconciliation_pending") {
    return null
  }
  return (
    <p
      role="status"
      className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning-surface px-3 py-2 text-sm"
    >
      <WarningIcon
        className="mt-0.5 size-4 shrink-0 text-warning"
        aria-hidden
      />
      <span>
        {href ? (
          <Link
            href={href}
            className="font-medium underline underline-offset-3"
          >
            {labelFor(MENU_STATE_LABEL, state)}
          </Link>
        ) : (
          <span className="font-medium">
            {labelFor(MENU_STATE_LABEL, state)}
          </span>
        )}
        .{" "}
        {state === "menu_changed"
          ? "A new menu is active. Set up its sections; the previous plan and its photos are kept."
          : "Choose which accepted photos carry over to the new menu’s sections. Nothing is matched automatically."}{" "}
        Menu coverage is not current until this is done.
      </span>
    </p>
  )
}

/**
 * One venue's coverage at a glance. Venue coverage only: staff participation
 * (monthly targets) is reported separately on the team page.
 */
export function VenueCoverageSummary({
  summary,
  hrefs,
}: {
  summary: Summary
  hrefs: ManageHrefs
}) {
  const menuAttention = menuNeedsAttention(summary.menuState)
  return (
    <section aria-labelledby="coverage-summary-title" className="grid gap-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h2 id="coverage-summary-title" className="text-lg font-medium">
          Venue coverage
        </h2>
        {summary.complete ? (
          <span className="inline-flex items-center gap-1 text-sm font-medium text-positive">
            <CheckCircleIcon aria-hidden />
            Complete
          </span>
        ) : (
          <span className="text-sm text-muted-foreground">
            Not complete yet
          </span>
        )}
      </div>
      <MenuChangedBanner state={summary.menuState} href={hrefs.menu} />
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Tile
          href={hrefs.checklist}
          title="Checklist complete"
          value={`${summary.satisfied} of ${summary.applicable}`}
          detail={
            summary.notApplicable > 0
              ? `${plural(summary.notApplicable, "item")} not applicable (not counted)`
              : "Applicable items with enough accepted photos"
          }
          icon={<ListChecksIcon aria-hidden />}
        />
        <Tile
          href={hrefs.checklist}
          title="Needs setup"
          value={String(summary.needsSetup)}
          detail={
            summary.amenityUnknown > 0
              ? `${plural(summary.amenityUnknown, "amenity", "amenities")} need verification`
              : summary.needsSetup > 0
                ? "Confirm whether these apply, and their photo targets"
                : "Nothing waiting for setup"
          }
          icon={<WarningIcon aria-hidden />}
          attention={summary.needsSetup > 0 || summary.amenityUnknown > 0}
        />
        <Tile
          href={hrefs.review}
          title="To review"
          value={String(summary.pendingReview)}
          detail={
            summary.pendingReview > 0
              ? "Submitted photos waiting for a decision"
              : "No photos waiting"
          }
          icon={<CheckCircleIcon aria-hidden />}
          attention={summary.pendingReview > 0}
        />
        <Tile
          href={hrefs.checklist}
          title="Overdue"
          value={String(summary.overdue)}
          detail="Shown for follow-up; staff can still upload and submit"
          icon={<ClockCountdownIcon aria-hidden />}
          attention={summary.overdue > 0}
        />
        <Tile
          href={hrefs.checklist}
          title="Needs reassignment"
          value={String(summary.needsReassignment)}
          detail="Items whose assignees left or moved venue"
          icon={<UserSwitchIcon aria-hidden />}
          attention={summary.needsReassignment > 0}
        />
        <Tile
          href={hrefs.menu}
          title="Menu"
          value={labelFor(MENU_STATE_LABEL, summary.menuState)}
          detail={
            summary.pendingReconciliation > 0
              ? `${plural(summary.pendingReconciliation, "old section")} to reconcile`
              : summary.menuState === "no_menu"
                ? "An admin activates menus"
                : null
          }
          icon={<ForkKnifeIcon aria-hidden />}
          attention={menuAttention}
          textValue
        />
      </ul>
    </section>
  )
}
