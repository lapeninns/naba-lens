import Link from "next/link"

import {
  CoverageSection,
  Frames,
  manageHrefs,
  monthName,
} from "@/components/nabalens/coverage"
import { Notice } from "@/components/nabalens/notice"
import {
  getVenueRequirement,
  getVenueRoster,
  listAmenityFacts,
  listReviewQueue,
} from "@/lib/server/coverage"
import { periodKeyOf } from "@/lib/server/coverage/time"
import type { RequirementView } from "@/lib/server/coverage/types"

import { type ManageContext } from "../context"
import {
  AmenityFactControl,
  AttachPhotosControl,
  RequirementSetupControl,
  ReviewQueueControl,
} from "../controls"
import { ManageFrame } from "../frame"

import { failed } from "./common"

const KIND_WORD: Record<RequirementView["kind"], string> = {
  amenity: "Amenity",
  venue_specific: "Venue-specific",
  service: "Venue or service area",
  menu_section: "Menu section",
}

/** The kind, then whether and where the item counts. */
function itemSummary(requirement: RequirementView, venueName: string): string {
  const kind = KIND_WORD[requirement.kind]
  const menuPlan = requirement.menuSection?.menuPlanStatus ?? null
  if (
    requirement.menuSection &&
    (requirement.status === "retired" || menuPlan === "superseded")
  ) {
    const menu = requirement.menuSection.sectionKind
    return `${kind} · from the retired ${menu ? `${menu} ` : ""}menu.`
  }
  if (requirement.status === "not_applicable")
    return `${kind} · not counted while it doesn't apply.`
  if (requirement.status === "retired") return `${kind} · retired, not counted.`
  return `${kind} · counted on ${venueName}'s checklist, not toward anyone's target.`
}

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
  const menuPlan = requirement.menuSection?.menuPlanStatus ?? null
  const historyOnly =
    requirement.status === "retired" || menuPlan === "superseded"
  const applicable =
    requirement.status === "active" || requirement.status === "needs_setup"
  const { progress } = requirement
  const toTake = Math.max(
    0,
    progress.target - progress.accepted - progress.pending
  )

  const photos = (
    <CoverageSection title="Photos" id="item-photos">
      {applicable && !historyOnly ? (
        <div className="grid gap-2 rounded-card bg-surface p-4 shadow-card">
          <Frames
            accepted={progress.accepted}
            target={progress.target}
            pending={progress.pending}
          />
          {progress.pending > 0 || toTake > 0 ? (
            <p
              aria-hidden
              className="flex flex-wrap gap-x-4 gap-y-1 text-meta text-ink-muted"
            >
              {progress.pending > 0 ? (
                <span className="inline-flex items-center gap-1.5">
                  <i className="block h-2.5 w-[22px] rounded-round bg-stripe" />
                  {progress.pending} waiting for review
                </span>
              ) : null}
              {toTake > 0 ? (
                <span className="inline-flex items-center gap-1.5">
                  <i className="block h-2.5 w-[22px] rounded-round bg-surface-2 shadow-[inset_0_0_0_1px_var(--border-strong)]" />
                  {toTake} to take
                </span>
              ) : null}
            </p>
          ) : null}
        </div>
      ) : null}
      <ReviewQueueControl
        initial={evidence}
        viewerId={ctx.viewerId}
        venueId={ctx.venueId}
        filter={{ requirementId, state: "all", newestFirst: true }}
        emptyTitle="No photos sent for this item yet."
      />
      {requirement.isCurrent ? (
        <div>
          <AttachPhotosControl
            requirementId={requirement.id}
            requirementTitle={requirement.title}
            viewerId={ctx.viewerId}
            venueId={ctx.venueId}
          />
        </div>
      ) : null}
    </CoverageSection>
  )

  return (
    <ManageFrame
      ctx={ctx}
      section="checklist"
      title={requirement.title}
      summary={itemSummary(requirement, ctx.venue.name)}
    >
      <RequirementSetupControl
        requirement={requirement}
        roster={people}
        venueName={ctx.venue.name}
        month={monthName(periodKeyOf(new Date()))}
        readOnly={historyOnly}
        facts={
          isAmenity ? (
            <AmenityFactControl
              requirement={requirement}
              fact={fact}
              candidates={supporting}
              viewerId={ctx.viewerId}
              venueId={ctx.venueId}
            />
          ) : undefined
        }
        notice={
          menuPlan === "superseded" && requirement.status !== "retired" ? (
            <Notice>
              This section belongs to the previous menu. Carry its photos over
              on the{" "}
              <Link
                href={hrefs.menu}
                className="font-bold text-ink underline underline-offset-3"
              >
                Menu
              </Link>{" "}
              page.
            </Notice>
          ) : undefined
        }
        photos={photos}
      />
    </ManageFrame>
  )
}
