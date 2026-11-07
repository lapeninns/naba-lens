import Link from "next/link"
import { CaretRightIcon } from "@phosphor-icons/react/dist/ssr"

import {
  EVIDENCE_RULE_LABEL,
  PROGRESS_LABEL,
  UI_TEXT,
  staffCaptureHref,
  type MyAmenityTask,
} from "@/lib/amenities/contract"

import { CountBadge, StatusChip } from "../../status-chip"

/**
 * Staff Home: amenity checks assigned to me that still need capturing, recheck
 * first with the manager's reason. Nothing to do renders nothing.
 */
export function AmenityTaskList({ tasks }: { tasks: MyAmenityTask[] }) {
  if (tasks.length === 0) return null
  const ordered = [...tasks].sort(
    (a, b) =>
      Number(b.progress === "needs_recheck") -
        Number(a.progress === "needs_recheck") ||
      a.entry.position - b.entry.position
  )
  return (
    <section
      aria-labelledby="amenity-checks-heading"
      className="flex flex-col gap-3"
    >
      <h2
        id="amenity-checks-heading"
        className="flex items-center gap-2 font-display text-2xl break-words text-ink"
      >
        {UI_TEXT.staffSection}
        <CountBadge count={tasks.length} label="to capture" />
      </h2>
      <ul
        aria-label={UI_TEXT.staffSection}
        className="grid gap-3 sm:grid-cols-2"
      >
        {ordered.map((task) => (
          <li
            key={task.id}
            className="relative flex min-w-0 flex-col gap-2 rounded-xl border bg-card p-4 transition-colors hover:bg-muted/40 has-[a:focus-visible]:ring-3 has-[a:focus-visible]:ring-ring/50"
          >
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                {task.entry.category}
              </span>
              <StatusChip
                tone={
                  task.progress === "needs_recheck" ? "attention" : "pending"
                }
              >
                {PROGRESS_LABEL[task.progress]}
              </StatusChip>
            </div>
            <h3 className="font-semibold break-words">
              {/* The whole card is the link target; the question stays the title. */}
              <Link
                href={staffCaptureHref(task.id)}
                className="outline-none after:absolute after:inset-0 after:rounded-xl"
              >
                {task.entry.question}
              </Link>
            </h3>
            {task.progress === "needs_recheck" && task.recheckReason ? (
              <p className="text-body-touch break-words md:text-body-sm">
                <span className="font-medium">Recheck reason:</span>{" "}
                {task.recheckReason}
              </p>
            ) : null}
            <div className="mt-auto flex items-center justify-between gap-3">
              <span className="text-meta-touch text-ink-muted md:text-meta">
                Evidence: {EVIDENCE_RULE_LABEL[task.entry.evidenceRule]}
              </span>
              <CaretRightIcon
                className="size-4 shrink-0 text-muted-foreground"
                aria-hidden
              />
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}
