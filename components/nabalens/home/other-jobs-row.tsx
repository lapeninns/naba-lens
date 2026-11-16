import Link from "next/link"
import {
  CaretRightIcon,
  ClipboardTextIcon,
} from "@phosphor-icons/react/dist/ssr"

import { CountBadge } from "../status-chip"
import { OTHER_JOBS_COPY as COPY } from "../tasks/copy"

/**
 * Decision 10: one row, only when the person has non-menu requirements or
 * amenity checks or working-list questions waiting on them, linking to the
 * one list page of those jobs (G-4, `/staff/tasks/other`). Menu sections are
 * never counted here.
 */
export function OtherJobsRow({
  count,
  href = "/staff/tasks/other",
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
          <CountBadge count={count} label={COPY.countLabel} />
        </span>
        <span className="text-meta text-ink-muted">{COPY.body}</span>
      </span>
      <CaretRightIcon aria-hidden weight="bold" className="size-5 text-ink" />
    </Link>
  )
}
