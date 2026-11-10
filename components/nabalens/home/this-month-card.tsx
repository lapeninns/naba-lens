import { use } from "react"
import Link from "next/link"
import { CaretRightIcon } from "@phosphor-icons/react/dist/ssr"

import { Skeleton } from "@/components/ui/skeleton"

import { CardHead } from "../common-room"
import { pendingLines } from "../knowledge/copy"
import { Notice } from "../notice"
import {
  TargetProgress,
  TargetSetup,
} from "../tasks/monthly-progress-card"
import { StatusChip } from "../tasks/status-badges"
import type { MonthlyProgress } from "../tasks/types"
import { NO_MENU_COPY, type OurMenuProgress } from "./our-menu-card"

type Pending = { awaitingConfirmation: number; unknownRecorded: number } | null

const LINK =
  "inline-flex min-h-11 w-fit items-center gap-1 rounded-control text-body font-bold text-ink underline underline-offset-3 outline-none focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-focus focus-visible:outline-solid"

const LINES = "grid gap-1 border-t border-line pt-3 text-meta text-ink-muted"

/**
 * B01's "Also this month" lines, streamed: Home renders without waiting for
 * them (HM-14). Nothing at zero, or when the read failed.
 */
export function AlsoThisMonth({ pending }: { pending: Promise<Pending> }) {
  const lines = pendingLines(use(pending))
  if (lines.length === 0) return null
  return (
    // Separate from the bar and its number: these aren't counted.
    <div className={LINES}>
      {lines.map((line) => (
        <p key={line}>{line}</p>
      ))}
    </div>
  )
}

export function AlsoThisMonthSkeleton() {
  return (
    <div className={LINES} aria-hidden>
      <Skeleton shape="line" />
    </div>
  )
}

function MenuLine({ progress }: { progress: OurMenuProgress }) {
  switch (progress.state) {
    case "ready":
      return (
        <p className="text-body text-ink">
          <span className="font-mono font-bold tabular-nums">
            {progress.covered} of {progress.total}
          </span>{" "}
          menu items have an accepted photo
        </p>
      )
    case "no_menu":
      return <p className="text-body text-ink-muted">{NO_MENU_COPY}</p>
    case "empty":
      return (
        <p className="text-body text-ink-muted">
          The active menu has no dishes or drinks yet.
        </p>
      )
    default:
      return (
        <Notice tone="plain" role="status">
          Menu photos can&apos;t be shown right now. Try again later.
        </Notice>
      )
  }
}

/**
 * Home's one progress card (B02 design §3.4, D5): the monthly target as the
 * full card counts it, the lines outside it, and the menu's photo coverage.
 * Replacement requests aren't repeated: they are in To do. The full cards
 * stay on This month and Our menu.
 */
export function ThisMonthCard({
  monthly,
  ourMenu,
  also = null,
  monthHref = "/staff/tasks/month",
  menuHref = "/staff/menu",
}: {
  monthly: MonthlyProgress | null
  /** Null when the person has no venue (no menu line, no menu link). */
  ourMenu: OurMenuProgress | null
  /** The "Also this month" lines, usually `<AlsoThisMonth>` in Suspense. */
  also?: React.ReactNode
  monthHref?: string
  menuHref?: string
}) {
  const needsSetup = monthly?.status === "needs_setup"
  return (
    <section
      aria-labelledby="this-month-heading"
      className="grid min-w-0 gap-3 rounded-card bg-surface p-4 shadow-card"
    >
      <CardHead>
        <h2
          id="this-month-heading"
          className="font-display text-section-title [overflow-wrap:anywhere] text-ink"
        >
          This month
        </h2>
        {needsSetup ? (
          <StatusChip tone="warning">Needs setup</StatusChip>
        ) : monthly?.complete ? (
          <StatusChip tone="positive">Target met</StatusChip>
        ) : null}
      </CardHead>

      {!monthly ? (
        <p className="text-body text-ink-muted">
          There&apos;s no photo target for you this month.
        </p>
      ) : needsSetup ? (
        <TargetSetup monthly={monthly} />
      ) : (
        <TargetProgress monthly={monthly} />
      )}

      {also}

      {ourMenu ? (
        <div className="grid gap-1 border-t border-line pt-3">
          <MenuLine progress={ourMenu} />
        </div>
      ) : null}

      <div className="flex flex-wrap gap-x-6">
        <Link href={monthHref} className={LINK}>
          See this month
          <CaretRightIcon aria-hidden weight="bold" className="size-5" />
        </Link>
        {ourMenu ? (
          <Link href={menuHref} className={LINK}>
            Browse our menu
            <CaretRightIcon aria-hidden weight="bold" className="size-5" />
          </Link>
        ) : null}
      </div>
    </section>
  )
}
