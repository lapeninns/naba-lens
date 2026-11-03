import Link from "next/link"
import {
  ClockCountdownIcon,
  ForkKnifeIcon,
  WarningIcon,
} from "@phosphor-icons/react/dist/ssr"

import { EmptyState } from "../empty-state"
import { Notice } from "../notice"
import { OfflineNotice } from "../offline-notice"
import { StatusChip } from "../status-chip"
import { buttonVariants } from "@/components/ui/button"

import { REQUIREMENT_KIND_LABEL, SETUP_ISSUE_LABEL, labelFor } from "./copy"
import {
  CoverageSection,
  Frames,
  ItemList,
  ItemRow,
  Tally,
  TallyItem,
} from "./layout"
import type { ManageHrefs } from "./manage-nav"
import { bySurname } from "./team-roster"
import type {
  RequirementKind,
  RequirementView,
  VenueCoverageSummary,
} from "./types"

/** The order the checklist is drawn in: what the manager sets up most first. */
export const CHECKLIST_KIND_ORDER: RequirementKind[] = [
  "amenity",
  "venue_specific",
  "service",
  "menu_section",
]

const isClosed = (r: RequirementView) =>
  r.status === "not_applicable" || r.status === "retired"

const isApplicable = (r: RequirementView) =>
  r.status === "active" || r.status === "needs_setup"

/** Needs setup first, then follow-up, then the rest; closed items last. */
function rank(r: RequirementView): number {
  if (r.status === "needs_setup") return 0
  if (r.needsReassignment) return 1
  if (r.status === "active" && r.progress.overdue) return 2
  if (isClosed(r)) return 4
  return 3
}

/** The one state word a row shows, most urgent first. */
export function RequirementChip({
  requirement: r,
}: {
  requirement: RequirementView
}) {
  if (r.status === "retired") return <StatusChip state="retired" />
  if (r.status === "not_applicable")
    return <StatusChip state="not_applicable" />
  if (r.status === "needs_setup") return <StatusChip state="needs_setup" />
  if (r.needsReassignment) return <StatusChip state="needs_reassignment" />
  if (r.progress.overdue) return <StatusChip state="overdue" />
  if (r.progress.satisfied) return <StatusChip state="complete" />
  return <StatusChip tone="neutral">In progress</StatusChip>
}

/** Setup problems in the manager's words; nothing for closed items. */
export function requirementIssues(r: RequirementView): string[] {
  if (isClosed(r)) return []
  const keys = r.setupIssues.filter(
    (i) =>
      r.status === "needs_setup" ||
      i === "no_assignees" ||
      i === "needs_reassignment"
  )
  if (r.needsReassignment && !keys.includes("needs_reassignment"))
    keys.push("needs_reassignment")
  return keys.map((k) => labelFor(SETUP_ISSUE_LABEL, k))
}

function withStop(text: string) {
  return /[.!?]$/.test(text.trim()) ? text.trim() : `${text.trim()}.`
}

function ChecklistRow({
  requirement: r,
  href,
}: {
  requirement: RequirementView
  href: string
}) {
  const closed = isClosed(r)
  const names = r.assignees.map((p) => p.displayName).sort(bySurname)
  const presence = r.amenity?.presence
  const overdue = r.status === "active" && r.progress.overdue
  const meta: React.ReactNode[] = []
  if (closed) {
    meta.push(
      r.statusReason
        ? `${withStop(r.statusReason)} Not counted.`
        : "Not counted."
    )
  } else {
    if (presence && presence !== "unknown" && r.status === "active")
      meta.push(<StatusChip key="presence" state={presence} />)
    if (names.length > 0) meta.push(names.join(", "))
    if (r.due)
      meta.push(
        overdue ? `${r.due.label} · photos can still be sent` : r.due.label
      )
  }
  return (
    <ItemRow
      title={r.title}
      href={href}
      closed={closed}
      chip={<RequirementChip requirement={r} />}
      issues={requirementIssues(r)}
      meta={
        meta.length > 0
          ? meta.map((m, i) => <span key={i}>{m}</span>)
          : undefined
      }
      aside={
        r.status === "active" ? (
          <Frames
            compact
            accepted={r.progress.accepted}
            target={r.progress.target}
            pending={r.progress.pending}
          />
        ) : undefined
      }
    />
  )
}

function groupCount(items: RequirementView[]): string {
  const applicable = items.filter(isApplicable)
  const parts = [
    `${applicable.filter((r) => r.progress.satisfied).length} of ${applicable.length} complete`,
  ]
  const setup = items.filter((r) => r.status === "needs_setup").length
  if (setup > 0) parts.push(`${setup} ${setup === 1 ? "needs" : "need"} setup`)
  const na = items.filter((r) => r.status === "not_applicable").length
  if (na > 0) parts.push(`${na} not applicable`)
  const retired = items.filter((r) => r.status === "retired").length
  if (retired > 0) parts.push(`${retired} retired`)
  return parts.join(" · ")
}

function amenityNote(count: number) {
  return count === 1
    ? "1 amenity needs verification"
    : `${count} amenities need verification`
}

/**
 * Every checklist item at one venue, grouped by kind, needing-setup first.
 * Not-applicable and retired items stay listed with their reason and are
 * outside every count.
 */
export function ChecklistBody({
  venueName,
  month,
  summary,
  requirements,
  hrefs,
  addItem,
  menuChange,
}: {
  venueName: string
  /** "November". */
  month: string
  summary: VenueCoverageSummary
  requirements: RequirementView[]
  hrefs: ManageHrefs
  /** The "Add a venue-specific item" control. */
  addItem: React.ReactNode
  /** Set when the venue's menu changed; `changedOn` is "1 Nov 2026" when known. */
  menuChange: { changedOn: string | null } | null
}) {
  if (requirements.length === 0) {
    return (
      <>
        <OfflineNotice />
        <EmptyState
          title="No checklist items yet"
          description={`An admin sets up ${venueName}'s standard checklist. You can add a venue-specific item now.`}
          action={addItem}
        />
      </>
    )
  }

  const allDone =
    summary.applicable > 0 &&
    summary.satisfied === summary.applicable &&
    summary.needsSetup === 0 &&
    !requirements.some((r) => r.needsReassignment)

  const groups = CHECKLIST_KIND_ORDER.map((kind) => ({
    kind,
    items: requirements
      .filter((r) => r.kind === kind)
      .sort((a, b) => rank(a) - rank(b)),
  })).filter(
    (g) =>
      g.items.length > 0 ||
      g.kind === "venue_specific" ||
      (g.kind === "menu_section" && menuChange)
  )

  return (
    <>
      <OfflineNotice />

      {allDone ? (
        <p
          role="status"
          className="text-body-touch text-ink-muted md:text-body"
        >
          Every counted item at {venueName} is complete for {month}. New photos
          still appear in Review as they&apos;re sent.
        </p>
      ) : null}

      <Tally>
        <TallyItem
          label="Checklist complete"
          value={summary.satisfied}
          of={summary.applicable}
          tone={allDone ? "positive" : "neutral"}
        />
        <TallyItem
          label="Need setup"
          value={summary.needsSetup}
          tone="attention"
          icon={WarningIcon}
          note={
            summary.amenityUnknown > 0
              ? amenityNote(summary.amenityUnknown)
              : undefined
          }
        />
        <TallyItem
          label="To review"
          value={summary.pendingReview}
          href={hrefs.review}
        />
        <TallyItem
          label="Overdue"
          value={summary.overdue}
          tone="negative"
          icon={ClockCountdownIcon}
        />
      </Tally>

      {groups.map(({ kind, items }) => {
        const label = labelFor(REQUIREMENT_KIND_LABEL, kind)
        return (
          <CoverageSection
            key={kind}
            id={`checklist-${kind}`}
            title={label}
            count={items.length > 0 ? groupCount(items) : undefined}
          >
            {kind === "menu_section" && menuChange ? (
              <Notice
                tone="attention"
                title="Menu changed — review coverage"
                action={
                  <Link
                    href={hrefs.menu}
                    className={buttonVariants({
                      variant: "primary",
                      size: "sm",
                    })}
                  >
                    <ForkKnifeIcon data-icon="inline-start" aria-hidden />
                    Review menu coverage
                  </Link>
                }
              >
                <p>
                  The food menu changed
                  {menuChange.changedOn ? ` on ${menuChange.changedOn}` : ""}.
                  Nothing carries over automatically.
                </p>
              </Notice>
            ) : null}
            {items.length > 0 ? (
              <ItemList label={label}>
                {items.map((r) => (
                  <ChecklistRow
                    key={r.id}
                    requirement={r}
                    href={hrefs.requirement(r.id)}
                  />
                ))}
              </ItemList>
            ) : null}
            {kind === "venue_specific" ? <div>{addItem}</div> : null}
          </CoverageSection>
        )
      })}
    </>
  )
}
