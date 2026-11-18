// Full App v1, S2-STAFF: My uploads, Report a change / request correction,
// the venue's managers and Your month (spec §6 S3, S4, S5; FA-1, FA-7,
// FA-34; AC15, AC16, AC17, AC26, AC34). Migrations 20261118111000-111200.
// Real signed-in identities through PostgREST; the service role and psql
// only build fixtures and read back.
import { beforeAll, describe, expect, it } from "vitest"

import {
  anonClient,
  createIdentity,
  type TestIdentity,
} from "../support/identities"
import { ok, psql } from "./coverage-fixtures"
import {
  admin as knowledgeAdmin,
  call,
  json,
  service,
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
  type CatalogueRow,
} from "./menus-fixtures"

type Upload = {
  assetId: string
  venueId: string
  venueName: string
  uploadState: string
  uploadedAt: string
  capturedAt: string | null
  capturedAtSource: string
  labelRevision: number
  slots: Array<{
    kind: string
    slotId: string
    name: string
    outcome: string
    reason: string | null
    replacesAssetId: string | null
  }>
  removalRequested: boolean
}
type Uploads = {
  items: Upload[]
  next: { before: string; beforeId: string } | null
}
type Report = {
  id: string
  venueId: string
  reporterId: string
  subjectKind: string
  subjectId: string
  subjectName: string
  reason: string
  note: string | null
  state: string
}

async function errorOf(p: PromiseLike<{ error: { message: string } | null }>) {
  const { error } = await p
  return error?.message ?? null
}

const head = (itemId: string) =>
  Number(
    psql(
      `select coalesce((select revision from public.menu_item_photo_heads where item_id = '${itemId}'), 1)`
    )
  )

type V = {
  w: World
  version: string
  items: Record<string, CatalogueRow>
  bar: string
}

async function venue(label: string): Promise<V> {
  const w = await world(label)
  const version = await publishMenu(
    w.admin,
    w.venue,
    menu("TEST staff", [
      section("mains", "Mains", [
        item("mains--pie", "Pie"),
        item("mains--fish", "Fish"),
      ]),
    ])
  )
  const items = (await readDocument(service, version)).byKey
  const bar = psql(
    `insert into public.knowledge_subjects (venue_id, kind, label, created_by)
     values ('${w.venue}', 'area', 'Bar', '${w.admin.id}') returning id`
  )
  return { w, version, items, bar }
}

async function dishPhoto(v: V, who: TestIdentity, itemId: string) {
  const asset = await reserveReady(service, who)
  await saveOk(who, {
    asset: asset.id,
    revision: 0,
    items: [{ itemId, variantId: null }],
    catalogue: v.version,
  })
  return asset.id
}

async function areaPhoto(who: TestIdentity, subject: string) {
  const asset = (await reserveReady(service, who)).id
  const [row] = (await ok(
    who.client.rpc("set_media_area_label", {
      p_asset_id: asset,
      p_subject_id: subject,
    })
  ))!
  return { asset, label: row!.label_id! }
}

const uploads = (who: TestIdentity, args: object = {}) =>
  json<Uploads>(who, "my_uploads", args)

const report = (
  who: TestIdentity,
  kind: string,
  subject: string,
  reason: string,
  note?: string
) =>
  call(who, "report_slot_change", {
    p_kind: kind,
    p_subject_id: subject,
    p_reason: reason,
    ...(note ? { p_note: note } : {}),
  })

let v: V
let other: V
let inactive: TestIdentity
let pie: string
let fish: string

beforeAll(async () => {
  await knowledgeAdmin()
  ;[v, other] = await Promise.all([venue("s2-staff"), venue("s2-staff-o")])
  pie = v.items["mains--pie"]!.itemId
  fish = v.items["mains--fish"]!.itemId
  inactive = await createIdentity(service, {
    label: "s2-staff-inactive",
    role: "staff",
    venueId: v.w.venue,
  })
  await ok(
    service.from("profiles").update({ active: false }).eq("id", inactive.id)
  )
})

// ---------------------------------------------------------------------------

describe("my_uploads", () => {
  let first: string
  let area1: { asset: string; label: string }
  let area2: { asset: string; label: string }

  beforeAll(async () => {
    first = await dishPhoto(v, v.w.staffA, pie)
    area1 = await areaPhoto(v.w.staffA, v.bar)
  })

  it("lists the caller's own photos with venue, dates and Waiting", async () => {
    const read = await uploads(v.w.staffA)
    const row = read.items.find((i) => i.assetId === first)!
    expect(row.venueId).toBe(v.w.venue)
    expect(row.venueName).toBe(v.w.venueName)
    expect(row.uploadState).toBe("ready")
    expect(row.capturedAtSource).toBe("unknown")
    expect(row.labelRevision).toBeGreaterThan(0)
    expect(row.slots).toEqual([
      expect.objectContaining({
        kind: "dish",
        slotId: pie,
        outcome: "awaiting_review",
      }),
    ])
    const area = read.items.find((i) => i.assetId === area1.asset)!
    expect(area.slots[0]).toMatchObject({
      kind: "area",
      slotId: v.bar,
      name: "Bar",
      outcome: "awaiting_review",
    })
  })

  it("follows the manager's decision: public, then reference (FA-7, AC16)", async () => {
    await ok(
      call(v.w.manager, "set_menu_item_photo_level", {
        p_asset_id: first,
        p_item_id: pie,
        p_variant_id: null,
        p_level: "public",
        p_expected_revision: head(pie),
      }) as never
    )
    let row = (await uploads(v.w.staffA)).items.find(
      (i) => i.assetId === first
    )!
    expect(row.slots[0]!.outcome).toBe("public")
    await ok(
      call(v.w.manager, "set_menu_item_photo_level", {
        p_asset_id: first,
        p_item_id: pie,
        p_variant_id: null,
        p_level: "reference",
        p_expected_revision: head(pie),
      }) as never
    )
    row = (await uploads(v.w.staffA)).items.find((i) => i.assetId === first)!
    expect(row.slots[0]!.outcome).toBe("reference")
  })

  it("shows a retake with its reason, and links the next photo to it (AC17)", async () => {
    await ok(
      call(v.w.manager, "decide_area_photo_level", {
        p_label_id: area1.label,
        p_action: "needs_another_photo",
        p_level: "public",
        p_reason: "Too dark, turn the lights on",
      }) as never
    )
    area2 = await areaPhoto(v.w.staffA, v.bar)
    const read = await uploads(v.w.staffA)
    const old = read.items.find((i) => i.assetId === area1.asset)!
    expect(old.slots[0]).toMatchObject({
      outcome: "retake_requested",
      reason: "Too dark, turn the lights on",
    })
    const next = read.items.find((i) => i.assetId === area2.asset)!
    expect(next.slots[0]).toMatchObject({
      outcome: "awaiting_review",
      replacesAssetId: area1.asset,
    })
  })

  it("pages newest first with a cursor", async () => {
    const one = await uploads(v.w.staffA, { p_limit: 1 })
    expect(one.items).toHaveLength(1)
    expect(one.next).not.toBeNull()
    const two = await uploads(v.w.staffA, {
      p_limit: 1,
      p_before: one.next!.before,
      p_before_id: one.next!.beforeId,
    })
    expect(two.items).toHaveLength(1)
    expect(two.items[0]!.assetId).not.toBe(one.items[0]!.assetId)
    expect(
      await errorOf(
        call(v.w.staffA, "my_uploads", { p_before: one.next!.before })
      )
    ).toBe("invalid_cursor")
  })

  it("never returns a colleague's or another venue's photos", async () => {
    const mine = new Set(
      (await uploads(v.w.staffA)).items.map((i) => i.assetId)
    )
    for (const who of [v.w.staffB, v.w.manager, other.w.staffA, v.w.admin]) {
      const theirs = (await uploads(who)).items.map((i) => i.assetId)
      expect(theirs.filter((id) => mine.has(id))).toEqual([])
    }
  })

  it("refuses the inactive and anon", async () => {
    expect(await errorOf(call(inactive, "my_uploads"))).toBe("not_active_user")
    const anon = await anonClient().rpc("my_uploads" as never, {} as never)
    expect(anon.error).not.toBeNull()
    expect(anon.data).toBeNull()
  })
})

// ---------------------------------------------------------------------------

describe("report_slot_change and the manager's list", () => {
  let dishReport: Report
  let photoAsset: string

  beforeAll(async () => {
    photoAsset = await dishPhoto(v, v.w.staffB, fish)
  })

  it("files a report on a slot at the caller's venue, once (AC26)", async () => {
    const a = await json<{ created: boolean; report: Report }>(
      v.w.staffA,
      "report_slot_change",
      { p_kind: "dish", p_subject_id: fish, p_reason: "no_longer_served" }
    )
    expect(a.created).toBe(true)
    expect(a.report).toMatchObject({
      venueId: v.w.venue,
      reporterId: v.w.staffA.id,
      subjectKind: "dish",
      subjectName: "Fish",
      reason: "no_longer_served",
      state: "open",
    })
    const again = await json<{ created: boolean; report: Report }>(
      v.w.staffA,
      "report_slot_change",
      { p_kind: "dish", p_subject_id: fish, p_reason: "no_longer_served" }
    )
    expect(again.created).toBe(false)
    expect(again.report.id).toBe(a.report.id)
    dishReport = a.report

    const area = await json<{ report: Report }>(
      v.w.staffB,
      "report_slot_change",
      { p_kind: "area", p_subject_id: v.bar, p_reason: "space_unavailable" }
    )
    expect(area.report.subjectName).toBe("Bar")
    const amenityId = Object.values(v.w.checks)[0]!
    const slots = await json<{
      slots: Array<{ kind: string; slotId: string }>
    }>(v.w.staffA, "coverage_slots")
    if (slots.slots.some((s) => s.kind === "amenity" && s.slotId === amenityId))
      expect(
        await errorOf(
          report(v.w.staffA, "amenity", amenityId, "appearance_changed")
        )
      ).toBeNull()
  })

  it("does not change coverage or the review state", async () => {
    const slot = (
      await json<{ slots: Array<{ slotId: string; state: string }> }>(
        v.w.staffA,
        "coverage_slots"
      )
    ).slots.find((s) => s.slotId === fish)
    expect(slot?.state).toBe("pending")
  })

  it("refuses another venue's slot, bad reasons and a missing note", async () => {
    const theirs = other.items["mains--pie"]!.itemId
    expect(
      await errorOf(report(v.w.staffA, "dish", theirs, "no_longer_served"))
    ).toBe("subject_not_found")
    expect(
      await errorOf(report(other.w.manager, "area", v.bar, "space_unavailable"))
    ).toBe("subject_not_found")
    expect(await errorOf(report(v.w.staffA, "dish", fish, "wrong_date"))).toBe(
      "invalid_reason"
    )
    expect(
      await errorOf(report(v.w.staffA, "spaceship", fish, "other", "x"))
    ).toBe("invalid_subject")
    expect(await errorOf(report(v.w.staffA, "dish", fish, "other"))).toBe(
      "note_required"
    )
    expect(
      await errorOf(report(inactive, "dish", fish, "appearance_changed"))
    ).toBe("not_active_user")
    const anon = await anonClient().rpc(
      "report_slot_change" as never,
      { p_kind: "dish", p_subject_id: fish, p_reason: "other" } as never
    )
    expect(anon.error).not.toBeNull()
  })

  it("takes a correction request on the caller's own photo only (AC15)", async () => {
    const mine = await json<{ report: Report }>(
      v.w.staffB,
      "report_slot_change",
      {
        p_kind: "photo",
        p_subject_id: photoAsset,
        p_reason: "wrong_label",
        p_note: "This is the pie, not the fish",
      }
    )
    expect(mine.report).toMatchObject({
      subjectKind: "photo",
      subjectName: "Fish",
      venueId: v.w.venue,
    })
    expect(
      await errorOf(report(v.w.staffA, "photo", photoAsset, "wrong_label"))
    ).toBe("subject_not_found")
    expect(
      await errorOf(report(v.w.manager, "photo", photoAsset, "wrong_date"))
    ).toBe("subject_not_found")
    expect(
      await errorOf(report(v.w.staffB, "photo", photoAsset, "no_longer_served"))
    ).toBe("invalid_reason")
  })

  it("shows each person only their own reports", async () => {
    const a = await json<{ items: Report[] }>(
      v.w.staffA,
      "my_slot_change_reports"
    )
    expect(a.items.every((r) => r.reporterId === v.w.staffA.id)).toBe(true)
    expect(a.items.map((r) => r.id)).toContain(dishReport.id)
    const b = await json<{ items: Report[] }>(
      v.w.staffB,
      "my_slot_change_reports"
    )
    expect(b.items.map((r) => r.id)).not.toContain(dishReport.id)
    expect(
      await errorOf(
        call(v.w.staffB, "withdraw_slot_change_report", {
          p_report_id: dishReport.id,
        })
      )
    ).toBe("report_not_found")
  })

  it("lists open reports for the venue's manager and an admin naming it", async () => {
    const list = await json<{ items: Report[] }>(
      v.w.manager,
      "slot_change_reports"
    )
    expect(list.items.map((r) => r.id)).toContain(dishReport.id)
    expect(list.items.every((r) => r.venueId === v.w.venue)).toBe(true)
    const admin = await json<{ items: Report[] }>(
      v.w.admin,
      "slot_change_reports",
      { p_venue_id: v.w.venue }
    )
    expect(admin.items.map((r) => r.id)).toContain(dishReport.id)
    for (const who of [v.w.staffA, other.w.manager])
      expect(
        await errorOf(
          call(who, "slot_change_reports", { p_venue_id: v.w.venue })
        )
      ).toBe("not_venue_manager")
    expect(await errorOf(call(v.w.admin, "slot_change_reports", {}))).toBe(
      "not_venue_manager"
    )
    expect(await errorOf(call(inactive, "slot_change_reports", {}))).toBe(
      "not_active_user"
    )
  })

  it("lets only the venue's manager or an admin decide, once", async () => {
    for (const who of [v.w.staffA, v.w.staffB, other.w.manager])
      expect(
        await errorOf(
          call(who, "decide_slot_change_report", {
            p_report_id: dishReport.id,
            p_action: "resolved",
          })
        )
      ).toBe("report_not_found")
    expect(
      await errorOf(
        call(v.w.manager, "decide_slot_change_report", {
          p_report_id: dishReport.id,
          p_action: "approved",
        })
      )
    ).toBe("invalid_decision")
    const done = await json<{ report: Report }>(
      v.w.manager,
      "decide_slot_change_report",
      {
        p_report_id: dishReport.id,
        p_action: "resolved",
        p_note: "Taken off the menu",
      }
    )
    expect(done.report.state).toBe("resolved")
    expect(
      await errorOf(
        call(v.w.admin, "decide_slot_change_report", {
          p_report_id: dishReport.id,
          p_action: "dismissed",
        })
      )
    ).toBe("report_closed")
    expect(
      await errorOf(
        call(v.w.staffA, "withdraw_slot_change_report", {
          p_report_id: dishReport.id,
        })
      )
    ).toBe("report_closed")
    expect(
      Number(
        psql(
          `select count(*) from public.activity_events
           where object_type = 'slot_change_report' and object_id = '${dishReport.id}'`
        )
      )
    ).toBe(2)
  })

  it("lets the reporter withdraw an open report", async () => {
    const r = await json<{ report: Report }>(v.w.staffA, "report_slot_change", {
      p_kind: "dish",
      p_subject_id: pie,
      p_reason: "appearance_changed",
    })
    const w = await json<{ report: Report }>(
      v.w.staffA,
      "withdraw_slot_change_report",
      { p_report_id: r.report.id }
    )
    expect(w.report.state).toBe("withdrawn")
  })

  it("keeps the tables closed and the history append-only", async () => {
    const direct = await v.w.staffA.client
      .from("slot_change_reports" as never)
      .select("*")
    expect(direct.error).not.toBeNull()
    expect(() =>
      psql(
        `update public.slot_change_report_events set note = 'x' where report_id = '${dishReport.id}'`
      )
    ).toThrow()
  })
})

// ---------------------------------------------------------------------------

describe("my_venue_managers", () => {
  it("names the managers of the caller's venue, and no other venue's", async () => {
    const read = await json<{
      venueId: string
      items: Array<{ id: string; displayName: string }>
    }>(v.w.staffA, "my_venue_managers")
    expect(read.venueId).toBe(v.w.venue)
    const ids = read.items.map((m) => m.id)
    expect(ids).toContain(v.w.manager.id)
    expect(ids).not.toContain(other.w.manager.id)
    expect(ids).not.toContain(v.w.staffB.id)
    const theirs = await json<{ items: Array<{ id: string }> }>(
      other.w.staffA,
      "my_venue_managers"
    )
    expect(theirs.items.map((m) => m.id)).not.toContain(v.w.manager.id)
  })

  it("gives an admin without a venue nothing, and refuses the inactive and anon", async () => {
    const read = await json<{ items: unknown[] }>(
      v.w.admin,
      "my_venue_managers"
    )
    expect(Array.isArray(read.items)).toBe(true)
    expect(await errorOf(call(inactive, "my_venue_managers"))).toBe(
      "not_active_user"
    )
    const anon = await anonClient().rpc("my_venue_managers" as never)
    expect(anon.error).not.toBeNull()
  })
})

describe("my_month_replacements", () => {
  it("counts own public slots this month and the outdated ones replaced", async () => {
    // A first public photo of the pie by staffB, then staffA's replacement.
    const b1 = await dishPhoto(
      other,
      other.w.staffB,
      other.items["mains--fish"]!.itemId
    )
    const fishO = other.items["mains--fish"]!.itemId
    await ok(
      call(other.w.manager, "set_menu_item_photo_level", {
        p_asset_id: b1,
        p_item_id: fishO,
        p_variant_id: null,
        p_level: "public",
        p_expected_revision: head(fishO),
      }) as never
    )
    const before = await json<{ covered: number; replaced: number }>(
      other.w.staffA,
      "my_month_replacements"
    )
    expect(before).toMatchObject({ covered: 0, replaced: 0 })
    const a1 = await dishPhoto(other, other.w.staffA, fishO)
    await ok(
      call(other.w.manager, "set_menu_item_photo_level", {
        p_asset_id: a1,
        p_item_id: fishO,
        p_variant_id: null,
        p_level: "public",
        p_expected_revision: head(fishO),
      }) as never
    )
    const after = await json<{ covered: number; replaced: number }>(
      other.w.staffA,
      "my_month_replacements"
    )
    expect(after).toMatchObject({ covered: 1, replaced: 1 })
    const b = await json<{ covered: number; replaced: number }>(
      other.w.staffB,
      "my_month_replacements"
    )
    expect(b).toMatchObject({ covered: 1, replaced: 0 })
    expect(await errorOf(call(inactive, "my_month_replacements"))).toBe(
      "not_active_user"
    )
    const anon = await anonClient().rpc("my_month_replacements" as never)
    expect(anon.error).not.toBeNull()
  })
})
