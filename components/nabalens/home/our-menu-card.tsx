import Link from "next/link"
import { CaretRightIcon, ForkKnifeIcon } from "@phosphor-icons/react/dist/ssr"

import { Progress } from "@/components/ui/progress"

import { Notice } from "../notice"

/**
 * What Home knows about the venue's menu photos. `unavailable` is the app's
 * own state for a failed read: Home still renders, the card just says so.
 */
export type OurMenuProgress =
  | { state: "ready"; covered: number; total: number }
  | { state: "no_menu" | "empty" | "unavailable" }

export const NO_MENU_COPY =
  "Menu photos will appear once your venue’s menu is set up"

/**
 * Our menu: how many dishes and drinks on the venue's active menu have a
 * photo accepted for menu use. A different measure from the monthly photo
 * target above it, so it never mentions targets or tasks.
 */
export function OurMenuCard({
  progress,
  venueName,
  menuHref = "/staff/menu",
}: {
  progress: OurMenuProgress
  venueName: string | null
  /** The menu browser (search, sections, Still needs a photo). */
  menuHref?: string
}) {
  const browse = (
    <Link
      href={menuHref}
      className="inline-flex min-h-11 w-fit items-center gap-1 rounded-control text-body font-bold text-ink underline underline-offset-3 outline-none focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-focus focus-visible:outline-solid"
    >
      Browse our menu
      <CaretRightIcon aria-hidden weight="bold" className="size-5" />
    </Link>
  )
  return (
    <section
      aria-labelledby="our-menu-heading"
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
            id="our-menu-heading"
            className="font-display text-section-title text-ink"
          >
            Our menu
          </h2>
          <p className="text-meta [overflow-wrap:anywhere] text-ink-muted">
            Menu items with an accepted photo
            {venueName ? ` at ${venueName}` : ""}
          </p>
        </div>
      </div>
      {progress.state === "ready" ? (
        <>
          <p className="text-body text-ink">
            <span className="font-mono font-bold tabular-nums">
              {progress.covered} of {progress.total}
            </span>{" "}
            menu items have an accepted photo
          </p>
          <Progress
            value={
              progress.total > 0
                ? Math.min(100, (progress.covered / progress.total) * 100)
                : 0
            }
            aria-label={`${progress.covered} of ${progress.total} menu items have an accepted photo`}
          />
          {browse}
        </>
      ) : progress.state === "no_menu" ? (
        <p className="text-body text-ink-muted">{NO_MENU_COPY}</p>
      ) : progress.state === "empty" ? (
        <>
          <p className="text-body text-ink-muted">
            The active menu has no dishes or drinks yet.
          </p>
          {browse}
        </>
      ) : (
        <Notice tone="plain" role="status">
          Menu photos can&apos;t be shown right now. Try again later.
        </Notice>
      )}
    </section>
  )
}
