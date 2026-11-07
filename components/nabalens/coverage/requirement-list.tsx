import Link from "next/link"
import { CaretRightIcon } from "@phosphor-icons/react/dist/ssr"

import { EmptyState } from "@/components/nabalens/empty-state"

import {
  REQUIREMENT_KIND_LABEL,
  REQUIREMENT_KIND_ORDER,
  SETUP_ISSUE_LABEL,
  labelFor,
  plural,
} from "./copy"
import {
  CoverageBadge,
  OverdueBadge,
  PresenceBadge,
  RequirementStatusBadge,
} from "./coverage-badges"
import { PhotoProgress } from "./photo-progress"
import type { RequirementKind, RequirementView } from "./types"

function assigneeText(requirement: RequirementView): string {
  const names = requirement.assignees.map((p) => p.displayName)
  if (names.length === 0) return "No one assigned"
  if (names.length <= 2) return `Assigned: ${names.join(", ")}`
  return `Assigned: ${names.slice(0, 2).join(", ")} and ${names.length - 2} more`
}

function RequirementRow({
  requirement,
  href,
}: {
  requirement: RequirementView
  href: string
}) {
  const { status, progress } = requirement
  const excluded = status === "not_applicable" || status === "retired"
  const blocking = requirement.setupIssues.filter(
    (i) => i !== "no_assignees" && i !== "needs_reassignment"
  )
  return (
    <li>
      <Link
        href={href}
        className="flex min-h-16 items-start gap-3 p-3 text-ink no-underline -outline-offset-3 transition-colors duration-(--duration-quick) hover:bg-surface-2 md:px-4"
      >
        <span className="grid min-w-0 flex-1 gap-1.5">
          <span className="flex min-w-0 flex-wrap items-center gap-2">
            <span className="min-w-0 text-item-title [overflow-wrap:anywhere]">
              {requirement.title}
            </span>
            <RequirementStatusBadge
              status={status}
              satisfied={progress.satisfied}
            />
            {requirement.amenity ? (
              <PresenceBadge
                presence={requirement.amenity.presence ?? "unknown"}
              />
            ) : null}
            {progress.overdue && !excluded ? <OverdueBadge /> : null}
            {requirement.needsReassignment ? (
              <CoverageBadge tone="warning">Needs reassignment</CoverageBadge>
            ) : null}
          </span>
          {excluded ? (
            <span className="text-meta text-ink-muted">
              Not counted
              {requirement.statusReason
                ? `. Reason: ${requirement.statusReason}`
                : null}
            </span>
          ) : (
            <>
              {status === "active" ? (
                <PhotoProgress
                  accepted={progress.accepted}
                  target={requirement.photoTarget}
                  pending={progress.pending}
                  className="max-w-xs"
                />
              ) : (
                <span className="text-meta text-ink-muted">
                  Suggested target {plural(requirement.photoTarget, "photo")},
                  not confirmed yet
                </span>
              )}
              <span className="text-meta text-ink-muted">
                {[requirement.due?.label ?? null, assigneeText(requirement)]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
              {blocking.length > 0 ? (
                <span className="text-meta font-bold text-warn-fg">
                  {blocking
                    .map((issue) => labelFor(SETUP_ISSUE_LABEL, issue))
                    .join(". ")}
                </span>
              ) : null}
            </>
          )}
        </span>
        <CaretRightIcon
          weight="bold"
          className="mt-1 size-5 shrink-0 text-ink-muted"
          aria-hidden
        />
      </Link>
    </li>
  )
}

/**
 * A venue's checklist grouped by kind. Not-applicable items stay visible with
 * their reason but are outside the applicable count.
 */
export function RequirementList({
  requirements,
  hrefFor,
  kinds = REQUIREMENT_KIND_ORDER,
  emptyTitle = "No checklist items yet.",
  showCounts = true,
}: {
  requirements: RequirementView[]
  hrefFor: (id: string) => string
  kinds?: RequirementKind[]
  emptyTitle?: string
  /** Off when `requirements` is a selection, where group counts would mislead. */
  showCounts?: boolean
}) {
  const groups = kinds
    .map((kind) => ({
      kind,
      items: requirements.filter((r) => r.kind === kind),
    }))
    .filter((group) => group.items.length > 0)

  if (groups.length === 0) return <EmptyState title={emptyTitle} />

  return (
    <div className="grid gap-4">
      {groups.map((group) => {
        const applicable = group.items.filter(
          (r) => r.status === "active" || r.status === "needs_setup"
        )
        const satisfied = applicable.filter((r) => r.progress.satisfied)
        const titleId = `checklist-${group.kind}`
        return (
          <section
            key={group.kind}
            aria-labelledby={titleId}
            className="grid gap-2"
          >
            <h3
              id={titleId}
              className="flex flex-wrap items-baseline gap-x-3 px-1 font-display text-section-title text-ink"
            >
              {labelFor(REQUIREMENT_KIND_LABEL, group.kind)}
              {showCounts ? (
                <span className="font-sans text-meta font-normal text-ink-muted tabular-nums">
                  {satisfied.length} of{" "}
                  {plural(applicable.length, "applicable item")} complete
                </span>
              ) : null}
            </h3>
            <ul
              aria-label={labelFor(REQUIREMENT_KIND_LABEL, group.kind)}
              className="grid divide-y divide-line overflow-hidden rounded-card bg-surface shadow-card"
            >
              {group.items.map((requirement) => (
                <RequirementRow
                  key={requirement.id}
                  requirement={requirement}
                  href={hrefFor(requirement.id)}
                />
              ))}
            </ul>
          </section>
        )
      })}
    </div>
  )
}
