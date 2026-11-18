// S3-R14: regression test for X10 in the Sprint 3 round 2 review
// (docs/plans/full-app-v1/reviews/S3-round2-review.md). An export package
// item that is no longer eligible says why: a real withdrawal reads
// `withdrawn`, a review level change `review_changed`, a retired place
// `subject_retired`; an eligible item has no reason. Fixed in
// supabase/migrations/20261118132100. Real signed-in identities through
// PostgREST; psql (as the owner) builds places and retires one.
import { randomUUID } from "node:crypto"

import { beforeAll, describe, expect, it } from "vitest"

import { createIdentity, type TestIdentity } from "../support/identities"
import { legacyStaffGrant, ok, psql } from "./coverage-fixtures"
import { call, json, service, world, type World } from "./knowledge-fixtures"
import { reserveReady } from "./menus-fixtures"

type Item = { assetId: string; eligible: boolean; staleReason: string | null }
type Detail = { state: string; staleAssets: string[]; items: Item[] }

let w: World
let reviewer: TestIdentity

function place(label: string) {
  return psql(
    `insert into public.knowledge_subjects (venue_id, kind, label, created_by)
     values ('${w.venue}', 'area', '${label}', '${w.admin.id}') returning id`
  )
}

/** A ready photo labelled with a new place and accepted for public use. */
async function acceptedPlacePhoto(label: string) {
  const subject = place(label)
  const asset = (await reserveReady(service, w.staffA)).id
  const [row] = (await ok(
    w.staffA.client.rpc("set_media_area_label", {
      p_asset_id: asset,
      p_subject_id: subject,
    })
  ))!
  const labelId = (row as { label_id: string }).label_id
  await ok(
    reviewer.client.rpc("decide_area_photo", {
      p_label_id: labelId,
      p_action: "accepted",
    })
  )
  return { asset, subject, label: labelId }
}

async function packageOf(photos: Array<{ asset: string; subject: string }>) {
  const created = (await ok(
    call(w.manager, "export_package_create", {
      p_request_key: `test-${randomUUID()}`,
      p_mode: "public",
      p_profile_key: "website",
      p_items: photos.map((p) => ({
        assetId: p.asset,
        subjectKind: "place",
        subjectId: p.subject,
      })),
    })
  )) as { packageId: string }
  return created.packageId
}

const detail = (pkg: string) =>
  json<Detail>(w.manager, "export_package_detail", { p_package_id: pkg })

const reasonOf = (d: Detail, asset: string) =>
  d.items.find((i) => i.assetId === asset)!.staleReason

beforeAll(async () => {
  w = await world("s3r14-exp")
  reviewer = await createIdentity(service, {
    label: "s3r14-exp-rev",
    role: "staff",
    venueId: w.venue,
  })
  await legacyStaffGrant(service, w.admin, reviewer.id, w.venue)
})

describe("X10: a stale export item says why", () => {
  it("names a withdrawal, a level change and a retired place, and nothing for a current item", async () => {
    const kept = await acceptedPlacePhoto("Bar")
    const withdrawn = await acceptedPlacePhoto("Cellar")
    const reference = await acceptedPlacePhoto("Snug")
    const retired = await acceptedPlacePhoto("Garden")
    const pkg = await packageOf([kept, withdrawn, reference, retired])

    const fresh = await detail(pkg)
    expect(fresh.items.every((i) => i.eligible && i.staleReason === null)).toBe(
      true
    )

    // A real withdrawal of the decision the item was exported under.
    await ok(
      reviewer.client.rpc("decide_area_photo", {
        p_label_id: withdrawn.label,
        p_action: "withdrawn",
        p_reason: "Not the cellar",
      })
    )
    // The same photo kept as reference: a review change, not a withdrawal.
    await ok(
      reviewer.client.rpc("decide_area_photo_level", {
        p_label_id: reference.label,
        p_action: "accepted",
        p_level: "reference",
      })
    )
    // The place itself retired.
    psql(
      `update public.knowledge_subjects set retired_at = now(), retired_by = '${w.admin.id}'
       where id = '${retired.subject}'`
    )

    const after = await detail(pkg)
    expect(after.state).toBe("needs_rebuild")
    expect(new Set(after.staleAssets)).toEqual(
      new Set([withdrawn.asset, reference.asset, retired.asset])
    )
    expect(reasonOf(after, kept.asset)).toBeNull()
    expect(reasonOf(after, withdrawn.asset)).toBe("withdrawn")
    expect(reasonOf(after, reference.asset)).toBe("review_changed")
    expect(reasonOf(after, retired.asset)).toBe("subject_retired")
  })

  it("is not callable directly", async () => {
    const { error } = await call(w.manager, "export_item_stale_reason", {
      p_asset_id: randomUUID(),
      p_venue_id: w.venue,
      p_subject_kind: "place",
      p_subject_id: randomUUID(),
      p_approval_id: "1",
      p_mode: "public",
    })
    expect(error).not.toBeNull()
  })
})
