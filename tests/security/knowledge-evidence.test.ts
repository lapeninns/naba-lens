// Evidence of unadopted findings (docs/knowledge/b01-design.md §12; WS2 item
// 5): amenity_evidence_asset, the gate behind /api/amenities/evidence/{id}/*,
// lets the venue's manager or an admin, and the contributor while still
// active staff at the venue, view a pending finding's photos and videos.
// Nobody else gains access.
import { describe, expect, it } from "vitest"

import { ok, psql } from "./coverage-fixtures"
import {
  call,
  count,
  decide,
  service,
  submit,
  world,
  yes,
  type World,
} from "./knowledge-fixtures"
import type { TestIdentity } from "../support/identities"

async function visible(who: TestIdentity, assetId: string) {
  const { data, error } = await call(who, "amenity_evidence_asset", {
    p_asset_id: assetId,
  })
  if (error) throw new Error(error.message)
  return (data as unknown[]).length === 1
}

/** The single asset attached to a contribution. */
function assetOf(contributionId: string) {
  return psql(
    `select asset_id from public.knowledge_contribution_assets where contribution_id = '${contributionId}'`
  )
}

function evidenceOf(contributionId: string) {
  return count(
    `select count(*) from public.knowledge_contribution_assets where contribution_id = '${contributionId}'`
  )
}

async function pendingPhoto(w: World) {
  // guest_toilets assigned to B: A's Yes is a proposal, not adopted.
  const check = w.checks.guest_toilets!
  await ok(
    w.manager.client.rpc("amenity_assign_check", {
      p_check_id: check,
      p_assignee_id: w.staffB.id,
      p_revision: count(
        `select revision from public.venue_amenity_checks where id = '${check}'`
      ),
    })
  )
  const r = await yes(w.staffA, w, "guest_toilets")
  expect(r.outcome).toBe("awaiting_confirmation")
  expect(evidenceOf(r.contributionId)).toBe(1)
  return { contribution: r, asset: assetOf(r.contributionId) }
}

describe("evidence of unadopted contributions", () => {
  it("lets the venue's managers, an admin and the contributor view it", async () => {
    const w = await world("kn-evidence-allow")
    const { asset } = await pendingPhoto(w)
    for (const [name, who] of [
      ["manager account", w.manager],
      ["staff with a manager grant", w.staffManager],
      ["admin", w.admin],
      ["contributor", w.staffA],
    ] as const) {
      expect(await visible(who, asset), name).toBe(true)
    }
    // A step-free video waiting for confirmation is visible to the decider.
    const pending = await yes(w.staffA, w, "step_free_entrance")
    expect(await visible(w.manager, assetOf(pending.contributionId))).toBe(true)
  })

  it("gives colleagues, other venues and former staff nothing", async () => {
    const w = await world("kn-evidence-deny")
    const other = await world("kn-evidence-deny-other")
    const { asset, contribution } = await pendingPhoto(w)
    for (const [name, who] of [
      ["colleague (the assignee)", w.staffB],
      ["another venue's manager", other.manager],
      ["another venue's staff", other.staffA],
    ] as const) {
      expect(await visible(who, asset), name).toBe(false)
    }
    // Declined findings stay visible to the deciders, never to colleagues.
    expect(
      (
        await decide(
          w.manager,
          w,
          "guest_toilets",
          { type: "contribution", id: contribution.contributionId },
          "decline",
          "TEST not this one"
        )
      ).error
    ).toBeNull()
    expect(await visible(w.manager, asset)).toBe(true)
    expect(await visible(w.staffB, asset)).toBe(false)
    // The contributor moves venue: they keep nothing.
    await ok(
      service
        .from("profiles")
        .update({ venue_id: other.venue })
        .eq("id", w.staffA.id)
    )
    expect(await visible(w.staffA, asset)).toBe(false)
    expect(await visible(w.manager, asset)).toBe(true)
  })

  it("never shows a deleted asset or a Couldn't-establish finding's missing evidence", async () => {
    const w = await world("kn-evidence-deleted")
    const { asset } = await pendingPhoto(w)
    await ok(
      service
        .from("media_assets")
        .update({ deleted_at: new Date().toISOString() })
        .eq("id", asset)
    )
    for (const who of [w.manager, w.admin, w.staffA]) {
      expect(await visible(who, asset)).toBe(false)
    }
    const unknown = await submit(w.staffA, w, "onsite_parking", {
      answer: "unknown",
    })
    expect(evidenceOf(unknown.contributionId)).toBe(0)
  })
})
