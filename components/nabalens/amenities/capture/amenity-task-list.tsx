import Link from "next/link"
import { CaretRightIcon } from "@phosphor-icons/react/dist/ssr"

import {
  EVIDENCE_RULE_LABEL,
  PROGRESS_LABEL,
  UI_TEXT,
  staffCaptureHref,
  type MyAmenityTask,
} from "@/lib/amenities/contract"
import { cn } from "@/lib/utils"

import { CountBadge, StatusChip } from "../../status-chip"

/** Recheck first (a manager is waiting on it), then catalogue order. */
export function orderAmenityTasks(
  tasks: readonly MyAmenityTask[]
): MyAmenityTask[] {
  return [...tasks].sort(
    (a, b) =>
      Number(b.progress === "needs_recheck") -
        Number(a.progress === "needs_recheck") ||
      a.entry.position - b.entry.position
  )
}

/**
 * Staff Home: amenity checks assigned to me that still need capturing, recheck
 * first with the manager's reason. Nothing to do renders nothing. `heading`
 * renames the section, so Home has one "Amenity checks" when the working list
 * is shown too (HM-11).
 */
export function AmenityTaskList({
  tasks,
  heading = UI_TEXT.staffSection,
}: {
  tasks: MyAmenityTask[]
  heading?: string
}) {
  if (tasks.length === 0) return null
  const ordered = orderAmenityTasks(tasks)
  return (
    <section
      aria-labelledby="amenity-checks-heading"
      className="grid scroll-mt-4 gap-(--gutter)"
    >
      <div className="px-1 pt-2">
        <h2
          id="amenity-checks-heading"
          className="flex items-center gap-2 font-display text-section-title [overflow-wrap:anywhere] text-ink"
        >
          {heading}
          <CountBadge count={tasks.length} label="to capture" />
        </h2>
      </div>
      <ul aria-label={heading} className="grid gap-(--gutter)">
        {ordered.map((task) => {
          const recheck = task.progress === "needs_recheck"
          return (
            <li
              key={task.id}
              className={cn(
                "relative grid min-w-0 gap-2 rounded-card bg-surface p-4 shadow-card transition-colors duration-(--duration-quick) hover:bg-surface-2 has-[a:focus-visible]:outline-3 has-[a:focus-visible]:outline-offset-2 has-[a:focus-visible]:outline-focus has-[a:focus-visible]:outline-solid",
                recheck &&
                  "shadow-[var(--elevation-card),inset_4px_0_0_var(--warn-fg)]"
              )}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="min-w-0 text-meta font-semibold [overflow-wrap:anywhere] text-ink-muted">
                  {task.entry.category}
                </span>
                <StatusChip tone={recheck ? "attention" : "pending"}>
                  {PROGRESS_LABEL[task.progress]}
                </StatusChip>
              </div>
              <h3 className="text-item-title [overflow-wrap:anywhere] text-ink">
                {/* The whole card is the link target; the question stays the title. */}
                <Link
                  href={staffCaptureHref(task.id)}
                  className="outline-none after:absolute after:inset-0 after:rounded-card"
                >
                  {task.entry.question}
                </Link>
              </h3>
              {recheck && task.recheckReason ? (
                <p className="text-body [overflow-wrap:anywhere] text-ink">
                  <span className="font-semibold">Recheck reason:</span>{" "}
                  {task.recheckReason}
                </p>
              ) : null}
              <div className="flex items-center justify-between gap-3">
                <span className="text-meta text-ink-muted">
                  Evidence: {EVIDENCE_RULE_LABEL[task.entry.evidenceRule]}
                </span>
                <CaretRightIcon
                  className="size-5 shrink-0 text-ink-muted"
                  aria-hidden
                />
              </div>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
