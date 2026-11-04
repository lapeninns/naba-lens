import {
  ChecklistBody,
  manageHrefs,
  monthName,
} from "@/components/nabalens/coverage"
import { formatDate } from "@/components/nabalens/format"
import { getMenuCoverage } from "@/lib/server/coverage"

import { venueCoverage, type ManageContext } from "../context"
import { NewRequirementControl } from "../controls"
import { ManageFrame } from "../frame"

import { onChecklist } from "./common"

export async function ChecklistScreen({ ctx }: { ctx: ManageContext }) {
  const coverage = await venueCoverage(ctx)
  const hrefs = manageHrefs(ctx.basePath)
  const requirements = coverage.requirements.filter(onChecklist)
  const { summary, period } = coverage

  const menuChanged =
    summary.menuState === "menu_changed" ||
    summary.menuState === "reconciliation_pending"
  let menuChange: { changedOn: string | null } | null = null
  if (menuChanged) {
    const menu = await getMenuCoverage(ctx.actor, { venueId: ctx.venueId })
    const activated = menu.ok ? menu.menu.activeVersion?.activatedAt : null
    menuChange = { changedOn: activated ? formatDate(activated) : null }
  }

  return (
    <ManageFrame
      ctx={ctx}
      section="checklist"
      title="Checklist"
      summary={`Every item ${ctx.venue.name} photographs this month. Items needing setup come first. Not applicable and retired items stay listed and aren't counted.`}
      pendingReview={summary.pendingReview}
    >
      <ChecklistBody
        venueName={ctx.venue.name}
        month={monthName(period.label)}
        summary={summary}
        requirements={requirements}
        hrefs={hrefs}
        menuChange={menuChange}
        addItem={
          <NewRequirementControl
            venueId={ctx.venueId}
            basePath={ctx.basePath}
            label="Add a venue-specific item"
          />
        }
      />
    </ManageFrame>
  )
}
