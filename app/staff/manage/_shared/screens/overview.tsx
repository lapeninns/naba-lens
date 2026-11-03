import Link from "next/link"

import {
  RequirementList,
  VenueCoverageSummary,
  manageHrefs,
  plural,
} from "@/components/nabalens/coverage"
import { formatDateTime } from "@/components/nabalens/menus/copy"
import { buttonVariants } from "@/components/ui/button"
import { getPreparationStatus } from "@/lib/server/coverage"

import { venueCoverage, type ManageContext } from "../context"
import { PrepareMonthControl } from "../controls"
import { ManageFrame } from "../frame"

import { failed, needsAttention, onChecklist } from "./common"

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
      summary={`${coverage.period.label}. Venue coverage and staff participation are reported separately; dates are UK time.`}
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
