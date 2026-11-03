import Link from "next/link"

import {
  PhotoProgress,
  REQUIREMENT_KIND_SINGULAR,
  labelFor,
  manageHrefs,
} from "@/components/nabalens/coverage"
import {
  getVenueRequirement,
  getVenueRoster,
  listAmenityFacts,
  listReviewQueue,
} from "@/lib/server/coverage"

import { type ManageContext } from "../context"
import {
  AmenityFactControl,
  AssigneeControl,
  AttachPhotosControl,
  RequirementSetupControl,
  ReviewQueueControl,
} from "../controls"
import { ManageFrame } from "../frame"

import { failed } from "./common"

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

  return (
    <ManageFrame
      ctx={ctx}
      section="checklist"
      title={requirement.title}
      summary={[
        labelFor(REQUIREMENT_KIND_SINGULAR, requirement.kind),
        requirement.menuSection
          ? `from the “${requirement.menuSection.sectionName}” section`
          : null,
        requirement.due?.label ?? null,
      ]
        .filter(Boolean)
        .join(" · ")}

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
