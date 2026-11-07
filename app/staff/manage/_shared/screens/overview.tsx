import Link from "next/link"
import {
  ForkKnifeIcon,
  ClipboardTextIcon,
} from "@phosphor-icons/react/dist/ssr"

import { manageHrefs } from "@/components/nabalens/coverage"
import { ErrorState, ERROR_COPY } from "@/components/nabalens/error-state"
import { formatDate } from "@/components/nabalens/format"
import {
  OverviewBody,
  monthName,
  participationOf,
  type PreparationState,
} from "@/components/nabalens/coverage/overview-body"
import { buttonVariants } from "@/components/ui/button"
import {
  getMenuCoverage,
  getPreparationStatus,
  getVenueRoster,
} from "@/lib/server/coverage"
import { periodView, shiftPeriod } from "@/lib/server/coverage/time"

import { venueCoverage, type ManageContext } from "../context"
import { ManageFrame } from "../frame"
import { PrepareActionControl, RetryLoadButton } from "../overview-controls"

import { failed, needsAttention, onChecklist } from "./common"

const primaryLink = buttonVariants({ variant: "primary", size: "touch" })

export async function OverviewScreen({ ctx }: { ctx: ManageContext }) {
  const coverage = await venueCoverage(ctx)
  const { summary, period } = coverage
  const [preparation, roster] = await Promise.all([
    getPreparationStatus(ctx.actor, { venueId: ctx.venueId }),
    getVenueRoster(ctx.actor, { venueId: ctx.venueId }),
  ])
  const hrefs = manageHrefs(ctx.basePath)
  const title = "Overview"
  const summaryText = `How ${ctx.venue.name} is doing this month. Venue coverage and staff targets are counted separately.`

  for (const read of [preparation, roster]) {
    if (read.ok) continue
    if (
      read.code === "not_permitted" ||
      read.code === "wrong_venue" ||
      read.code === "not_found"
    )
      return failed(ctx, read)
    return (
      <ManageFrame
        ctx={ctx}
        section="overview"
        title={title}
        summary={summaryText}
        pendingReview={summary.pendingReview}
      >
        <ErrorState
          title={ERROR_COPY.couldNotLoad("the overview")}
          action={<RetryLoadButton />}
        />
      </ManageFrame>
    )
  }
  if (!preparation.ok || !roster.ok) return null

  const participation = participationOf(roster.roster)
  const status = preparation.status
  const members = roster.roster.filter((r) => r.isCurrentMember)
  const withTarget = members.filter((r) => r.targetCount !== null).length
  const preparationState: PreparationState =
    status?.lastStatus === "failed"
      ? { kind: "failed", copied: withTarget, total: members.length }
      : status?.lastSuccessAt
        ? { kind: "ready" }
        : { kind: "unprepared" }

  const menuChanged =
    summary.menuState === "menu_changed" ||
    summary.menuState === "reconciliation_pending"
  let menuChange: { changedOn: string | null } | null = null
  if (menuChanged) {
    const menu = await getMenuCoverage(ctx.actor, { venueId: ctx.venueId })
    const activated = menu.ok ? menu.menu.activeVersion?.activatedAt : null
    menuChange = { changedOn: activated ? formatDate(activated) : null }
  }

  const attention = coverage.requirements
    .filter(onChecklist)
    .filter(needsAttention)
    .sort((a, b) => Number(b.progress.overdue) - Number(a.progress.overdue))

  const actions =
    preparationState.kind !== "ready" ? (
      <PrepareActionControl venueId={ctx.venueId} />
    ) : menuChanged ? (
      <Link href={hrefs.menu} className={primaryLink}>
        <ForkKnifeIcon data-icon="inline-start" aria-hidden />
        Review menu coverage
      </Link>
    ) : summary.pendingReview > 0 ? (
      <Link href={hrefs.review} className={primaryLink}>
        <ClipboardTextIcon data-icon="inline-start" aria-hidden />
        Review photos
      </Link>
    ) : undefined
  // A month to prepare or a changed menu is the lead card that holds the
  // action; otherwise the action stays under the page title.
  const actionLeads =
    preparationState.kind === "unprepared" ||
    (preparationState.kind === "ready" && menuChanged)

  return (
    <ManageFrame
      ctx={ctx}
      section="overview"
      title={title}
      summary={summaryText}
      actions={actionLeads ? undefined : actions}
      pendingReview={summary.pendingReview}
    >
      <OverviewBody
        venueName={ctx.venue.name}
        period={period}
        previousMonth={monthName(periodView(shiftPeriod(period.key, -1)).label)}
        summary={summary}
        attention={attention}
        hrefs={hrefs}
        participation={participation}
        preparation={preparationState}
        retry={<PrepareActionControl venueId={ctx.venueId} retry />}
        menuChange={menuChange}
        leadAction={actionLeads ? actions : undefined}
      />
    </ManageFrame>
  )
}
