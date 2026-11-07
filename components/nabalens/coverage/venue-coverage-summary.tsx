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
          "flex h-full min-h-11 flex-col gap-2 rounded-card bg-surface p-4 text-ink no-underline shadow-card transition-colors duration-(--duration-quick) outline-none hover:bg-surface-2 focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-focus focus-visible:outline-solid",
          attention &&
            "shadow-[var(--elevation-card),inset_4px_0_0_var(--warn-fg)]"
        )}
      >
        <span className="flex items-center gap-2 text-meta font-semibold text-ink-muted">
          {icon}
          {title}
        </span>
        <span
          className={cn(
            "font-display text-ink",
            textValue
              ? "text-item-title"
              : "text-section-title font-extrabold tabular-nums"
          )}
        >
          {value}
        </span>
        {detail ? (
          <span className="text-meta text-ink-muted">{detail}</span>
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
      className="flex items-start gap-2 rounded-card bg-warn-bg px-4 py-3 text-body text-ink shadow-[inset_4px_0_0_var(--warn-fg)]"
    >
      <WarningIcon
        className="mt-0.5 size-5 shrink-0 text-warn-fg"
        aria-hidden
      />
      <span>
        {href ? (
          <Link href={href} className="font-bold underline underline-offset-3">
            {labelFor(MENU_STATE_LABEL, state)}
          </Link>
        ) : (
          <span className="font-bold">{labelFor(MENU_STATE_LABEL, state)}</span>
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
    <section
      aria-labelledby="coverage-summary-title"
      className="grid min-w-0 gap-(--gutter)"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-1 pt-2">
        <h2
          id="coverage-summary-title"
          className="font-display text-section-title text-ink"
        >
          Venue coverage
        </h2>
        {summary.complete ? (
          <span className="inline-flex items-center gap-1 text-label text-ok-fg">
            <CheckCircleIcon aria-hidden />
            Complete
          </span>
        ) : (
          <span className="text-meta text-ink-muted">Not complete yet</span>
        )}
      </div>
      <MenuChangedBanner state={summary.menuState} href={hrefs.menu} />
      <ul className="grid gap-(--gutter) sm:grid-cols-2 lg:grid-cols-3">
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
