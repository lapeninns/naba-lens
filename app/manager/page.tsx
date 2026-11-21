import { managerHrefs } from "@/components/nabalens/manager/hrefs"
import { MANAGER_COPY } from "@/components/nabalens/manager/copy"
import { ActivationBanner } from "@/components/nabalens/manager/overview/activation-banner"
import {
  BacklogPanel,
  CategoryCoverage,
  OverviewActions,
  OVERVIEW_PANELS_COPY,
  VenueAtAGlance,
  type NeedsRow,
} from "@/components/nabalens/manager/overview/overview-panels"
import { TeamCompletionTargets } from "@/components/nabalens/manager/overview/team-completion-targets"
import {
  TRIAGE_COPY,
  triageConfirmCount,
  triageRechecks,
} from "@/components/nabalens/manager/overview/triage-card"
import { VenueAccessUnavailable } from "@/components/nabalens/manager/venue-access-unavailable"
import { waitingFor } from "@/components/nabalens/menu-photos/copy"
import { TO_CONFIRM_COPY } from "@/components/nabalens/knowledge/copy"
import { Notice } from "@/components/nabalens/notice"
import {
  OfflineNotice,
  OFFLINE_BANNER_CLASS,
} from "@/components/nabalens/offline-notice"
import { PageHeader } from "@/components/nabalens/page-header"
import { getManagerWorkspace } from "@/lib/auth/manager"
import { ROUTES } from "@/lib/auth/routes"
import { amenityHrefs } from "@/lib/amenities/contract"
import { managerTriageSurface } from "@/lib/config/manager-triage"
import { knowledgeServices } from "@/lib/knowledge-client/services"
import { getAmenityActor } from "@/lib/server/amenities"
import { getManagerCompletionRoster } from "@/lib/server/coverage/venue"
import {
  backlogSplit,
  categoryRows,
  overviewActions,
  type OverviewInput,
} from "@/lib/manager/overview"
import { getCoverageSlots } from "@/lib/server/album"
import { getPublicationOverview } from "@/lib/server/exports/service"
import { getFactCoverage } from "@/lib/server/knowledge/facts"
import { getManagerVenueSummary } from "@/lib/server/manager/venue"
import { getMediaActor } from "@/lib/server/media/context"
import type { TriageRow } from "@/lib/work-client/contract"
import { workServices } from "@/lib/work-client/services"

import { managerNeedsLabels } from "./entry"
import { failedRead, isRefusal, loadManagerOverview } from "./load-overview"

export const metadata = { title: "Overview" }

/** Amenity findings waiting for this manager; null when unreadable (MG-03). */
async function countToConfirm(): Promise<number | null> {
  try {
    const auth = await getAmenityActor()
    if (!auth.ok) return null
    const result = await knowledgeServices.listToConfirm(auth.actor, {})
    return result.ok ? result.view.count : null
  } catch {
    return null
  }
}

/**
 * The Triage queues (R3) when switched on; null reads the findings count on
 * its own (switched off, the database predates B02, or the read failed).
 */
async function readTriage(): Promise<TriageRow[] | null> {
  if (managerTriageSurface() !== "b02") return null
  try {
    const auth = await getAmenityActor()
    if (!auth.ok) return null
    const result = await workServices.getTriage(auth.actor)
    return result.status === "ok" ? result.value : null
  } catch {
    return null
  }
}

/**
 * S2-MGR (spec §7 M1): the reads behind the actions and panels. Each read
 * fails on its own: a failed one is null and its panel says it couldn't
 * count, never zero.
 */
async function readVenueState(venueId: string) {
  const auth = await getMediaActor("manager")
  if (!auth.ok) return null
  const actor = auth.actor
  const settle = async <T,>(p: Promise<T>): Promise<T | null> =>
    p.catch(() => null)
  const [coverage, facts, publication, summary] = await Promise.all([
    settle(getCoverageSlots(actor)),
    settle(getFactCoverage(actor, { venueId })),
    settle(getPublicationOverview(actor, venueId)),
    settle(getManagerVenueSummary(actor)),
  ])
  return {
    coverage: coverage?.ok ? coverage.coverage : null,
    facts: facts?.ok ? facts.coverage : null,
    publicationIssues: publication?.ok
      ? publication.overview.outstanding.length
      : null,
    summary: summary?.ok ? summary.summary : null,
  }
}

/** "Saturday 21 Nov" in UK time. */
function todayLabel(now: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "short",
    timeZone: "Europe/London",
  }).format(new Date(now))
}

/**
 * Overview, titled Needs you today (redesign R4, ia.md and the handoff's
 * Overview): one bottle button for the biggest job, then every other job as
 * a row into the section where it is done; beside it on desktop, the two
 * backlogs, coverage by category and the venue's menu and reviewers. It
 * reads the workspace itself rather than calling requireManagerVenue(),
 * which redirects here, as does a read the database refuses on any page
 * below. A failed read goes to error.tsx (Retry).
 */
export default async function ManagerOverviewPage() {
  const workspace = await getManagerWorkspace()
  // After a grant ends mid-session the layout is not re-rendered on client
  // navigation, so the page carries the unavailable state itself and asks
  // for a refresh that replaces the shell.
  if (workspace.status !== "available") {
    return <VenueAccessUnavailable reason={workspace.reason} refreshShell />
  }
  const read = await loadManagerOverview()
  if (!read.ok) {
    // Ended between the workspace read and this one; never redirect to
    // ourselves.
    if (isRefusal(read.code))
      return <VenueAccessUnavailable reason="no_grant" refreshShell />
    failedRead(read.code, "the overview", ROUTES.managerHome)
  }
  const [team, triage, needsLabels, venueState] = await Promise.all([
    getManagerCompletionRoster(read.ctx),
    readTriage(),
    managerNeedsLabels(workspace.venue.id),
    readVenueState(workspace.venue.id),
  ])
  const confirmCount = triage
    ? triageConfirmCount(triage)
    : await countToConfirm()
  if (!team.ok && isRefusal(team.code)) {
    return <VenueAccessUnavailable reason="no_grant" refreshShell />
  }
  // The layout's time stops describing a page once it is navigated to, so
  // each page says when it was rendered itself.
  const now = new Date().toISOString()
  const { overview } = read
  const input: OverviewInput = {
    now,
    pendingPhotos: overview.pendingPhotos,
    oldestPendingAt: overview.oldestPendingAt,
    unlabelledPhotos: venueState?.summary?.unlabelledPhotos ?? null,
    coverage: venueState?.coverage ?? null,
    facts: venueState?.facts ?? null,
    publicationIssues: venueState?.publicationIssues ?? null,
    menuCheckDue: venueState?.summary?.menuCheck?.due ?? null,
  }
  const actions = overviewActions(input, {
    review: managerHrefs.review(),
    unlabelled: managerHrefs.review({ status: "unlabelled" }),
    venue: managerHrefs.venue,
    requests: managerHrefs.requests,
    exports: managerHrefs.exports,
  })
  const P = OVERVIEW_PANELS_COPY
  const rechecks = triageRechecks(triage)
  // Jobs of their own, shown only when something is waiting: a count that
  // couldn't be read says so below the list instead (MG-03).
  const extra: NeedsRow[] = [
    ...(confirmCount && confirmCount > 0
      ? [
          {
            key: "confirm" as const,
            title: P.confirmTitle,
            line: P.confirmLine(confirmCount),
            href: `${amenityHrefs(managerHrefs.overview).list}#amenities-to-confirm`,
            waiting: true,
          },
        ]
      : []),
    // Amenity rechecks due (B03): Triage counts them, oldest first.
    ...(rechecks
      ? [
          {
            key: "rechecks" as const,
            title: P.rechecksTitle,
            line: TRIAGE_COPY.rechecks(rechecks.waiting, rechecks.oldest),
            href: `${amenityHrefs(managerHrefs.overview).list}#amenities-rechecks`,
            waiting: true,
          },
        ]
      : []),
    ...(needsLabels && needsLabels > 0
      ? [
          {
            key: "labels" as const,
            title: P.labelsTitle,
            line: P.labelsLine(needsLabels),
            href: managerHrefs.uploads,
            waiting: true,
          },
        ]
      : []),
  ]
  const waited = waitingFor(overview.oldestPendingAt, now)
  const summary = [
    todayLabel(now),
    overview.pendingPhotos > 0 && waited
      ? `the oldest photo has waited ${waited}`
      : null,
  ]
    .filter(Boolean)
    .join(" · ")
  const copy = MANAGER_COPY.overview

  return (
    <>
      <OfflineNotice className={OFFLINE_BANNER_CLASS} loadedAt={now} />
      <div className="grid gap-gutter">
        <PageHeader
          scope={overview.venueName || workspace.venue.name}
          venueScope
          title={P.actionsTitle}
          titleId="overview-title"
          summary={<p>{summary}</p>}
          className="pb-0 md:pb-0"
        />
        {overview.menuState === "no_menu" ? (
          <Notice
            tone="plain"
            title={copy.noMenuTitle}
            className="max-w-reading"
          >
            <p>{copy.noMenuBody}</p>
          </Notice>
        ) : overview.menuState === "empty" ? (
          <Notice
            tone="plain"
            title={copy.emptyTitle}
            className="max-w-reading"
          >
            <p>{copy.emptyBody}</p>
          </Notice>
        ) : (
          <ActivationBanner overview={overview} now={now} />
        )}
        {/* Phones: the list, then the panels. Desktop: list left, panels right. */}
        <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)]">
          <div className="grid gap-3">
            <OverviewActions
              actions={actions}
              pendingPhotos={overview.pendingPhotos}
              reviewHref={managerHrefs.review()}
              extra={extra}
              titleId="overview-title"
            />
            {confirmCount === null ? (
              <Notice tone="negative" role="alert">
                {TO_CONFIRM_COPY.failed}
              </Notice>
            ) : null}
          </div>
          <div className="grid gap-8">
            <BacklogPanel split={backlogSplit(input)} />
            <CategoryCoverage
              rows={
                venueState?.coverage || venueState?.facts
                  ? categoryRows(venueState.coverage, venueState.facts)
                  : null
              }
            />
            <VenueAtAGlance
              summary={venueState?.summary ?? null}
              venueHref={managerHrefs.venue}
              reviewersHref={`${managerHrefs.venue}#reviewers`}
            />
          </div>
        </div>
        {team.ok ? (
          <TeamCompletionTargets roster={team.roster} />
        ) : (
          <Notice role="status">Staff targets couldn’t be loaded.</Notice>
        )}
      </div>
    </>
  )
}
