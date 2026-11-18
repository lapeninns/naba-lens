import type * as React from "react"
import Link from "next/link"
import {
  BookOpenTextIcon,
  CaretRightIcon,
  ClipboardTextIcon,
} from "@phosphor-icons/react/dist/ssr"

/*
 * Album Home's link rows besides Match later (DESIGN.md §5a): Start here for
 * a new starter, above the album's places, and Other jobs, under the Match
 * later row. Same shape as MatchLaterRow: icon square, title, one line,
 * chevron, the whole row one 64px target.
 */

export const HOME_ROWS_COPY = {
  startHere: "Start here",
  startHereLine: "New to Naba-Lens? A short welcome shows what to do first.",
  otherJobs: "Other jobs",
  otherJobsLine: (n: number | null) =>
    n === null
      ? "Checks and venue questions. We couldn't count them."
      : n === 1
        ? "1 job · checks and venue questions"
        : `${n} jobs · checks and venue questions`,
} as const

/**
 * One link row: icon square, title, one line, chevron, the whole row one 64px
 * target. Exported for the manager Overview and Venue hub (S2-MGR), which use
 * the same row rather than a second one.
 */
export function HomeRow({
  href,
  icon,
  title,
  line,
  slot,
}: {
  href: string
  icon: React.ReactNode
  title: string
  line: string
  slot: string
}) {
  return (
    <Link
      href={href}
      data-slot={slot}
      className="flex min-h-16 w-full items-center gap-3 rounded-card bg-surface px-3 py-2 text-start text-ink edge focus-ring"
    >
      <span className="flex size-12 shrink-0 items-center justify-center rounded-control bg-surface-2 [&_svg]:size-6">
        {icon}
      </span>
      <span className="grid min-w-0 flex-1">
        <span className="text-label">{title}</span>
        <span className="text-body text-ink-muted">{line}</span>
      </span>
      <CaretRightIcon aria-hidden className="size-5 shrink-0" />
    </Link>
  )
}

/**
 * The welcome for a new starter (no photos yet, not dismissed). It is an
 * offer: Album never redirects to the welcome, and Me keeps a way back to it.
 */
export function StartHereRow({ href }: { href: string | null }) {
  if (!href) return null
  return (
    <HomeRow
      href={href}
      slot="start-here-row"
      icon={<BookOpenTextIcon aria-hidden />}
      title={HOME_ROWS_COPY.startHere}
      line={HOME_ROWS_COPY.startHereLine}
    />
  )
}

/**
 * Other jobs (decision 10): assigned tasks, amenity checks and venue
 * questions that are not menu photos. Shown when there are any, or when they
 * couldn't be counted (null), so they are always reachable.
 */
export function OtherJobsRow({
  count,
  href = "/staff/tasks/other",
}: {
  count: number | null
  href?: string
}) {
  if (count !== null && count <= 0) return null
  return (
    <HomeRow
      href={href}
      slot="other-jobs-row"
      icon={<ClipboardTextIcon aria-hidden />}
      title={HOME_ROWS_COPY.otherJobs}
      line={HOME_ROWS_COPY.otherJobsLine(count)}
    />
  )
}
