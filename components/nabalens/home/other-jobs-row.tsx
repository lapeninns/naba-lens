import Link from "next/link"
import {
  CaretRightIcon,
  ClipboardTextIcon,
} from "@phosphor-icons/react/dist/ssr"

import { CountBadge } from "../status-chip"

// TEMP copy (G-1): G-5 moves these into the copy files.
const COPY = {
  title: "Other jobs",
  body: "Checks and venue jobs that aren't menu photos.",
} as const

/**
 * Decision 10: one row, only when the person has non-menu requirements or
 * amenity checks, linking to the one list page of those jobs (G-4 owns it;
 * `/staff/tasks/all` until then). Menu sections are never counted here.
 */
export function OtherJobsRow({
  count,
  href = "/staff/tasks/all",
}: {
  count: number
  href?: string
}) {
  if (count <= 0) return null
  return (
    <Link
      href={href}
      className="grid min-h-16 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-card bg-surface p-4 shadow-card focus-ring outline-none"
    >
      <span
        aria-hidden
        className="grid size-11 place-items-center rounded-round bg-surface-2 text-ink [&_svg]:size-6"
      >
        <ClipboardTextIcon />
      </span>
      <span className="grid min-w-0 gap-0.5">
        <span className="flex flex-wrap items-center gap-2 text-item-title text-ink">
          {COPY.title}
          <CountBadge count={count} label="jobs" />
        </span>
        <span className="text-meta text-ink-muted">{COPY.body}</span>
      </span>
      <CaretRightIcon aria-hidden weight="bold" className="size-5 text-ink" />
    </Link>
  )
}
