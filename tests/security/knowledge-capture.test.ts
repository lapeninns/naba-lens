// The capture page for a working-list question, for staff with no
// assignment (B01-02; matrix finding F1). The legacy check reads refuse them,
// by design, and stay that way: the page reads the knowledge slot instead, and
// lists the photos it may attach through listKnowledgeAssets, which must offer
// exactly what knowledge_submit accepts from staff.
import { describe, expect, it } from "vitest"

import { getReadableAsset } from "../../lib/server/media/access"
import { listKnowledgeAssets } from "../../lib/server/knowledge/reads"
import { actorFor } from "../slice/media-actor"
import { insertAsset, ok } from "./coverage-fixtures"
import {
  call,
  count,
  json,
  photo,
  service,
  submit,
  submitArgs,
  video,
  world,
} from "./knowledge-fixtures"

describe("capture reads for an unassigned staff member (F1)", () => {
  it("are refused by the legacy check reads and served by the knowledge slot", async () => {
    const w = await world("kn-capture-reads")
    const check = w.checks.guest_toilets!
    const legacy = await call(w.staffA, "amenity_check", { p_check_id: check })
    expect(legacy.error).toMatchObject({
      message: "amenity_check_not_found",
      code: "P0002",
    })
    const assets = await call(w.staffA, "amenity_submittable_assets", {
      p_check_id: check,
    })
    // The readable-check step runs first, so it is not found, not "not permitted".
    expect(assets.error).toMatchObject({
      message: "amenity_check_not_found",
      code: "P0002",
    })
    const slot = await json<{
      inScope: boolean
      permissions: { canContribute: boolean }
    }>(w.staffA, "knowledge_check", { p_check_id: check })
    expect(slot).toMatchObject({
      inScope: true,
      permissions: { canContribute: true },
    })
  })
})

describe("legacy photo list for a former submitter", () => {
  it("reads the check but may not list photos once no longer assigned", async () => {
    const w = await world("kn-capture-former", { extra: ["darts"] })
    const check = w.checks.darts!
    const revision = () =>
      count(
        `select revision from public.venue_amenity_checks where id = '${check}'`
      )
    const assign = async (to: string) =>
      ok(
        w.manager.client.rpc("amenity_assign_check", {
          p_check_id: check,
          p_assignee_id: to,
          p_revision: revision(),
        })
      )
    await assign(w.staffA.id)
    await ok(
      w.staffA.client.rpc("amenity_submit_finding", {
        p_check_id: check,
        p_revision: revision(),
        p_idempotency_key: crypto.randomUUID(),
        p_answer: "no",
        p_finding: null as unknown as string,
        p_limitations: null as unknown as string,
        p_reason: "TEST none here",
        p_asset_ids: [],
        p_internal_metadata: null,
        p_redaction_confirmed: false,
      })
    )
    await assign(w.staffB.id)
    expect(
      (await call(w.staffA, "amenity_check", { p_check_id: check })).error
    ).toBeNull()
    const assets = await call(w.staffA, "amenity_submittable_assets", {
      p_check_id: check,
    })
    expect(assets.error?.message).toBe("amenity_not_permitted")
  })
})

describe("listKnowledgeAssets", () => {
  it("offers exactly the caller's own ready uploads at the question's venue", async () => {
    const w = await world("kn-capture-assets")
    const other = await world("kn-capture-assets-other")
    const check = w.checks.guest_toilets!
    const ownPhoto = await photo(w.staffA.id, w.venue)
    const ownVideo = await video(w.staffA.id, w.venue)
    const colleague = await photo(w.staffB.id, w.venue)
    const unready = (
      await insertAsset(service, {
        uploader: w.staffA.id,
        venue: w.venue,
        ready: false,
      })
    ).id
    const deleted = await photo(w.staffA.id, w.venue)
    await ok(
      service
        .from("media_assets")
        .update({ deleted_at: new Date().toISOString() })
        .eq("id", deleted)
    )
    const elsewhere = await photo(other.staffA.id, other.venue)

    const actor = await actorFor(w.staffA)
    const listed = await listKnowledgeAssets(actor, { checkId: check })
    if (!listed.ok) throw new Error(listed.message)
    expect(listed.assets.map((a) => a.assetId).sort()).toEqual(
      [ownPhoto, ownVideo].sort()
    )
    expect(listed.assets.find((a) => a.assetId === ownVideo)).toMatchObject({
      kind: "video",
      source: "own",
    })
    for (const a of listed.assets) {
      if (a.thumbUrl) expect(a.thumbUrl).toBe(`/api/media/${a.assetId}/thumb`)
      // The own-media route serves them to their uploader.
      expect((await getReadableAsset(actor, a.assetId)).ok).toBe(true)
    }

    // Everything listed is accepted by knowledge_submit; nothing left out is.
    const sent = await submit(w.staffA, w, "guest_toilets", {
      assets: [ownPhoto, ownVideo],
    })
    expect(sent.outcome).toBe("current")
    for (const [asset, reason] of [
      [colleague, "not_own"],
      [unready, "not_ready"],
      [deleted, "deleted"],
      [elsewhere, "not_found"],
    ] as const) {
      const { error } = await call(
        w.staffA,
        "knowledge_submit",
        submitArgs(w, "onsite_parking", { answer: "no", assets: [asset] })
      )
      expect(error?.message, reason).toBe("evidence_not_eligible")
      expect(JSON.parse(error!.details!), reason).toMatchObject({ reason })
    }
  })

  it("follows a transfer and refuses a question off the working list", async () => {
    const w = await world("kn-capture-move", { extra: ["darts"] })
    const to = await world("kn-capture-move-to")
    const before = await photo(w.staffA.id, w.venue)
    await ok(
      service
        .from("profiles")
        .update({ venue_id: to.venue })
        .eq("id", w.staffA.id)
    )
    const after = await photo(w.staffA.id, to.venue)
    const actor = await actorFor(w.staffA)
    const listed = await listKnowledgeAssets(actor, {
      checkId: to.checks.guest_toilets,
    })
    if (!listed.ok) throw new Error(listed.message)
    expect(listed.assets.map((a) => a.assetId)).toEqual([after])
    expect(listed.assets.map((a) => a.assetId)).not.toContain(before)
    // The old venue's question is no longer theirs to read.
    expect(
      await listKnowledgeAssets(actor, { checkId: w.checks.guest_toilets })
    ).toMatchObject({
      ok: false,
      code: "not_found",
    })

    const v = await world("kn-capture-offlist", { extra: ["darts"] })
    expect(
      await listKnowledgeAssets(await actorFor(v.staffA), {
        checkId: v.checks.darts,
      })
    ).toMatchObject({ ok: false, code: "knowledge_slot_out_of_scope" })
  })
})
