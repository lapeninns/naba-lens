import Link from "next/link"
import { CaretRightIcon, ForkKnifeIcon } from "@phosphor-icons/react/dist/ssr"

import { Progress } from "@/components/ui/progress"

import { Notice } from "../notice"
import { HOME_OUR_MENU_COPY as COPY } from "../tasks/copy"
import {
  menuComplete,
  type GoalsPrimary,
  type OurMenuGoal,
} from "./goals-home-model"
import { NO_MENU_COPY } from "./our-menu-card"
import { AddPhotosButton, StillNeededList } from "./still-needed-list"

/** Focusable: a notice above that goes away hands focus here. */
export const OUR_MENU_HEADING_ID = "our-menu-heading"

const LINK =
  "inline-flex min-h-11 w-fit items-center gap-1 rounded-control text-body font-bold text-ink underline underline-offset-3 focus-ring outline-none"

/**
 * Our menu, the venue's goal (v0.5 §1): how many dishes and drinks have an
 * accepted photo, and the first few that are still needed, in menu order.
 * Nobody is assigned a dish and nothing here has a date.
 */
export function OurMenuGoalCard({
  menu,
  venueName,
  canAdd,
  primary,
  menuHref = "/staff/menu",
}: {
  menu: OurMenuGoal
  venueName: string | null
  canAdd: boolean
  primary: GoalsPrimary
  menuHref?: string
}) {
  const gapsHref = `${menuHref}?filter=gaps`
  return (
    <section
      aria-labelledby={OUR_MENU_HEADING_ID}
      className="grid min-w-0 gap-3 rounded-card bg-surface p-4 shadow-card"
    >
      <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-3">
        <span
          aria-hidden
          className="grid size-11 place-items-center rounded-round bg-surface-2 text-ink [&_svg]:size-6"
        >
          <ForkKnifeIcon />
        </span>
        <div className="grid min-w-0 gap-0.5">
          <h2
            id={OUR_MENU_HEADING_ID}
            tabIndex={-1}
            className="type-section-title text-ink focus-ring outline-none"
          >
            {COPY.title}
          </h2>
          <p className="text-meta [overflow-wrap:anywhere] text-ink-muted">
            {COPY.subtitle(venueName)}
          </p>
        </div>
      </div>

      {menu.state === "ready" ? (
        <>
          <p className="text-body text-ink">
            <span className="font-mono font-bold tabular-nums">
              {COPY.count(menu.covered, menu.total)}
            </span>
          </p>
          <Progress
            value={
              menu.total > 0
                ? Math.min(100, (menu.covered / menu.total) * 100)
                : 0
            }
            aria-label={COPY.count(menu.covered, menu.total)}
            // Green: the bar counts accepted photos.
            tone="ok"
          />
          {menu.needsRecheck > 0 ? (
            <p className="text-body text-ink-muted">
              {COPY.recheck(menu.needsRecheck)}
            </p>
          ) : null}

          {menuComplete(menu) ? (
            <div className="grid gap-3 border-t border-line pt-3">
              <p className="text-body text-ink">{COPY.complete}</p>
              <p className="text-meta text-ink-muted">{COPY.completeHint}</p>
              {primary?.kind === "add_photos" && canAdd ? (
                <AddPhotosButton />
              ) : null}
            </div>
          ) : menu.gaps > 0 ? (
            <div className="grid gap-1 border-t border-line pt-3">
              <h3 className="text-item-title text-ink">{COPY.stillNeeded}</h3>
              <p className="text-meta text-ink-muted">{COPY.stillNeededHint}</p>
              {menu.stillNeeded ? (
                <div className="-mx-3 sm:-mx-4">
                  <StillNeededList
                    items={menu.stillNeeded}
                    canAdd={canAdd}
                    primaryItemId={
                      primary?.kind === "dish" ? primary.itemId : null
                    }
                  />
                </div>
              ) : (
                <Notice tone="plain" role="status">
                  {COPY.listFailed}
                </Notice>
              )}
              <Link href={gapsHref} className={LINK}>
                {COPY.seeAll(menu.gaps)}
                <CaretRightIcon aria-hidden weight="bold" className="size-5" />
              </Link>
            </div>
          ) : (
            <Link href={menuHref} className={LINK}>
              {COPY.browse}
              <CaretRightIcon aria-hidden weight="bold" className="size-5" />
            </Link>
          )}
        </>
      ) : menu.state === "no_menu" ? (
        <p className="text-body text-ink-muted">{NO_MENU_COPY}</p>
      ) : menu.state === "empty" ? (
        <p className="text-body text-ink-muted">{COPY.empty}</p>
      ) : menu.state === "needs_setup" ? (
        <p className="text-body text-ink-muted">{COPY.needsSetup}</p>
      ) : (
        <Notice tone="plain" role="status">
          {COPY.unavailable}
        </Notice>
      )}
    </section>
  )
}
