import { type SubmissionView } from "@/components/nabalens/coverage"
import { getMenuCoverage, listReviewQueue } from "@/lib/server/coverage"

import { type ManageContext } from "../context"
import { MenuCoverageControl } from "../controls"
import { ManageFrame } from "../frame"

import { failed } from "./common"

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
      summary="Photos per menu section, from the venue’s active menu. Admins publish and activate menus; you choose which sections need photos and how many."
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
