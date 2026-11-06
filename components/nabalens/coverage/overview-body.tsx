import Link from "next/link"
import { ClockCountdownIcon, WarningIcon } from "@phosphor-icons/react/dist/ssr"

import { OfflineNotice } from "../offline-notice"
import { Notice } from "../notice"
import { StatusChip } from "../status-chip"
import { buttonVariants } from "@/components/ui/button"

import { SETUP_ISSUE_LABEL, labelFor, plural } from "./copy"
import {
  CoverageSection,
  Frames,
  ItemList,
  ItemRow,
  Tally,
  TallyItem,
} from "./layout"
import type { ManageHrefs } from "./manage-nav"
import type {
  MonthlyProgress,
  PeriodView,
  RequirementView,
  VenueCoverageSummary,
} from "./types"

/** The overview lists a few items; the checklist has them all. */
export const ATTENTION_SHOWN = 6

export type Participation = {
  total: number
  met: number
  accepted: number
  needSetup: number
  /** Someone has no FOH/BOH team yet. */
  teamMissing: boolean
}

/**
 * People at this venue for the month. Kept apart from venue coverage: a
 * person's target never counts toward the checklist.
 */
export function participationOf(roster: MonthlyProgress[]): Participation {
  const members = roster.filter((r) => r.isCurrentMember)
  const setup = members.filter((r) => r.status === "needs_setup")
  return {
    total: members.length,
    met: members.filter((r) => r.complete).length,
    accepted: members.reduce((n, r) => n + r.accepted, 0),
    needSetup: setup.length,
    teamMissing: setup.some((r) => r.setupMissing.includes("team")),
  }
}

export type PreparationState =
  | { kind: "ready" }
  | { kind: "unprepared" }
  | {
      kind: "failed"
      /** People with a target this month, out of everyone at the venue. */
      copied: number
      total: number
    }

/** "November 2026" → "November". */
export const monthName = (label: string) => label.split(" ")[0]

function amenityNote(count: number) {
  return count === 1
    ? "1 amenity needs verification"
    : `${count} amenities need verification`
}

function issuesOf(r: RequirementView): string[] {
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

function AttentionRow({
  requirement: r,
  href,
}: {
  requirement: RequirementView
  href: string
}) {
  const overdue = r.status === "active" && r.progress.overdue
  const names = r.assignees.map((p) => p.displayName).join(", ")
  const meta = [names, r.due?.label].filter(Boolean)
  return (
    <ItemRow
      title={r.title}
      href={href}
      chip={
        overdue ? (
          <StatusChip state="overdue" />
        ) : (
          <StatusChip state="needs_setup" />
        )
      }
      issues={issuesOf(r)}
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

/**
 * The overview below the header: notices, venue coverage and staff
 * participation (counted separately), then what needs the manager.
 */
export function OverviewBody({
  venueName,
  period,
  previousMonth,
  summary,
  attention,
  hrefs,
  participation,
  preparation,
  retry,
  menuChange,
}: {
  venueName: string
  period: PeriodView
  /** "October": the month preparing copies from. */
  previousMonth: string
  summary: VenueCoverageSummary
  /** Every checklist item that needs the manager, most urgent first. */
  attention: RequirementView[]
  hrefs: ManageHrefs
  participation: Participation
  preparation: PreparationState
  /** The "Try again" control inside the failed-preparation notice. */
  retry?: React.ReactNode
  /** Set when the venue's menu changed; `changedOn` is "1 Nov 2026" when known. */
  menuChange: { changedOn: string | null } | null
}) {
  const month = monthName(period.label)
  const shown = attention.slice(0, ATTENTION_SHOWN)
  const allDone =
    summary.complete && attention.length === 0 && preparation.kind === "ready"
  const checklistDone =
    summary.applicable > 0 && summary.satisfied === summary.applicable
  const staffNote =
    preparation.kind === "unprepared"
      ? `${participation.needSetup} ${month} ${participation.needSetup === 1 ? "target" : "targets"} not set yet`
      : participation.teamMissing
        ? "No team assigned"
        : "Target not set"

  return (
    <>
      <OfflineNotice />

      {preparation.kind === "unprepared" ? (
        <Notice tone="attention" title={`${month} isn’t prepared yet`}>
          <p>
            Targets and checklist items haven’t been copied from {previousMonth}{" "}
            yet. Preparing copies {previousMonth}’s targets at {venueName}; new
            starters show Needs setup.
          </p>
        </Notice>
      ) : null}

      {preparation.kind === "failed" ? (
        <Notice
          tone="negative"
          title={`Preparing ${month} didn’t finish`}
          action={retry}
        >
          <p>
            {preparation.total > preparation.copied
              ? `Targets were copied for ${preparation.copied} of ${plural(preparation.total, "person", "people")}. ${preparation.total - preparation.copied} need you to set them on Team.`
              : "Some targets may not have been copied. Check Team, then try again."}
          </p>
        </Notice>
      ) : null}

      {menuChange ? (
        <Notice tone="attention" title="Menu changed — review coverage">
          <p>
            {venueName}’s food menu changed
            {menuChange.changedOn ? ` on ${menuChange.changedOn}` : ""}. Nothing
            carries over automatically, so menu sections need you to decide what
            still applies.
          </p>
        </Notice>
      ) : null}

      {allDone ? (
        <p
          role="status"
          className="text-body-touch text-ink-muted md:text-body"
        >
          Everything at {venueName} is complete for {month}. New photos still
          appear in Review as they’re sent.
        </p>
      ) : null}

      <div className="grid gap-6 md:grid-cols-2 md:gap-8">
        <CoverageSection
          id="venue-coverage"
          title="Venue coverage"
          count={summary.complete ? "Complete" : "Not complete yet"}
        >
          <Tally>
            <TallyItem
              label="Checklist complete"
              value={summary.satisfied}
              of={summary.applicable}
              tone={checklistDone ? "positive" : "neutral"}
              href={hrefs.checklist}
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
              href={hrefs.checklist}
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
              href={hrefs.checklist}
            />
          </Tally>
        </CoverageSection>

        <CoverageSection
          id="staff-participation"
          title="Staff participation"
          count={period.label}
        >
          <Tally>
            <TallyItem
              label="Met their target"
              value={participation.met}
              of={participation.total}
              tone={participation.met > 0 ? "positive" : "zero"}
              href={hrefs.team}
            />
            <TallyItem
              label="Photos accepted"
              value={participation.accepted}
              href={hrefs.team}
            />
            <TallyItem
              label="Need setup"
              value={participation.needSetup}
              tone="attention"
              icon={WarningIcon}
              note={participation.needSetup > 0 ? staffNote : undefined}
              href={hrefs.team}
            />
          </Tally>
        </CoverageSection>
      </div>

      {allDone ? null : (
        <CoverageSection
          id="attention"
          title="Needs your attention"
          count={attention.length > 0 ? String(attention.length) : undefined}
          action={
            attention.length > shown.length ? (
              <Link
                href={hrefs.checklist}
                className={buttonVariants({ variant: "quiet", size: "sm" })}
              >
                See all {attention.length} on the checklist
              </Link>
            ) : undefined
          }
        >
          {shown.length > 0 ? (
            <ItemList label="Needs your attention">
              {shown.map((r) => (
                <AttentionRow
                  key={r.id}
                  requirement={r}
                  href={hrefs.requirement(r.id)}
                />
              ))}
            </ItemList>
          ) : (
            <p className="text-body-touch text-ink-muted md:text-body">
              Nothing needs setup, reassignment or follow-up.
            </p>
          )}
        </CoverageSection>
      )}
    </>
  )
}
