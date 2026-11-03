import Link from "next/link"
import { XIcon } from "@phosphor-icons/react/dist/ssr"

import {
  PhotoProgress,
  manageHrefs,
  type PeriodKey,
} from "@/components/nabalens/coverage"
import { buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { getStaffMonth, getVenueRoster } from "@/lib/server/coverage"
import {
  isPeriodKey,
  periodKeyOf,
  shiftPeriod,
} from "@/lib/server/coverage/time"

import { type ManageContext } from "../context"
import { ReviewQueueControl, TeamRosterControl } from "../controls"
import { ManageFrame } from "../frame"

import { failed, param, type ManageSearch } from "./common"

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
      summary="Each person’s photo target for the month and their accepted photos. Only new photos uploaded and submitted that month count; older photos can still complete venue coverage."
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
