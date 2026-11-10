// Delete impact for a photo (docs/knowledge/b02-design.md R9, audit HM-04):
// my_asset_delete_impact predicts what delete_media_asset will do to the
// answers and findings that use the asset. Each fixture reads the prediction
// as the uploader, deletes through the real delete_media_asset, and compares
// the actual change with the predicted effect, so the private helper cannot
// drift from the two deletion triggers it restates. Real signed-in identities
// through PostgREST; the service role and psql only build fixtures and read
// state back.
import { randomUUID } from "node:crypto"

import { describe, expect, it } from "vitest"

import type { TestIdentity } from "../support/identities"
import { insertAsset, insertSubmittedItem, psql } from "./coverage-fixtures"
import {
  call,
  count,
  decide,
  json,
  photo,
  refused,
  service,
  slot,
  submit,
  world,
  yes,
  type World,
} from "./knowledge-fixtures"

type Impact = {
  kind: "answer_in_use" | "pending_finding" | "earlier_answer"
  effect: "withdrawn" | "needs_recheck" | "none" | "pending_loses_evidence"
  venueId: string
  venueName: string
  checkId: string
  questionKey: string
  question: string
  yours: boolean
  findingRef?: { type: string; id: string }
}
type DeleteImpact = { assetId: string; impacts: Impact[] }

const ITEM_KEYS = [
  "checkId",
  "effect",
  "kind",
  "question",
  "questionKey",
  "venueId",
  "venueName",
  "yours",
]

/** The prediction, with every item's key set checked (D3: nothing more). */
async function predict(who: TestIdentity, asset: string) {
  const r = await json<DeleteImpact>(who, "my_asset_delete_impact", {
    p_asset_id: asset,
  })
  expect(r.assetId).toBe(asset)
  for (const i of r.impacts) {
    const ownPending = i.kind === "pending_finding" && i.yours
    expect(Object.keys(i).sort()).toEqual(
      ownPending ? [...ITEM_KEYS, "findingRef"].sort() : ITEM_KEYS
    )
  }
  return r
}

async function remove(who: TestIdentity, asset: string) {
  const { error } = await call(who, "delete_media_asset", { p_asset_id: asset })
  expect(error).toBeNull()
}

function question(key: string) {
  return psql(
    `select question from public.amenity_catalogue where key = '${key}'`
  )
}

function item(
  w: World,
  key: string,
  kind: Impact["kind"],
  effect: Impact["effect"],
  yours: boolean
) {
  return {
    kind,
    effect,
    venueId: w.venue,
    venueName: w.venueName,
    checkId: w.checks[key],
    questionKey: key,
    question: question(key),
    yours,
  }
}

function check(w: World, key: string) {
  return JSON.parse(
    psql(
      `select row_to_json(c) from (select progress, answer, current_submission_id from public.venue_amenity_checks where id = '${w.checks[key]}') c`
    )
  ) as { progress: string; answer: string; current_submission_id: string }
}

function displayName(id: string) {
  return psql(`select display_name from public.profiles where id = '${id}'`)
}

/** Assigns an off-list check to a staff member (legacy writes need it). */
async function assignTo(w: World, key: string, staff: TestIdentity) {
  await json(w.manager, "amenity_assign_check", {
    p_check_id: w.checks[key],
    p_assignee_id: staff.id,
    p_revision: count(
      `select revision from public.venue_amenity_checks where id = '${w.checks[key]}'`
    ),
  })
}

/** A legacy amenity_submit_finding answer (off the working list). */
async function legacy(
  who: TestIdentity,
  w: World,
  key: string,
  answer: "yes" | "no",
  assets: string[]
) {
  const rows = await json<{ submission_id: string }[]>(
    who,
    "amenity_submit_finding",
    {
      p_check_id: w.checks[key],
      p_revision: count(
        `select revision from public.venue_amenity_checks where id = '${w.checks[key]}'`
      ),
      p_idempotency_key: randomUUID(),
      p_answer: answer,
      p_finding: null,
      p_limitations: null,
      p_reason: answer === "no" ? "TEST none here" : null,
      p_asset_ids: assets,
      p_internal_metadata: null,
      p_redaction_confirmed: false,
    }
  )
  return rows[0]!.submission_id
}

/**
 * A staff member's photo sent to the venue's legacy Coverage requirement for
 * `coverageKey`, which the venue's manager may then attach as evidence
 * (private.amenity_is_legacy_media).
 */
async function legacyCoveragePhoto(
  w: World,
  uploader: TestIdentity,
  coverageKey: string
) {
  const { data: req, error } = await service
    .from("coverage_requirements")
    .insert({
      venue_id: w.venue,
      kind: "amenity",
      title: "TEST legacy evidence",
      amenity_key: coverageKey,
      status: "active",
    })
    .select("id")
    .single()
  if (error) throw error
  const asset = await insertAsset(service, {
    uploader: uploader.id,
    venue: w.venue,
  })
  await insertSubmittedItem(service, {
    asset,
    venue: w.venue,
    author: uploader.id,
    submittedAt: new Date().toISOString(),
    requirement: req!.id,
  })
  return asset.id
}

describe("answers in use on the working list", () => {
  it("predicts needs_recheck for a Yes's only photo, and the slot goes stale", async () => {
    const w = await world("kn-b02-impact-sole")
    const asset = await photo(w.staffA.id, w.venue)
    const r = await submit(w.staffA, w, "guest_toilets", { assets: [asset] })
    expect(r.outcome).toBe("current")
    const before = await predict(w.staffA, asset)
    expect(before.impacts).toEqual([
      item(w, "guest_toilets", "answer_in_use", "needs_recheck", true),
    ])
    await remove(w.staffA, asset)
    expect(check(w, "guest_toilets").progress).toBe("needs_recheck")
    expect(slot(w.venue, "guest_toilets")).toMatchObject({
      reason: "stale",
      detail: "evidence_lost",
    })
  })

  it("predicts withdrawn when another photo still meets the rule", async () => {
    const w = await world("kn-b02-impact-spare")
    const [first, spare] = [
      await photo(w.staffA.id, w.venue),
      await photo(w.staffA.id, w.venue),
    ]
    const r = await submit(w.staffA, w, "guest_toilets", {
      assets: [first, spare],
    })
    expect(r.outcome).toBe("current")
    expect((await predict(w.staffA, first)).impacts).toEqual([
      item(w, "guest_toilets", "answer_in_use", "withdrawn", true),
    ])
    await remove(w.staffA, first)
    expect(check(w, "guest_toilets")).toMatchObject({
      progress: "complete",
      current_submission_id: r.submissionId,
    })
    expect(slot(w.venue, "guest_toilets")).toMatchObject({
      reason: "withdrawn",
      detail: "evidence_withdrawn",
    })
  })

  it("predicts withdrawn for a No with a photo (B01 behaviour)", async () => {
    const w = await world("kn-b02-impact-no-on")
    const asset = await photo(w.staffA.id, w.venue)
    const r = await submit(w.staffA, w, "guest_toilets", {
      answer: "no",
      assets: [asset],
    })
    expect(r.outcome).toBe("current")
    expect((await predict(w.staffA, asset)).impacts).toEqual([
      item(w, "guest_toilets", "answer_in_use", "withdrawn", true),
    ])
    await remove(w.staffA, asset)
    expect(check(w, "guest_toilets")).toMatchObject({
      progress: "complete",
      answer: "no",
    })
    expect(slot(w.venue, "guest_toilets")).toMatchObject({
      reason: "withdrawn",
      detail: "evidence_withdrawn",
    })
  })

  it("lists a manager's answer using the uploader's legacy photo as not theirs, naming nobody", async () => {
    const w = await world("kn-b02-impact-legacy-answer")
    const asset = await legacyCoveragePhoto(w, w.staffA, "toilets")
    const r = await submit(w.manager, w, "guest_toilets", { assets: [asset] })
    expect(r.outcome).toBe("current")
    const before = await predict(w.staffA, asset)
    expect(before.impacts).toEqual([
      item(w, "guest_toilets", "answer_in_use", "needs_recheck", false),
    ])
    const text = JSON.stringify(before)
    for (const secret of [
      w.manager.id,
      w.staffA.id,
      displayName(w.manager.id),
      displayName(w.staffA.id),
      r.submissionId!,
      r.contributionId,
    ]) {
      expect(text).not.toContain(secret)
    }
    await remove(w.staffA, asset)
    expect(check(w, "guest_toilets").progress).toBe("needs_recheck")
    expect(slot(w.venue, "guest_toilets")).toMatchObject({
      reason: "stale",
      detail: "evidence_lost",
    })
  })
})

describe("answers in use off the working list", () => {
  it("predicts needs_recheck for a Yes's only photo", async () => {
    const w = await world("kn-b02-impact-off-sole", { extra: ["darts"] })
    await assignTo(w, "darts", w.staffA)
    const asset = await photo(w.staffA.id, w.venue)
    await legacy(w.staffA, w, "darts", "yes", [asset])
    expect((await predict(w.staffA, asset)).impacts).toEqual([
      item(w, "darts", "answer_in_use", "needs_recheck", true),
    ])
    await remove(w.staffA, asset)
    expect(check(w, "darts").progress).toBe("needs_recheck")
  })

  it("predicts none when another photo still meets the rule", async () => {
    const w = await world("kn-b02-impact-off-spare", { extra: ["darts"] })
    await assignTo(w, "darts", w.staffA)
    const [first, spare] = [
      await photo(w.staffA.id, w.venue),
      await photo(w.staffA.id, w.venue),
    ]
    const submission = await legacy(w.staffA, w, "darts", "yes", [first, spare])
    expect((await predict(w.staffA, first)).impacts).toEqual([
      item(w, "darts", "answer_in_use", "none", true),
    ])
    await remove(w.staffA, first)
    expect(check(w, "darts")).toMatchObject({
      progress: "complete",
      answer: "yes",
      current_submission_id: submission,
    })
  })

  it("predicts none for a No with a photo", async () => {
    const w = await world("kn-b02-impact-off-no", { extra: ["darts"] })
    await assignTo(w, "darts", w.staffA)
    const asset = await photo(w.staffA.id, w.venue)
    const submission = await legacy(w.staffA, w, "darts", "no", [asset])
    expect((await predict(w.staffA, asset)).impacts).toEqual([
      item(w, "darts", "answer_in_use", "none", true),
    ])
    await remove(w.staffA, asset)
    expect(check(w, "darts")).toMatchObject({
      progress: "complete",
      answer: "no",
      current_submission_id: submission,
    })
  })
})

describe("pending findings", () => {
  it("predicts pending_loses_evidence for the uploader's own finding, and a later confirm is refused", async () => {
    const w = await world("kn-b02-impact-own-pending")
    const r = await yes(w.staffA, w, "step_free_entrance")
    expect(r.outcome).toBe("awaiting_confirmation")
    const asset = psql(
      `select asset_id from public.knowledge_contribution_assets where contribution_id = '${r.contributionId}'`
    )
    expect((await predict(w.staffA, asset)).impacts).toEqual([
      {
        ...item(
          w,
          "step_free_entrance",
          "pending_finding",
          "pending_loses_evidence",
          true
        ),
        findingRef: { type: "contribution", id: r.contributionId },
      },
    ])
    await remove(w.staffA, asset)
    const confirm = await decide(
      w.manager,
      w,
      "step_free_entrance",
      { type: "contribution", id: r.contributionId },
      "confirm"
    )
    expect(confirm.error?.message).toBe("evidence_not_eligible")
    expect(check(w, "step_free_entrance").progress).toBe("needs_capture")
  })

  it("lists a manager's undecided finding using the uploader's legacy photo without a reference or a name", async () => {
    const w = await world("kn-b02-impact-other-pending")
    const asset = await legacyCoveragePhoto(w, w.staffA, "access_routes")
    const r = await submit(w.manager, w, "step_free_entrance", {
      answer: "no",
      assets: [asset],
    })
    expect(r.outcome).toBe("awaiting_confirmation")
    const before = await predict(w.staffA, asset)
    expect(before.impacts).toEqual([
      item(
        w,
        "step_free_entrance",
        "pending_finding",
        "pending_loses_evidence",
        false
      ),
    ])
    const text = JSON.stringify(before)
    for (const secret of [
      w.manager.id,
      displayName(w.manager.id),
      r.contributionId,
    ]) {
      expect(text).not.toContain(secret)
    }
    await remove(w.staffA, asset)
    const confirm = await decide(
      w.manager,
      w,
      "step_free_entrance",
      { type: "contribution", id: r.contributionId },
      "confirm"
    )
    expect(confirm.error?.message).toBe("evidence_not_eligible")
  })
})

describe("history and unused photos", () => {
  it("predicts earlier_answer for a replaced own answer, and nothing changes", async () => {
    const w = await world("kn-b02-impact-earlier", { extra: ["darts"] })
    await assignTo(w, "darts", w.staffA)
    const old = await photo(w.staffA.id, w.venue)
    const first = await legacy(w.staffA, w, "darts", "yes", [old])
    const second = await legacy(w.staffA, w, "darts", "yes", [
      await photo(w.staffA.id, w.venue),
    ])
    expect(second).not.toBe(first)
    expect((await predict(w.staffA, old)).impacts).toEqual([
      item(w, "darts", "earlier_answer", "none", true),
    ])
    await remove(w.staffA, old)
    expect(check(w, "darts")).toMatchObject({
      progress: "complete",
      current_submission_id: second,
    })
    expect(
      count(
        `select count(*) from public.amenity_submission_assets where submission_id = '${first}' and asset_id = '${old}'`
      )
    ).toBe(1)
  })

  it("predicts nothing for an unused photo", async () => {
    const w = await world("kn-b02-impact-unused")
    const asset = await photo(w.staffA.id, w.venue)
    expect(await predict(w.staffA, asset)).toEqual({
      assetId: asset,
      impacts: [],
    })
    await remove(w.staffA, asset)
  })
})

describe("who may read it", () => {
  it("answers the uploader only: colleagues, managers, admins and other venues get not_found", async () => {
    const w = await world("kn-b02-impact-deny")
    const other = await world("kn-b02-impact-deny-other")
    const asset = await photo(w.staffA.id, w.venue)
    await submit(w.staffA, w, "guest_toilets", { assets: [asset] })
    for (const [name, who] of [
      ["colleague", w.staffB],
      ["colleague holding a manager grant", w.staffManager],
      ["another venue's staff", other.staffA],
      ["manager account", w.manager],
      ["admin", w.admin],
    ] as const) {
      const e = await call(who, "my_asset_delete_impact", { p_asset_id: asset })
      expect(e.error, name).toMatchObject({
        message: "media_asset_not_found",
        code: "P0002",
      })
    }
    await refused(
      w.staffA,
      "my_asset_delete_impact",
      { p_asset_id: randomUUID() },
      "media_asset_not_found",
      "P0002"
    )
  })

  it("refuses a deleted asset", async () => {
    const w = await world("kn-b02-impact-deleted")
    const asset = await photo(w.staffA.id, w.venue)
    await remove(w.staffA, asset)
    await refused(
      w.staffA,
      "my_asset_delete_impact",
      { p_asset_id: asset },
      "media_asset_not_found",
      "P0002"
    )
  })
})
