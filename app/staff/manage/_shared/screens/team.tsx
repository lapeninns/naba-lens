import Link from "next/link"
import {
  CaretLeftIcon,
  CaretRightIcon,
  CheckIcon,
  PencilSimpleIcon,
} from "@phosphor-icons/react/dist/ssr"

import {
  EvidencePreviewButton,
  Frames,
  TeamPerson,
  localDateLabel,
  manageHrefs,
  monthName,
  targetSourceText,
  type MonthlyProgress,
  type PeriodKey,
  type PeriodView,
  type SubmissionView,
} from "@/components/nabalens/coverage"
import { formatDate } from "@/components/nabalens/format"
import { Notice } from "@/components/nabalens/notice"
import { OfflineNotice } from "@/components/nabalens/offline-notice"
import { StatusChip } from "@/components/nabalens/status-chip"
import { Button, buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { getStaffMonth, getVenueRoster } from "@/lib/server/coverage"
import {
  isPeriodKey,
  periodKeyOf,
  periodView,
  shiftPeriod,
} from "@/lib/server/coverage/time"

import { type ManageContext } from "../context"
import {
  PrepareMonthControl,
  ReviewQueueControl,
  TeamRosterControl,
} from "../controls"
import { ManageFrame } from "../frame"

import { failed, param, type ManageSearch } from "./common"

function teamHref(
  basePath: string,
  period: PeriodKey,
  current: PeriodKey,
  staffId?: string
) {
  const hrefs = manageHrefs(basePath)
  if (staffId) return `${hrefs.staff(staffId)}&period=${period}`
  return period === current ? hrefs.team : `${hrefs.team}?period=${period}`
}

function firstName(name: string) {
  return name.trim().split(/\s+/)[0] ?? name
}

/** A white card on the canvas (DESIGN.md §4). */
const CARD = "grid min-w-0 gap-3 rounded-card bg-surface p-4 shadow-card"
/** A titled block of the feed: heading on the canvas, cards under it. */
const SECTION =
  "grid min-w-0 gap-(--gutter) [&>h2]:px-1 [&>h2]:pt-2 [&>div:first-child]:px-1 [&>div:first-child]:pt-2"

/** Previous and next month, with Read-only on a past month (`nl-month`). */
function MonthStepper({
  basePath,
  period,
  current,
  showFollowing,
  staffId,
}: {
  basePath: string
  period: PeriodView
  current: PeriodKey
  showFollowing: boolean
  staffId?: string
}) {
  const previous = shiftPeriod(period.key, -1)
  const following = shiftPeriod(period.key, 1)
  const icon = buttonVariants({ variant: "ghost", size: "icon" })
  return (
    <div
      role="group"
      aria-label="Month"
      className="flex flex-wrap items-center gap-1"
    >
      <Link
        href={teamHref(basePath, previous, current, staffId)}
        aria-label={`Previous month, ${periodView(previous).label}`}
        className={icon}
      >
        <CaretLeftIcon aria-hidden className="size-5" />
      </Link>
      <span
        aria-current={period.key === current ? "date" : undefined}
        className="min-w-[9.5em] text-center font-display text-label text-ink tabular-nums"
      >
        {period.label}
      </span>
      {showFollowing ? (
        <Link
          href={teamHref(basePath, following, current, staffId)}
          aria-label={`Next month, ${periodView(following).label}`}
          className={icon}
        >
          <CaretRightIcon aria-hidden className="size-5" />
        </Link>
      ) : (
        <Button
          variant="ghost"
          size="icon"
          disabled
          aria-label="Next month (not started)"
        >
          <CaretRightIcon aria-hidden className="size-5" />
        </Button>
      )}
      {period.key < current ? (
        <StatusChip state="read_only" className="ms-2" />
      ) : null}
    </div>
  )
}

export async function TeamScreen({
  ctx,
  search,
}: {
  ctx: ManageContext
  search: ManageSearch
}) {
  const current = periodKeyOf(new Date())
  const requested = param(search, "period")
  const period = requested && isPeriodKey(requested) ? requested : current
  const staffId = param(search, "staff")
  const [roster, month] = await Promise.all([
    getVenueRoster(ctx.actor, { venueId: ctx.venueId, period }),
    staffId
      ? getStaffMonth(ctx.actor, { venueId: ctx.venueId, staffId, period })
      : Promise.resolve(null),
  ])
  if (!roster.ok) return failed(ctx, roster)
  if (month && !month.ok && month.code !== "not_found")
    return failed(ctx, month)
  const isAdmin = ctx.mode === "admin"
  const next = shiftPeriod(current, 1)
  const canEdit = isAdmin || (period >= current && period <= next)
  const past = period < current
  const showFollowing = isAdmin || shiftPeriod(period, 1) <= next
  const name = monthName(period)
  const scopeMonth = period !== current ? roster.period.label : undefined
  const venue = ctx.venue.name

  if (staffId) {
    const personMonth = month?.ok ? month.month : null
    const row =
      personMonth?.monthly ??
      roster.roster.find((r) => r.person.id === staffId) ??
      null
    return (
      <ManageFrame
        ctx={ctx}
        section="team"
        title={row?.person.displayName ?? "Person"}
        month={scopeMonth}
        pendingReview={ctx.coverage?.summary.pendingReview}
      >
        <OfflineNotice />
        <MonthStepper
          basePath={ctx.basePath}
          period={roster.period}
          current={current}
          showFollowing={showFollowing}
          staffId={staffId}
        />
        <PersonMonth
          ctx={ctx}
          period={roster.period}
          current={current}
          row={row}
          submissions={personMonth?.submissions ?? []}
          canSetTarget={canEdit && !past}
        />
      </ManageFrame>
    )
  }

  const unprepared =
    period === current &&
    roster.roster.some((r) => r.isCurrentMember && r.targetId == null)
  const summary = past
    ? isAdmin
      ? undefined
      : `${name} is read-only. Only an admin can correct a past month, with a reason.`
    : isAdmin
      ? `Each person's ${name} target at ${venue}. A person's month is never added to the venue's checklist.`
      : period === current
        ? `Each person's photo target at ${venue} this month. It counts their accepted photos only, separately from the checklist.`
        : `Each person's photo target at ${venue} in ${name}. It counts their accepted photos only, separately from the checklist.`

  return (
    <ManageFrame
      ctx={ctx}
      section="team"
      title="Team"
      summary={summary}
      month={scopeMonth}
      actions={
        period === current ? (
          <PrepareMonthControl
            venueId={ctx.venueId}
            period={current}
            venueName={venue}
            available={unprepared}
          />
        ) : undefined
      }
      pendingReview={ctx.coverage?.summary.pendingReview}
    >
      <OfflineNotice />
      {unprepared ? (
        <Notice tone="attention" title={`${name} isn't prepared yet`}>
          {monthName(shiftPeriod(period, -1))}&apos;s targets haven&apos;t been
          copied yet. Preparing copies them; new starters show Needs setup. You
          can still set targets below now: preparing keeps them.
        </Notice>
      ) : null}
      <MonthStepper
        basePath={ctx.basePath}
        period={roster.period}
        current={current}
        showFollowing={showFollowing}
      />
      {past && isAdmin ? (
        <Notice>
          {name} is read-only for managers. Admins can correct a target, with a
          reason; the row then shows Corrected by an admin.
        </Notice>
      ) : null}
      <TeamRosterControl
        period={roster.period}
        currentPeriod={current}
        rows={roster.roster}
        canEdit={canEdit}
        isAdmin={isAdmin}
        basePath={ctx.basePath}
        venueId={ctx.venueId}
        venueName={venue}
      />
    </ManageFrame>
  )
}

function stateWord(state: string) {
  return state === "needs_another_photo"
    ? "Needs another photo"
    : state.charAt(0).toUpperCase() + state.slice(1)
}

/**
 * One person's month at this venue (M8). Their month is never added to the
 * venue's checklist; photos from another venue stay with that venue.
 */
function PersonMonth({
  ctx,
  period,
  current,
  row,
  submissions,
  canSetTarget,
}: {
  ctx: ManageContext
  period: PeriodView
  current: PeriodKey
  row: MonthlyProgress | null
  submissions: SubmissionView[]
  canSetTarget: boolean
}) {
  const name = monthName(period.key)
  const past = period.key < current
  const first = row ? firstName(row.person.displayName) : "This person"
  const toReview = submissions.filter((s) => s.state === "submitted")
  const late = submissions.filter(
    (s) => s.state === "accepted" && s.decision?.lateAcceptance
  )
  const hasTarget = row?.targetCount != null
  const muted = "px-1 text-body text-ink-muted"

  let targetBody: React.ReactNode
  if (row && row.targetCount != null) {
    const target = row.targetCount
    const toTake = Math.max(0, target - row.accepted - row.pending)
    const source = targetSourceText(row, period.key, past ? "past" : "current")
    const dueText = row.due
      ? past
        ? `Was due ${localDateLabel(row.due.dueOn)}`
        : row.due.label
      : null
    const chip =
      row.status === "needs_setup" ? (
        <StatusChip state="needs_setup" />
      ) : row.complete ? (
        <StatusChip state="target_met" />
      ) : row.due?.overdue && !past ? (
        <StatusChip state="overdue" />
      ) : null
    targetBody = (
      <div className={cn(CARD)}>
        <div className="grid gap-2">
          <Frames
            accepted={row.accepted}
            target={target}
            pending={row.pending}
            chip={chip}
          />
          {!past && (row.pending > 0 || toTake > 0) ? (
            <p className="flex flex-wrap gap-x-4 gap-y-1 text-meta text-ink-muted tabular-nums">
              {row.pending > 0 ? (
                <span className="inline-flex items-center gap-1.5">
                  <i
                    aria-hidden
                    className="block h-2.5 w-[22px] rounded-round bg-stripe"
                  />
                  {row.complete
                    ? `${row.pending} more waiting for review`
                    : `${row.pending} waiting for review`}
                </span>
              ) : null}
              {toTake > 0 ? (
                <span className="inline-flex items-center gap-1.5">
                  <i
                    aria-hidden
                    className="block h-2.5 w-[22px] rounded-round bg-surface-2 shadow-[inset_0_0_0_1px_var(--border-strong)]"
                  />
                  {toTake} to take
                </span>
              ) : null}
            </p>
          ) : null}
        </div>
        {dueText || source ? (
          <p className="border-t border-line pt-3 text-meta text-ink-muted">
            {[
              dueText,
              source
                ? dueText
                  ? source.charAt(0).toLowerCase() + source.slice(1)
                  : source
                : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        ) : null}
      </div>
    )
  } else {
    const missingTeam = !row || row.setupMissing.includes("team")
    targetBody = (
      <div className={cn(CARD)}>
        <p>
          <StatusChip state="needs_setup" />
        </p>
        <p className="text-body text-ink">
          {past
            ? `No target for ${name}.`
            : `No target for ${name} yet. You set it on Team${
                missingTeam ? `; an admin assigns ${first}'s team.` : "."
              }`}
        </p>
        {canSetTarget && row ? (
          <div>
            <Link
              href={teamHref(ctx.basePath, period.key, current)}
              className={buttonVariants({
                variant: "secondary",
                size: "touch",
              })}
            >
              <PencilSimpleIcon aria-hidden />
              Set {first}&apos;s target
            </Link>
          </div>
        ) : null}
      </div>
    )
  }

  return (
    <>
      {row ? (
        <TeamPerson
          person={row.person}
          meta={row.person.jobTitle}
          className={cn(CARD, "flex")}
        />
      ) : (
        <p className={muted}>
          Nothing recorded for this person at this venue in {period.label}.
        </p>
      )}
      <section aria-labelledby="person-target" className={SECTION}>
        <h2
          id="person-target"
          className="font-display text-section-title text-ink"
        >
          {name} target
        </h2>
        {targetBody}
      </section>
      <section aria-labelledby="person-photos" className={SECTION}>
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h2
            id="person-photos"
            className="font-display text-section-title text-ink"
          >
            {period.key === current
              ? "Photos sent this month"
              : `Photos sent in ${name}`}
          </h2>
          {submissions.length > 0 ? (
            <span className="text-meta text-ink-muted tabular-nums">
              {submissions.length} sent
            </span>
          ) : null}
        </div>
        {submissions.length === 0 ? (
          <p role="status" className={cn(CARD, "text-body text-ink-muted")}>
            {first} hasn&apos;t sent any photos for {name} yet.
            {hasTarget
              ? " Photos count for the month their upload started."
              : null}
          </p>
        ) : (
          <ul className="grid grid-cols-2 gap-(--gutter) sm:grid-cols-3 lg:grid-cols-4">
            {submissions.map((s) => {
              const title = s.requirement?.title ?? "Photo"
              const isLate =
                s.state === "accepted" && s.decision?.lateAcceptance
              const word = isLate
                ? `Accepted late, counts for ${periodView(s.period).label}`
                : stateWord(s.state)
              return (
                <li key={s.id}>
                  <figure className="grid h-full min-w-0 content-start overflow-hidden rounded-card bg-surface shadow-card">
                    <EvidencePreviewButton
                      thumbnailUrl={s.asset.thumbnailUrl}
                      previewUrl={s.asset.previewUrl}
                      label={`${title}, ${word}`}
                    />
                    <figcaption className="grid min-w-0 gap-1.5 p-3">
                      <span className="text-meta font-bold [overflow-wrap:anywhere] text-ink">
                        {title}
                      </span>
                      <span className="text-meta text-ink-muted">
                        {isLate ? (
                          `Sent ${formatDate(s.submittedAt)}`
                        ) : (
                          <StatusChip state={s.state} />
                        )}
                      </span>
                    </figcaption>
                  </figure>
                </li>
              )
            })}
          </ul>
        )}
        {late.map((s) => (
          <div key={s.id} className={cn(CARD, "gap-2")}>
            <p>
              <StatusChip tone="closed">
                Accepted late · counts for {periodView(s.period).label}
              </StatusChip>
            </p>
            <p className={muted}>
              {s.requirement?.title ?? "Photo"}: sent{" "}
              {formatDate(s.submittedAt)} and accepted on{" "}
              {formatDate(s.decision!.decidedAt)}, so it counts for{" "}
              {monthName(s.period)}.
            </p>
          </div>
        ))}
        {toReview.length > 0 ? (
          <details className="group grid gap-3">
            <summary
              className={cn(
                buttonVariants({ variant: "secondary", size: "touch" }),
                "w-fit cursor-pointer list-none [&::-webkit-details-marker]:hidden"
              )}
            >
              <CheckIcon aria-hidden />
              Review {first}&apos;s {toReview.length === 1 ? "photo" : "photos"}
            </summary>
            <div className="mt-3">
              <ReviewQueueControl
                initial={{ items: toReview, nextCursor: null }}
                viewerId={ctx.viewerId}
                venueId={ctx.venueId}
                filter={{
                  state: "submitted",
                  staffId: row?.person.id,
                  period: period.key,
                }}
                emptyTitle={`Nothing from ${first} waiting for review.`}
                emptyDescription="Photos from another venue stay with that venue."
              />
            </div>
          </details>
        ) : null}
      </section>
      <p className={muted}>
        Only accepted photos count, for the month their upload started. Every
        ready photo is already in Photos.
      </p>
    </>
  )
}
