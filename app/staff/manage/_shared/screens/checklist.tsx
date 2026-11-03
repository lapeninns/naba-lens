import Link from "next/link"

import { RequirementList, manageHrefs } from "@/components/nabalens/coverage"

import { venueCoverage, type ManageContext } from "../context"
import { NewRequirementControl } from "../controls"
import { ManageFrame } from "../frame"

import { onChecklist } from "./common"

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
      summary="Venue areas, services, amenities and confirmed menu sections, each with a photo target. Template items are suggestions until you confirm they apply; items that do not apply keep their reason and are not counted."
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
