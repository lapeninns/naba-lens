import Link from "next/link"
import { notFound } from "next/navigation"
import { XIcon } from "@phosphor-icons/react/dist/ssr"

import {
  PhotoProgress,
  REQUIREMENT_KIND_SINGULAR,
  RequirementList,
  VenueCoverageSummary,
  labelFor,
  manageHrefs,
  plural,
  type PeriodKey,
  type RequirementView,
  type SubmissionState,
  type SubmissionView,
} from "@/components/nabalens/coverage"
import { formatDateTime } from "@/components/nabalens/menus/copy"
import { buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import {
  getMenuCoverage,
  getPreparationStatus,
  getStaffMonth,
  getVenueRequirement,
  getVenueRoster,
  listAmenityFacts,
  listReviewQueue,
} from "@/lib/server/coverage"
import type { CoverageFailure } from "@/lib/server/coverage/types"
import {
  isPeriodKey,
  periodKeyOf,
  shiftPeriod,
} from "@/lib/server/coverage/time"

import { unexpected, venueCoverage, type ManageContext } from "./context"
import {
  AmenityFactControl,
  AssigneeControl,
  AttachPhotosControl,
  MenuCoverageControl,
  NewRequirementControl,
  PrepareMonthControl,
  RequirementSetupControl,
  ReviewQueueControl,
  TeamRosterControl,
} from "./controls"
import { ManageFrame, RefusedPage, isRefusal } from "./frame"

export type ManageSearch = Record<string, string | string[] | undefined>

function param(search: ManageSearch, key: string): string | undefined {
  const value = search[key]
  return typeof value === "string" ? value : undefined
}

/** A refused read (grant revoked, moved venue) or a hard failure. */
function failed(ctx: ManageContext, failure: CoverageFailure) {
  if (isRefusal(failure)) return <RefusedPage ctx={ctx} failure={failure} />
  if (failure.code === "not_found") notFound()
  unexpected(failure)
}

function needsAttention(r: RequirementView): boolean {
  return (
    r.status === "needs_setup" ||
    r.needsReassignment ||
    (r.status === "active" && r.progress.overdue)
  )
}

/** Menu sections belong on the checklist once their plan is confirmed. */
function onChecklist(r: RequirementView): boolean {
  return (
    r.kind !== "menu_section" || r.menuSection?.menuPlanStatus === "confirmed"
  )
}

// ---- Overview -------------------------------------------------------------------

/** The overview lists a few items; the checklist has them all. */
const ATTENTION_SHOWN = 6

export async function OverviewScreen({ ctx }: { ctx: ManageContext }) {
  const [coverage, preparation] = await Promise.all([
    venueCoverage(ctx),
    getPreparationStatus(ctx.actor, { venueId: ctx.venueId }),
  ])
  if (!preparation.ok) return failed(ctx, preparation)
  const hrefs = manageHrefs(ctx.basePath)
  const attention = coverage.requirements
    .filter(onChecklist)
    .filter(needsAttention)
  const shownAttention = attention.slice(0, ATTENTION_SHOWN)
  const status = preparation.status

  return (
    <ManageFrame
      ctx={ctx}
      section="overview"
      title="Coverage overview"
      description={`${coverage.period.label}. Venue coverage and staff participation are reported separately; dates are UK time.`}
      pendingReview={coverage.summary.pendingReview}
    >
      <VenueCoverageSummary summary={coverage.summary} hrefs={hrefs} />

      <section
        aria-labelledby="month-title"
        className="grid gap-3 rounded-lg border bg-card p-4"
      >
        <h2 id="month-title" className="font-medium">
          Monthly targets, {coverage.period.label}
        </h2>
        <p className="text-sm text-muted-foreground">
          {status?.lastSuccessAt
            ? `Prepared ${formatDateTime(status.lastSuccessAt)}.`
            : "Not prepared yet this month."}{" "}
          {status && status.staffWithoutTarget > 0
            ? `${plural(status.staffWithoutTarget, "person", "people")} without a target row. `
            : null}
          {status && status.targetsNeedingSetup > 0
            ? `${plural(status.targetsNeedingSetup, "target")} need setting. `
            : null}
          {status?.lastStatus === "failed"
            ? `The last run failed (code ${status.lastErrorCode ?? "unknown"}).`
            : null}
        </p>
        <p className="text-sm text-muted-foreground">
          Preparing copies each person’s last target at this venue and flags
          anyone new or without a team. It runs every hour on its own and is
          safe to run again.
        </p>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
          <PrepareMonthControl venueId={ctx.venueId} />
          <Link
            href={hrefs.team}
            className={buttonVariants({ variant: "ghost", size: "touch" })}
          >
            Open team targets
          </Link>
        </div>
      </section>

      <section aria-labelledby="attention-title" className="grid gap-3">
        <h2 id="attention-title" className="text-lg font-medium">
          Needs attention
        </h2>
        {attention.length > 0 ? (
          <>
            <RequirementList
              requirements={shownAttention}
              hrefFor={hrefs.requirement}
              showCounts={false}
            />
            {attention.length > shownAttention.length ? (
              <Link
                href={hrefs.checklist}
                className={buttonVariants({
                  variant: "outline",
                  size: "touch",
                  className: "w-fit",
                })}
              >
                See all {attention.length} on the checklist
              </Link>
            ) : null}
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            Nothing needs setup, reassignment or follow-up.
          </p>
        )}
      </section>
    </ManageFrame>
  )
}

// ---- Review queue ---------------------------------------------------------------

const REVIEW_TABS: { state: SubmissionState | "all"; label: string }[] = [
  { state: "submitted", label: "To review" },
  { state: "needs_another_photo", label: "Needs another photo" },
  { state: "accepted", label: "Accepted" },
  { state: "all", label: "All" },
]

export async function ReviewScreen({
  ctx,
  search,
}: {
  ctx: ManageContext
  search: ManageSearch
}) {
  const requested = param(search, "state")
  const tab = REVIEW_TABS.find((t) => t.state === requested) ?? REVIEW_TABS[0]
  const filter = {
    state: tab.state,
    newestFirst: tab.state !== "submitted",
  }
  const queue = await listReviewQueue(ctx.actor, {
    venueId: ctx.venueId,
    ...filter,
  })
  if (!queue.ok) return failed(ctx, queue)
  const href = manageHrefs(ctx.basePath).review

  return (
    <ManageFrame
      ctx={ctx}
      section="review"
      title="Review photos"
      description="Accept a photo when it shows what was asked: relevant, clear, well presented and adding variety. Ask for another photo with a reason otherwise. Oldest submissions come first."
      pendingReview={ctx.coverage?.summary.pendingReview}
    >
      <nav aria-label="Review filter" className="flex flex-wrap gap-2">
        {REVIEW_TABS.map((t) => (
          <Link
            key={t.state}
            href={t.state === "submitted" ? href : `${href}?state=${t.state}`}
            aria-current={t.state === tab.state ? "page" : undefined}
            className={buttonVariants({
              variant: t.state === tab.state ? "secondary" : "ghost",
              size: "touch",
            })}
          >
            {t.label}
          </Link>
        ))}
      </nav>
      <ReviewQueueControl
        initial={queue}
        viewerId={ctx.viewerId}
        venueId={ctx.venueId}
        filter={filter}
        emptyTitle={
          tab.state === "submitted" ? "Nothing to review." : "No photos here."
        }
      />
    </ManageFrame>
  )
}

// ---- Checklist -------------------------------------------------------------------

export async function ChecklistScreen({ ctx }: { ctx: ManageContext }) {
  const coverage = await venueCoverage(ctx)
  const hrefs = manageHrefs(ctx.basePath)
  const requirements = coverage.requirements.filter(onChecklist)
  const { summary } = coverage

  return (
    <ManageFrame
      ctx={ctx}
      section="checklist"
      title="Checklist"
      description="Venue areas, services, amenities and confirmed menu sections, each with a photo target. Template items are suggestions until you confirm they apply; items that do not apply keep their reason and are not counted."
      pendingReview={summary.pendingReview}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm">
          <span className="font-medium">
            {summary.satisfied} of {summary.applicable}
          </span>{" "}
          applicable items complete · {summary.needsSetup} need setup ·{" "}
          {summary.notApplicable} not applicable
        </p>
        <NewRequirementControl venueId={ctx.venueId} basePath={ctx.basePath} />
      </div>
      <RequirementList
        requirements={requirements}
        hrefFor={hrefs.requirement}
        emptyTitle="No checklist items yet. Prepare this month on the overview to add the standard items."
      />
      <p className="text-sm text-muted-foreground">
        Menu sections join the checklist when you confirm menu coverage on the{" "}
        <Link href={hrefs.menu} className="underline underline-offset-3">
          Menu
        </Link>{" "}
        page.
      </p>
    </ManageFrame>
  )
}

// ---- One requirement ---------------------------------------------------------------

export async function RequirementScreen({
  ctx,
  requirementId,
}: {
  ctx: ManageContext
  requirementId: string
}) {
  const result = await getVenueRequirement(ctx.actor, {
    venueId: ctx.venueId,
    requirementId,
  })
  if (!result.ok) return failed(ctx, result)
  const requirement = result.requirement
  const isAmenity = requirement.kind === "amenity"
  const [roster, evidence, facts] = await Promise.all([
    getVenueRoster(ctx.actor, { venueId: ctx.venueId }),
    listReviewQueue(ctx.actor, {
      venueId: ctx.venueId,
      requirementId,
      state: "all",
      newestFirst: true,
    }),
    isAmenity
      ? listAmenityFacts(ctx.actor, { venueId: ctx.venueId })
      : Promise.resolve(null),
  ])
  if (!roster.ok) return failed(ctx, roster)
  if (!evidence.ok) return failed(ctx, evidence)
  if (facts && !facts.ok) return failed(ctx, facts)

  const hrefs = manageHrefs(ctx.basePath)
  const people = roster.roster
    .filter((r) => r.isCurrentMember && r.person.active)
    .map((r) => r.person)
  const fact =
    facts?.facts.find((f) => f.requirementId === requirement.id) ??
    facts?.facts.find((f) => f.templateKey === requirement.templateKey) ??
    null
  const supporting = evidence.items
    .filter((s) => s.state === "accepted" && s.asset.available)
    .map((s) => s.asset)
  const open =
    requirement.status === "active" || requirement.status === "needs_setup"
  const menuPlan = requirement.menuSection?.menuPlanStatus ?? null
  const historyOnly =
    requirement.status === "retired" || menuPlan === "superseded"
  const back =
    requirement.kind === "menu_section"
      ? { href: hrefs.menu, label: "Menu coverage" }
      : { href: hrefs.checklist, label: "Checklist" }

  return (
    <ManageFrame
      ctx={ctx}
      section="checklist"
      title={requirement.title}
      description={[
        labelFor(REQUIREMENT_KIND_SINGULAR, requirement.kind),
        requirement.menuSection
          ? `from the “${requirement.menuSection.sectionName}” section`
          : null,
        requirement.due?.label ?? null,
      ]
        .filter(Boolean)
        .join(" · ")}
      back={back}
    >
      <section aria-labelledby="progress-title" className="grid gap-2">
        <h2 id="progress-title" className="sr-only">
          Progress
        </h2>
        {requirement.status === "active" ? (
          <PhotoProgress
            accepted={requirement.progress.accepted}
            target={requirement.photoTarget}
            pending={requirement.progress.pending}
            className="max-w-sm"
          />
        ) : null}
        {requirement.guidance ? (
          <p className="max-w-prose text-sm whitespace-pre-line">
            {requirement.guidance}
          </p>
        ) : null}
        {menuPlan === "superseded" ? (
          <p className="text-sm text-warning">
            This section belongs to the previous menu. Carry its photos over on
            the{" "}
            <Link href={hrefs.menu} className="underline underline-offset-3">
              Menu
            </Link>{" "}
            page.
          </p>
        ) : null}
      </section>

      {historyOnly ? null : (
        <RequirementSetupControl requirement={requirement} />
      )}

      {isAmenity && fact && !historyOnly ? (
        <AmenityFactControl
          fact={fact}
          candidates={supporting}
          venueId={ctx.venueId}
        />
      ) : null}

      {open && !historyOnly ? (
        <AssigneeControl requirement={requirement} roster={people} />
      ) : null}

      <section aria-labelledby="evidence-title" className="grid gap-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <h2 id="evidence-title" className="text-lg font-medium">
            Photos
          </h2>
          {requirement.isCurrent ? (
            <AttachPhotosControl
              requirementId={requirement.id}
              requirementTitle={requirement.title}
              viewerId={ctx.viewerId}
              venueId={ctx.venueId}
            />
          ) : null}
        </div>
        <ReviewQueueControl
          initial={evidence}
          viewerId={ctx.viewerId}
          venueId={ctx.venueId}
          filter={{ requirementId, state: "all", newestFirst: true }}
          emptyTitle="No photos yet."
          emptyDescription={
            requirement.isCurrent
              ? "Assigned staff submit photos from My tasks, or attach existing venue photos here."
              : "Photos can be added once this item is confirmed."
          }
        />
      </section>
    </ManageFrame>
  )
}

// ---- Menu coverage -------------------------------------------------------------------

export async function MenuScreen({ ctx }: { ctx: ManageContext }) {
  const result = await getMenuCoverage(ctx.actor, { venueId: ctx.venueId })
  if (!result.ok) return failed(ctx, result)
  const menu = result.menu
  const pages = await Promise.all(
    menu.superseded.map((r) =>
      listReviewQueue(ctx.actor, {
        venueId: ctx.venueId,
        requirementId: r.id,
        state: "accepted",
      })
    )
  )
  const evidence: Record<string, SubmissionView[]> = {}
  for (const [i, page] of pages.entries()) {
    if (!page.ok) return failed(ctx, page)
    evidence[menu.superseded[i].id] = page.items
  }

  return (
    <ManageFrame
      ctx={ctx}
      section="menu"
      title="Menu coverage"
      description="Photos per menu section, from the venue’s active menu. Admins publish and activate menus; you choose which sections need photos and how many."
      pendingReview={ctx.coverage?.summary.pendingReview}
    >
      <MenuCoverageControl
        menu={menu}
        evidence={evidence}
        basePath={ctx.basePath}
        venueId={ctx.venueId}
      />
    </ManageFrame>
  )
}

// ---- Team and monthly targets -----------------------------------------------------------

function periodLink(basePath: string, period: PeriodKey, current: PeriodKey) {
  const team = manageHrefs(basePath).team
  return period === current ? team : `${team}?period=${period}`
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
  const previous = shiftPeriod(period, -1)
  const following = shiftPeriod(period, 1)
  const showFollowing = isAdmin || following <= next
  const personMonth = month?.ok ? month.month : null
  const person =
    personMonth?.monthly?.person ??
    roster.roster.find((r) => r.person.id === staffId)?.person ??
    null

  return (
    <ManageFrame
      ctx={ctx}
      section="team"
      title="Team and monthly targets"
      description="Each person’s photo target for the month and their accepted photos. Only new photos uploaded and submitted that month count; older photos can still complete venue coverage."
      pendingReview={ctx.coverage?.summary.pendingReview}
    >
      <nav aria-label="Month" className="flex flex-wrap items-center gap-2">
        <Link
          href={periodLink(ctx.basePath, previous, current)}
          className={buttonVariants({ variant: "outline", size: "touch" })}
        >
          Previous month
        </Link>
        {period !== current ? (
          <Link
            href={periodLink(ctx.basePath, current, current)}
            className={buttonVariants({ variant: "ghost", size: "touch" })}
          >
            This month
          </Link>
        ) : null}
        {showFollowing ? (
          <Link
            href={periodLink(ctx.basePath, following, current)}
            className={buttonVariants({ variant: "outline", size: "touch" })}
          >
            Next month
          </Link>
        ) : null}
      </nav>

      {staffId ? (
        <section
          aria-labelledby="person-title"
          className="grid gap-3 rounded-lg border bg-card p-4"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="grid gap-1">
              <h2 id="person-title" className="text-lg font-medium break-words">
                {person ? person.displayName : "Person"}, {roster.period.label}
              </h2>
              {personMonth?.monthly ? (
                <PhotoProgress
                  accepted={personMonth.monthly.accepted}
                  target={personMonth.monthly.targetCount}
                  pending={personMonth.monthly.pending}
                  className="max-w-sm"
                />
              ) : (
                <p className="text-sm text-muted-foreground">
                  No target at this venue for this month.
                </p>
              )}
            </div>
            <Link
              href={periodLink(ctx.basePath, period, current)}
              aria-label="Close"
              className={cn(
                buttonVariants({ variant: "ghost", size: "icon-lg" }),
                "size-11 sm:size-9"
              )}
            >
              <XIcon aria-hidden />
            </Link>
          </div>
          {personMonth ? (
            <ReviewQueueControl
              initial={{ items: personMonth.submissions, nextCursor: null }}
              viewerId={ctx.viewerId}
              venueId={ctx.venueId}
              emptyTitle="No photos submitted at this venue this month."
              emptyDescription="Photos from another venue stay with that venue."
            />
          ) : (
            <p className="text-sm text-muted-foreground">
              Nothing recorded for this person at this venue in{" "}
              {roster.period.label}.
            </p>
          )}
        </section>
      ) : null}

      <TeamRosterControl
        period={roster.period}
        currentPeriod={current}
        rows={roster.roster}
        canEdit={canEdit}
        isAdmin={isAdmin}
        basePath={ctx.basePath}
        venueId={ctx.venueId}
      />
    </ManageFrame>
  )
}
