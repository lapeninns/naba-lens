// B02-a reads (docs/knowledge/b02-design.md R1, R3, R4): the labels-needed
// count, the manager triage summary and To confirm's waitingSince order. Real
// signed-in identities through PostgREST; the service role and psql only
// build fixtures and read state back.
import { randomUUID } from "node:crypto"

import { beforeAll, describe, expect, it } from "vitest"

import { anonClient, markReady } from "../support/identities"
import {
  insertAsset,
  insertSubmittedItem,
  makeManager,
  ok,
  psql,
} from "./coverage-fixtures"
import {
  call,
  count,
  decide,
  json,
  photo,
  PILOT_KEYS,
  refused,
  service,
  submit,
  world,
  type World,
} from "./knowledge-fixtures"
import {
  item,
  menu,
  publishMenu,
  readDocument,
  reserveReady,
  saveOk,
  section,
} from "./menus-fixtures"

type LabelWork = { needs_labels: number; needs_attention: number }
type TriageRow = {
  queue: "menu_photos" | "findings" | "suggestions" | "checklist" | "rechecks"
  available: boolean
  waiting: number | null
  oldest_waiting_at: string | null
  own_waiting: number | null
}
type ToConfirm = {
  count: number
  items: {
    checkId: string
    kind: string
    questionKey: string
    findingRef: { type: string; id: string }
    sentAt: string | null
    waitingSince: string
    /** B03-f: an import's origin; imports are the suggestions queue. */
    source?: string | null
  }[]
}
type VenueRechecks = { count: number; items: { dueAt: string }[] }

const IMPORTED = ["legacy_fact", "external_source"]

const same = (a: string | null | undefined, b: string | null | undefined) =>
  expect(a == null ? null : Date.parse(a)).toBe(
    b == null ? null : Date.parse(b)
  )

/** A ready amenity-evidence upload (never labelled, never in Photos). */
async function amenityAsset(uploader: string, venue: string) {
  const id = randomUUID()
  await ok(
    service.from("media_assets").insert({
      id,
      uploader_id: uploader,
      venue_id: venue,
      original_path: `${uploader}/${id}/original.jpg`,
      original_filename: "TEST amenity.jpg",
      media_type: "image",
      size_bytes: 4,
      client_upload_key: randomUUID(),
      purpose: "amenity",
    })
  )
  await markReady(service, id, "image/jpeg")
  return id
}

describe("labels-needed count (R1)", () => {
  let w: World

  beforeAll(async () => {
    w = await world("kn-b02-labels")
  })

  it("counts own ready general photos without labels, and label saves needing attention", async () => {
    const work = () => json<LabelWork[]>(w.staffA, "my_label_work")
    expect(await work()).toEqual([{ needs_labels: 0, needs_attention: 0 }])

    await reserveReady(service, w.staffA)
    const typed = await reserveReady(service, w.staffA)
    await saveOk(w.staffA, { asset: typed.id, revision: 0, types: ["venue"] })
    // A note alone still needs labels (D-12).
    const noted = await reserveReady(service, w.staffA)
    await saveOk(w.staffA, {
      asset: noted.id,
      revision: 0,
      note: "TEST note only",
    })
    await amenityAsset(w.staffA.id, w.venue)
    await insertAsset(service, {
      uploader: w.staffA.id,
      venue: w.venue,
      ready: false,
    })
    const gone = await photo(w.staffA.id, w.venue)
    await ok(call(w.staffA, "delete_media_asset", { p_asset_id: gone }))
    // Someone else's unlabelled photo.
    await reserveReady(service, w.staffB)
    // A label save that failed to apply.
    const attention = await reserveReady(service, w.staffA)
    await ok(
      service.from("media_pending_labels").insert({
        asset_id: attention.id,
        uploader_id: w.staffA.id,
        venue_id: w.venue,
        input: { contentTypes: ["dish"] },
        status: "needs_attention",
        code: "invalid",
      })
    )

    // unlabelled, noted and attention (still unlabelled) need labels.
    expect(await work()).toEqual([{ needs_labels: 3, needs_attention: 1 }])
    // The count is Me's rule: own, ready, general, not deleted, no has_labels.
    expect(
      count(`select count(*) from public.media_assets a
        where a.uploader_id = '${w.staffA.id}' and a.upload_state = 'ready'
          and a.deleted_at is null and a.purpose = 'general'
          and not exists (select 1 from public.media_labels l
            where l.asset_id = a.id and l.has_labels)`)
    ).toBe(3)

    // Deleting the attention photo drops both counts.
    await ok(call(w.staffA, "delete_media_asset", { p_asset_id: attention.id }))
    expect(await work()).toEqual([{ needs_labels: 2, needs_attention: 0 }])
  })

  it("gives manager accounts and admins zeros, and refuses anonymous callers", async () => {
    for (const who of [w.manager, w.admin])
      expect(await json<LabelWork[]>(who, "my_label_work")).toEqual([
        { needs_labels: 0, needs_attention: 0 },
      ])
    const { data, error } = await call(
      { client: anonClient() },
      "my_label_work"
    )
    expect(error).not.toBeNull()
    expect(data).toBeNull()
  })
})

describe("manager triage summary (R3)", () => {
  let w: World
  /** A manager account converted from staff with one own photo waiting. */
  let converted: World["manager"]
  let other: World

  beforeAll(async () => {
    w = await world("kn-b02-triage")
    other = await world("kn-b02-triage-other")
    const version = await publishMenu(
      w.admin,
      w.venue,
      menu("TEST triage menu", [
        section("mains", "Mains", [
          item("mains--korma", "Korma"),
          item("mains--dal", "Dal"),
        ]),
      ])
    )
    const byKey = (await readDocument(service, version)).byKey
    const labelled = async (who: World["staffA"], key: string) => {
      const asset = await reserveReady(service, who)
      await saveOk(who, {
        asset: asset.id,
        revision: 0,
        types: ["dish"],
        items: [{ itemId: byKey[key]!.itemId, variantId: null }],
        catalogue: version,
      })
    }
    await labelled(w.staffA, "mains--korma")
    await labelled(w.staffB, "mains--dal")
    // staffB becomes a manager account; their photo now waits for another reviewer.
    await makeManager(w.admin, w.staffB, w.venue)
    converted = w.staffB

    // A finding waiting for confirmation.
    await submit(w.staffA, w, "step_free_entrance", { answer: "no" })
    // B03-f: an import waiting, proposed by the admin's legacy run onto the
    // empty guest_toilets slot (the suggestions queue, never findings).
    const fact = randomUUID()
    psql(`insert into public.venue_amenity_facts (id, venue_id, amenity_key, presence, facts)
      values ('${fact}', '${w.venue}', 'toilets', 'present', 'TEST triage toilets')`)
    await json(w.admin, "knowledge_mapping_review", {
      p_legacy_fact_id: fact,
      p_legacy_revision: 1,
      p_question_key: "guest_toilets",
      p_kind: "exact",
      p_reason: "TEST reviewed",
      p_idempotency_key: randomUUID(),
    })
    for (const mode of ["dry_run", "apply"])
      await json(w.admin, "knowledge_reconcile", {
        p_kind: "legacy",
        p_mode: mode,
        p_venue_id: w.venue,
      })
    // B03-e: an open recheck on a check with no answer (no job closes it).
    psql(`insert into public.knowledge_recheck_tasks (venue_id, check_id, question_key, cause, use, due_at)
      values ('${w.venue}', '${w.checks.onsite_parking}', 'onsite_parking', 'scope_changed', 'internal',
        '2026-10-01 00:00+00')`)
    // A checklist photo waiting for review.
    const asset = await insertAsset(service, {
      uploader: w.staffA.id,
      venue: w.venue,
    })
    await insertSubmittedItem(service, {
      asset,
      venue: w.venue,
      author: w.staffA.id,
      submittedAt: new Date().toISOString(),
    })
  })

  async function triage(who: World["admin"], venue: string | null) {
    const rows = await json<TriageRow[]>(who, "manager_triage_summary", {
      p_venue_id: venue,
    })
    expect(rows.map((r) => r.queue)).toEqual([
      "menu_photos",
      "findings",
      "suggestions",
      "checklist",
      "rechecks",
    ])
    return Object.fromEntries(rows.map((r) => [r.queue, r])) as Record<
      TriageRow["queue"],
      TriageRow
    >
  }

  async function expectMatchesReads(
    who: World["admin"],
    venue: string | null,
    checklist: boolean
  ) {
    const t = await triage(who, venue)
    const [ov] = await ok(
      who.client.rpc(
        "manager_menu_photo_overview",
        venue ? { p_venue_id: venue } : {}
      )
    )
    // manager-item-photos.test.ts pins the overview to the review queue.
    expect(t.menu_photos).toMatchObject({
      available: true,
      waiting: ov!.pending_photos,
      own_waiting: ov!.own_waiting_photos,
    })
    same(t.menu_photos.oldest_waiting_at, ov!.oldest_pending_at)

    const tc = await json<ToConfirm>(who, "knowledge_to_confirm", {
      p_venue_id: venue,
    })
    // B03-f (A12): imports waiting are the suggestions queue, apart from
    // findings and never summed into them.
    const oldestOf = (items: ToConfirm["items"]) =>
      items
        .map((i) => i.waitingSince)
        .sort((a, b) => Date.parse(a) - Date.parse(b))[0] ?? null
    const imported = tc.items.filter((i) => IMPORTED.includes(i.source ?? ""))
    const found = tc.items.filter((i) => !IMPORTED.includes(i.source ?? ""))
    expect(found.length + imported.length).toBe(tc.count)
    expect(t.findings).toMatchObject({
      available: true,
      waiting: found.length,
      own_waiting: null,
    })
    same(t.findings.oldest_waiting_at, oldestOf(found))
    expect(t.suggestions).toMatchObject({
      available: true,
      waiting: imported.length,
      own_waiting: null,
    })
    same(t.suggestions.oldest_waiting_at, oldestOf(imported))

    // B03-e (A41): the open rechecks knowledge_venue_rechecks lists.
    const rc = await json<VenueRechecks>(who, "knowledge_venue_rechecks", {
      p_venue_id: venue,
    })
    expect(t.rechecks).toMatchObject({
      available: true,
      waiting: rc.count,
      own_waiting: null,
    })
    const due = rc.items
      .map((i) => i.dueAt)
      .sort((a, b) => Date.parse(a) - Date.parse(b))[0]
    same(t.rechecks.oldest_waiting_at, due ?? null)

    if (checklist) {
      const [summary] = await ok(
        who.client.rpc("venue_coverage_summary", { p_venue_id: w.venue })
      )
      expect(t.checklist).toMatchObject({
        available: true,
        waiting: summary!.pending_review_count,
      })
      expect(t.checklist.waiting).toBe(1)
      expect(t.checklist.oldest_waiting_at).not.toBeNull()
    } else {
      expect(t.checklist).toEqual({
        queue: "checklist",
        available: false,
        waiting: null,
        oldest_waiting_at: null,
        own_waiting: null,
      })
    }
    return t
  }

  it("matches each existing read, queue by queue, for each manager kind", async () => {
    const mo = await expectMatchesReads(converted, null, false)
    // The manager account's own photo is its own count, not in waiting.
    expect(mo.menu_photos).toMatchObject({ waiting: 1, own_waiting: 1 })
    expect(mo.findings.waiting).toBe(1)
    // The import and the recheck each count once, apart from findings.
    expect(mo.suggestions.waiting).toBe(1)
    expect(mo.suggestions.oldest_waiting_at).not.toBeNull()
    expect(mo.rechecks.waiting).toBe(1)
    same(mo.rechecks.oldest_waiting_at, "2026-10-01T00:00:00+00:00")
    const sg = await expectMatchesReads(w.staffManager, null, true)
    expect(sg.menu_photos.waiting).toBeGreaterThanOrEqual(1)
    const ad = await expectMatchesReads(w.admin, w.venue, true)
    expect(ad.menu_photos.waiting).toBe(2)
    // The fixture's original manager account sees the same numbers.
    await expectMatchesReads(w.manager, w.venue, false)
  })

  it("refuses staff without a grant, another venue and an admin without one", async () => {
    await refused(
      w.staffA,
      "manager_triage_summary",
      { p_venue_id: null },
      "not_venue_manager",
      "42501"
    )
    for (const who of [w.manager, w.staffManager])
      await refused(
        who,
        "manager_triage_summary",
        { p_venue_id: other.venue },
        "wrong_venue",
        "42501"
      )
    await refused(
      w.admin,
      "manager_triage_summary",
      { p_venue_id: null },
      "venue_required",
      "22023"
    )
  })
})

describe("To confirm waitingSince (R4)", () => {
  let w: World

  beforeAll(async () => {
    w = await world("kn-b02-waiting", { extra: ["dogs_inside"], enable: false })
  })

  const toConfirm = () =>
    json<ToConfirm>(w.manager, "knowledge_to_confirm", { p_venue_id: null })

  it("gives every kind its waiting time and orders by it", async () => {
    // A legacy answer to step-free entrance before the question is on the
    // list: once listed, it waits for confirmation from its send time.
    const step = w.checks.step_free_entrance!
    const clip = (
      await insertAsset(service, {
        uploader: w.manager.id,
        venue: w.venue,
        mediaType: "video",
      })
    ).id
    const [legacy] = await ok(
      w.manager.client.rpc("amenity_submit_finding", {
        p_check_id: step,
        p_revision: count(
          `select revision from public.venue_amenity_checks where id = '${step}'`
        ),
        p_idempotency_key: randomUUID(),
        p_answer: "yes",
        p_finding: null as unknown as string,
        p_limitations: null as unknown as string,
        p_reason: null as unknown as string,
        p_asset_ids: [clip],
        p_internal_metadata: null,
        p_redaction_confirmed: null as unknown as boolean,
      })
    )
    await json(w.admin, "knowledge_set_working_list", {
      p_venue_id: w.venue,
      p_keys: [...PILOT_KEYS, "dogs_inside"],
      p_enabled: true,
      p_reason: "TEST pilot",
    })
    let list = await toConfirm()
    const pending = list.items.find((i) => i.checkId === step)!
    expect(pending.kind).toBe("answer_awaiting_confirmation")
    same(pending.waitingSince, pending.sentAt)
    expect(pending.findingRef).toEqual({
      type: "submission",
      id: legacy!.submission_id,
    })

    const target = { type: "submission" as const, id: legacy!.submission_id }
    await ok(decide(w.admin, w, "step_free_entrance", target, "confirm"))
    expect((await toConfirm()).items.some((i) => i.checkId === step)).toBe(
      false
    )

    // A finding sent after the answer...
    const finding = await submit(w.staffA, w, "dogs_inside", { answer: "no" })
    // ...then the confirmation is revoked: that row waits from the revoke.
    await ok(
      decide(w.admin, w, "step_free_entrance", target, "revoke", "TEST wrong")
    )
    const revokedAt =
      psql(`select to_jsonb(max(created_at)) #>> '{}' from public.knowledge_decisions
      where submission_id = '${legacy!.submission_id}' and decision = 'revoked'`)

    // A current Yes with two photos loses one: evidence_withdrawn.
    const p1 = await photo(w.staffA.id, w.venue)
    const p2 = await photo(w.staffA.id, w.venue)
    await submit(w.staffA, w, "guest_toilets", { assets: [p1, p2] })
    await ok(call(w.staffA, "delete_media_asset", { p_asset_id: p1 }))
    const withdrawnAt =
      psql(`select to_jsonb(max(created_at)) #>> '{}' from public.knowledge_events
      where check_id = '${w.checks.guest_toilets}' and kind = 'evidence_withdrawn'`)

    list = await toConfirm()
    expect(list.count).toBe(list.items.length)
    for (const i of list.items)
      expect(i.waitingSince).toEqual(expect.any(String))

    const dogs = list.items.findIndex(
      (i) => i.findingRef.id === finding.contributionId
    )
    const revoked = list.items.findIndex((i) => i.checkId === step)
    const withdrawn = list.items.findIndex(
      (i) => i.checkId === w.checks.guest_toilets
    )
    expect(list.items[dogs]!.kind).toBe("finding")
    same(list.items[dogs]!.waitingSince, list.items[dogs]!.sentAt)
    expect(list.items[revoked]!.kind).toBe("answer_awaiting_confirmation")
    same(list.items[revoked]!.waitingSince, revokedAt)
    // Its answer was sent before the finding, so B01 listed it first.
    expect(Date.parse(list.items[revoked]!.sentAt!)).toBeLessThan(
      Date.parse(list.items[dogs]!.sentAt!)
    )
    expect(revoked).toBeGreaterThan(dogs)
    expect(list.items[withdrawn]!.kind).toBe("evidence_withdrawn")
    same(list.items[withdrawn]!.waitingSince, withdrawnAt)
    expect(withdrawn).toBeGreaterThan(revoked)

    const times = list.items.map((i) => Date.parse(i.waitingSince))
    expect(times).toEqual([...times].sort((a, b) => a - b))
  })
})
