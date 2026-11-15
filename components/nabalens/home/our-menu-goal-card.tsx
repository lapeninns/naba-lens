import Link from "next/link"
import { CaretRightIcon, ForkKnifeIcon } from "@phosphor-icons/react/dist/ssr"

import { Progress } from "@/components/ui/progress"

import { Notice } from "../notice"
import {
  menuComplete,
  type GoalsPrimary,
  type OurMenuGoal,
} from "./goals-home-model"
import { NO_MENU_COPY } from "./our-menu-card"
import { OpenCameraButton, StillNeededList } from "./still-needed-list"

/** Focusable: a notice above that goes away hands focus here. */
export const OUR_MENU_HEADING_ID = "our-menu-heading"

const LINK =
  "inline-flex min-h-11 w-fit items-center gap-1 rounded-control text-body font-bold text-ink underline underline-offset-3 focus-ring outline-none"

// TEMP copy (G-1): G-5 moves these into the copy files.
const COPY = {
  title: "Our menu",
  subtitle: (venue: string | null) =>
    `The whole team's goal${venue ? ` at ${venue}` : ""}: an accepted photo of every dish and drink`,
  count: (covered: number, total: number) =>
    `${covered} of ${total} have an accepted photo`,
  recheck: (n: number) =>
    n === 1
      ? "1 dish is being checked after a menu change."
      : `${n} dishes are being checked after a menu change.`,
  stillNeeded: "Still needed",
  stillNeededHint:
    "Anyone can take these. A dish leaves the list once a photo of it is accepted.",
  listFailed: "The dishes still needed can't be shown right now.",
  seeAll: (n: number) => `See all ${n}`,
  complete: "Every dish and drink on the menu has an accepted photo.",
  completeHint: "New photos still count toward your month.",
  empty: "The active menu has no dishes or drinks yet.",
  needsSetup:
    "Your venue's menu appears here once an admin assigns your venue.",
  unavailable: "Menu photos can't be shown right now. Try again later.",
  browse: "Browse our menu",
} as const

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
              {primary?.kind === "open_camera" && canAdd ? (
                <OpenCameraButton />
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
