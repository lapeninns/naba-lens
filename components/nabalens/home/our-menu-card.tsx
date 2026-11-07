import Link from "next/link"
import { CaretRightIcon } from "@phosphor-icons/react/dist/ssr"

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
      className="inline-flex w-fit items-center gap-1 text-body-touch font-semibold text-ink underline underline-offset-3 md:text-body-sm"
    >
      Browse our menu
      <CaretRightIcon aria-hidden className="size-4" />
    </Link>
  )
  return (
    <section
      aria-labelledby="our-menu-heading"
      className="flex flex-col gap-3 rounded-xl border bg-card p-4"
    >
      <div className="grid gap-0.5">
        <h2
          id="our-menu-heading"
          className="text-item-title-touch text-ink md:text-item-title"
        >
          Our menu
        </h2>
        <p className="text-meta-touch text-ink-muted md:text-meta">
          Menu items with an accepted photo
          {venueName ? ` at ${venueName}` : ""}
        </p>
      </div>
      {progress.state === "ready" ? (
        <>
          <p className="text-body-touch text-ink md:text-body">
            <span className="font-semibold tabular-nums">
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
        <p className="text-body-touch text-ink-muted md:text-body-sm">
          {NO_MENU_COPY}
        </p>
      ) : progress.state === "empty" ? (
        <>
          <p className="text-body-touch text-ink-muted md:text-body-sm">
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
