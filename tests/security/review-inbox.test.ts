// S2-REVIEW (20261118110000_review_inbox.sql): the manager review inbox.
// Needs label photos sit in the main queue with Awaiting review (FA-4);
// filters for category, age and possible duplicates; Not used, Mark
// duplicate and Restore on a whole photo with a stale check; stale-checked
// place and amenity decisions; the photo detail read; and a Label corrected
// notice. Every new function is probed for its own venue, another venue,
// staff, manager and admin, an inactive manager and anon. Real signed-in
// identities through PostgREST; the service role and psql only build
// fixtures and read state back.
import { beforeAll, describe, expect, it } from "vitest"

import {
  anonClient,
  createIdentity,
  type TestIdentity,
} from "../support/identities"
import { fails, ok, psql } from "./coverage-fixtures"
import {
  admin as knowledgeAdmin,
  service,
  world,
  yes,
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

const MENU = () =>
  menu("TEST review inbox", [
    section("mains", "Mains", [
      item("mains--pie", "Pie"),
      item("mains--soup", "Soup"),
      item("mains--stew", "Stew"),
    ]),
    section("drinks", "Drinks", [item("drinks--ale", "Ale")], "drinks"),
  ])

type Venue = {
  w: World
  version: string
  items: Record<string, CatalogueRow>
}

async function venue(label: string): Promise<Venue> {
  const w = await world(label)
  const version = await publishMenu(w.admin, w.venue, MENU())
  const items = (await readDocument(service, version)).byKey
  return { w, version, items }
}

/** A ready photo by `who`, labelled with one dish (or content types only). */
async function dishPhoto(
  v: Venue,
  who: TestIdentity,
  itemKey: string | null,
  types: string[] = itemKey?.startsWith("drinks") ? ["drinks"] : ["dish"]
) {
  const asset = await reserveReady(service, who)
  await saveOk(who, {
    asset: asset.id,
    revision: 0,
    types,
    ...(itemKey
      ? {
          items: [{ itemId: v.items[itemKey]!.itemId, variantId: null }],
          catalogue: v.version,
        }
      : {}),
  })
  return asset.id
}

const queue = (
  who: { client: TestIdentity["client"] },
  venueId: string | null,
  args: Record<string, unknown> = {}
) =>
  who.client.rpc("manager_menu_photo_queue", {
    ...(venueId ? { p_venue_id: venueId } : {}),
    p_limit: 101,
    ...args,
  })

const setAside = (
  who: { client: TestIdentity["client"] },
  asset: string,
  action: "not_used" | "duplicate" | "restored",
  opts: {
    reason?: string
    code?: string
    duplicateOf?: string
    expected?: number | null
  } = {}
) =>
  who.client.rpc("review_set_aside", {
    p_asset_id: asset,
    p_action: action,
    ...(opts.reason ? { p_reason: opts.reason } : {}),
    ...(opts.code ? { p_reason_code: opts.code } : {}),
    ...(opts.duplicateOf ? { p_duplicate_of: opts.duplicateOf } : {}),
    ...(opts.expected != null
      ? { p_expected_disposition_id: opts.expected }
      : {}),
  })

const detail = (who: { client: TestIdentity["client"] }, asset: string) =>
  who.client.rpc("review_photo_detail", { p_asset_id: asset })

function head(itemId: string): number {
  return Number(
    psql(
      `select coalesce((select revision from public.menu_item_photo_heads where item_id = '${itemId}'), 1)`
    )
  )
}

async function accept(who: TestIdentity, asset: string, itemId: string) {
  await ok(
    who.client.rpc("review_menu_item_photo", {
      p_asset_id: asset,
      p_item_id: itemId,
      p_variant_id: null as unknown as string,
      p_decision: "accepted",
      p_expected_revision: head(itemId),
      p_make_primary: false,
    })
  )
}

function place(v: Venue, label: string) {
  return psql(
    `insert into public.knowledge_subjects (venue_id, kind, label, created_by)
     values ('${v.w.venue}', 'area', '${label}', '${v.w.admin.id}') returning id`
  )
}

async function areaPhoto(v: Venue, who: TestIdentity, subject: string) {
  const asset = (await reserveReady(service, who)).id
  const [row] = (await ok(
    who.client.rpc("set_media_area_label", {
      p_asset_id: asset,
      p_subject_id: subject,
    })
  )) as Array<{ label_id: string }>
  return { asset, label: row!.label_id }
}

let a: Venue
let b: Venue
let inactive: TestIdentity

beforeAll(async () => {
  await knowledgeAdmin()
  ;[a, b] = await Promise.all([venue("rvi-a"), venue("rvi-b")])
  inactive = await createIdentity(service, {
    label: "rvi-a-gone",
    role: "manager",
    venueId: a.w.venue,
  })
  psql(`update public.profiles set active = false where id = '${inactive.id}'`)
})

describe("the main queue", () => {
  let waiting: string
  let needsLabel: string
  let drink: string

  beforeAll(async () => {
    waiting = await dishPhoto(a, a.w.staffA, "mains--pie")
    needsLabel = await dishPhoto(a, a.w.staffA, null)
    drink = await dishPhoto(a, a.w.staffB, "drinks--ale")
  })

  it("holds Needs label photos with Awaiting review, oldest first", async () => {
    const rows = await ok(queue(a.w.manager, a.w.venue))
    const mine = rows.filter((r) =>
      [waiting, needsLabel, drink].includes(r.asset_id)
    )
    expect(mine.map((r) => [r.asset_id, r.kind])).toEqual([
      [waiting, "labelled"],
      [needsLabel, "unlabelled"],
      [drink, "labelled"],
    ])
    const one = mine[0]!
    expect(one.captured_at_source).toBe("unknown")
    expect(one.captured_at).toBeNull()
    expect(one.possible_duplicate).toBe(false)
    expect(one.section_kind).toBe("food")
  })

  it("filters by category, age and possible duplicate", async () => {
    const drinks = await ok(
      queue(a.w.manager, a.w.venue, { p_section_kind: "drinks" })
    )
    expect(drinks.map((r) => r.asset_id)).toEqual([drink])

    psql(
      `set session_replication_role = replica; update public.media_assets set created_at = now() - interval '9 days' where id = '${waiting}'`
    )
    const old = await ok(queue(a.w.manager, a.w.venue, { p_min_age_days: 7 }))
    expect(old.map((r) => r.asset_id)).toEqual([waiting])

    const hash = "a".repeat(64)
    psql(
      `update public.media_assets set content_sha256 = '${hash}' where id in ('${waiting}', '${drink}')`
    )
    const dupes = await ok(
      queue(a.w.manager, a.w.venue, { p_possible_duplicate: true })
    )
    expect(dupes.map((r) => r.asset_id).sort()).toEqual([waiting, drink].sort())
    await fails(
      queue(a.w.manager, a.w.venue, { p_section_kind: "spaces" }),
      "invalid_section_kind",
      "22023"
    )
  })

  it("is the venue's manager's and an admin's, no one else's", async () => {
    const asAdmin = await ok(queue(a.w.admin, a.w.venue))
    expect(asAdmin.some((r) => r.asset_id === needsLabel)).toBe(true)
    const { error: other } = await queue(b.w.manager, a.w.venue)
    expect(other).not.toBeNull()
    const { error: staff } = await queue(a.w.staffB, a.w.venue)
    expect(staff).not.toBeNull()
    const { error: gone } = await queue(inactive, a.w.venue)
    expect(gone).not.toBeNull()
    const { error: anon } = await anonClient().rpc("manager_menu_photo_queue", {
      p_venue_id: a.w.venue,
    })
    expect(anon?.code).toBe("42501")
  })
})

describe("Not used, Mark duplicate and Restore", () => {
  let photo: string
  let original: string
  let copy: string

  beforeAll(async () => {
    photo = await dishPhoto(a, a.w.staffA, "mains--soup")
    original = await dishPhoto(a, a.w.staffA, "mains--stew")
    await accept(a.w.manager, original, a.items["mains--stew"]!.itemId)
    copy = await dishPhoto(a, a.w.staffB, "mains--stew")
  })

  it("refuses other venues, staff, inactive accounts and anon", async () => {
    await fails(
      setAside(b.w.manager, photo, "not_used", { reason: "Blurry" }),
      "media_asset_not_found",
      "P0002"
    )
    await fails(
      setAside(a.w.staffB, photo, "not_used", { reason: "Blurry" }),
      "media_asset_not_found",
      "P0002"
    )
    await fails(
      setAside(inactive, photo, "not_used", { reason: "Blurry" }),
      "not_active_user",
      "42501"
    )
    const { error } = await anonClient().rpc("review_set_aside", {
      p_asset_id: photo,
      p_action: "not_used",
      p_reason: "Blurry",
    })
    expect(error?.code).toBe("42501")
  })

  it("never lets a manager set aside their own photo", async () => {
    const own = await dishPhoto(a, a.w.manager, "mains--soup")
    await fails(
      setAside(a.w.manager, own, "not_used", { reason: "Mine" }),
      "self_review_not_allowed",
      "42501"
    )
  })

  it("needs a reason, then takes the photo out of the queue and keeps it", async () => {
    await fails(
      setAside(a.w.manager, photo, "not_used"),
      "reason_required",
      "P0001"
    )
    const out = (await ok(
      setAside(a.w.manager, photo, "not_used", {
        reason: "Not one of ours",
        code: "not_relevant",
      })
    )) as { dispositionId: number }
    const rows = await ok(queue(a.w.manager, a.w.venue))
    expect(rows.some((r) => r.asset_id === photo)).toBe(false)
    expect(
      psql(
        `select deleted_at is null from public.media_assets where id = '${photo}'`
      )
    ).toBe("t")

    // A stale screen cannot replace it.
    const stale = await fails(
      setAside(a.w.manager, photo, "restored"),
      "review_conflict",
      "40001"
    )
    expect(JSON.parse(stale.details ?? "{}").action).toBe("not_used")

    await ok(
      setAside(a.w.admin, photo, "restored", { expected: out.dispositionId })
    )
    const back = await ok(queue(a.w.manager, a.w.venue))
    expect(back.some((r) => r.asset_id === photo)).toBe(true)
  })

  it("links a duplicate only to an accepted photo at the venue", async () => {
    await fails(
      setAside(a.w.manager, copy, "duplicate", { duplicateOf: photo }),
      "duplicate_target_invalid",
      "P0001"
    )
    const other = await dishPhoto(b, b.w.staffA, "mains--pie")
    await accept(b.w.manager, other, b.items["mains--pie"]!.itemId)
    await fails(
      setAside(a.w.manager, copy, "duplicate", { duplicateOf: other }),
      "duplicate_target_invalid",
      "P0001"
    )
    await ok(
      setAside(a.w.manager, copy, "duplicate", { duplicateOf: original })
    )
    expect(
      psql(
        `select duplicate_of_asset_id from public.review_dispositions where asset_id = '${copy}' order by id desc limit 1`
      )
    ).toBe(original)
    // The duplicate earns nothing: it no longer waits for the dish.
    const rows = await ok(
      queue(a.w.manager, a.w.venue, {
        p_item_id: a.items["mains--stew"]!.itemId,
      })
    )
    expect(rows.some((r) => r.asset_id === copy)).toBe(false)
  })

  it("asks for a decided photo to be withdrawn first", async () => {
    await fails(
      setAside(a.w.manager, original, "not_used", { reason: "Old" }),
      "withdraw_first",
      "P0001"
    )
  })
})

describe("stale-checked place and amenity decisions", () => {
  let label: string
  let areaAsset: string

  beforeAll(async () => {
    const bar = place(a, "Bar")
    ;({ label, asset: areaAsset } = await areaPhoto(a, a.w.staffA, bar))
  })

  it("decides against the decision the reviewer saw", async () => {
    const [first] = await ok(
      a.w.manager.client.rpc("review_decide_area_photo", {
        p_label_id: label,
        p_action: "accepted",
        p_level: "reference",
      })
    )
    expect(first!.state).toBe("accepted")
    expect(first!.review_level).toBe("reference")
    const stale = await fails(
      a.w.admin.client.rpc("review_decide_area_photo", {
        p_label_id: label,
        p_action: "accepted",
        p_level: "public",
      }),
      "review_conflict",
      "40001"
    )
    expect(JSON.parse(stale.details ?? "{}").level).toBe("reference")
    const [second] = await ok(
      a.w.admin.client.rpc("review_decide_area_photo", {
        p_label_id: label,
        p_action: "accepted",
        p_level: "public",
        p_expected_decision_id: first!.decision_id,
      })
    )
    expect(second!.review_level).toBe("public")
    expect(
      psql(
        `select previous_decision_id from public.area_photo_decisions where id = ${second!.decision_id}`
      )
    ).toBe(String(first!.decision_id))
  })

  it("refuses other venues, staff, inactive accounts and anon", async () => {
    const args = { p_label_id: label, p_action: "withdrawn", p_reason: "x" }
    await fails(
      b.w.manager.client.rpc("review_decide_area_photo", args),
      "area_photo_not_found",
      "P0002"
    )
    await fails(
      a.w.staffB.client.rpc("review_decide_area_photo", args),
      "area_photo_not_found",
      "P0002"
    )
    await fails(
      inactive.client.rpc("review_decide_area_photo", args),
      "not_active_user",
      "42501"
    )
    const { error } = await anonClient().rpc("review_decide_area_photo", args)
    expect(error?.code).toBe("42501")
  })

  it("decides an amenity photo with the same check", async () => {
    const parking = await yes(a.w.staffA, a.w, "onsite_parking")
    const asset = psql(
      `select sa.asset_id from public.amenity_submission_assets sa
       where sa.submission_id = '${parking.submissionId}' limit 1`
    )
    const check = a.w.checks.onsite_parking!
    const args = {
      p_check_id: check,
      p_asset_id: asset,
      p_action: "accepted",
      p_level: "reference",
    }
    await fails(
      b.w.manager.client.rpc("review_decide_amenity_photo", args),
      "amenity_photo_not_found",
      "P0002"
    )
    await fails(
      a.w.staffB.client.rpc("review_decide_amenity_photo", args),
      "amenity_photo_not_found",
      "P0002"
    )
    await fails(
      inactive.client.rpc("review_decide_amenity_photo", args),
      "not_active_user",
      "42501"
    )
    const { error } = await anonClient().rpc(
      "review_decide_amenity_photo",
      args
    )
    expect(error?.code).toBe("42501")

    const [first] = await ok(
      a.w.manager.client.rpc("review_decide_amenity_photo", args)
    )
    expect(first!.review_level).toBe("reference")
    await fails(
      a.w.manager.client.rpc("review_decide_amenity_photo", {
        ...args,
        p_level: "public",
      }),
      "review_conflict",
      "40001"
    )
    const [second] = await ok(
      a.w.manager.client.rpc("review_decide_amenity_photo", {
        ...args,
        p_level: "public",
        p_expected_decision_id: first!.decision_id,
      })
    )
    expect(second!.review_level).toBe("public")
  })

  it("records Not used on a photo's waiting place when it is set aside", async () => {
    const snug = place(a, "Snug")
    const p = await areaPhoto(a, a.w.staffB, snug)
    await ok(setAside(a.w.manager, p.asset, "not_used", { reason: "Blurry" }))
    expect(
      psql(
        `select action from public.area_photo_decisions where label_id = '${p.label}' order by id desc limit 1`
      )
    ).toBe("not_used")
    expect(areaAsset).toBeTruthy()
  })
})

describe("the photo detail", () => {
  let photo: string

  beforeAll(async () => {
    photo = await dishPhoto(a, a.w.staffB, "mains--pie")
    psql(
      `update public.media_labels set note = 'From the pass' where asset_id = '${photo}'`
    )
    psql(
      `update public.media_assets set captured_at = now() - interval '1 day', captured_at_source = 'metadata' where id = '${photo}'`
    )
  })

  it("shows provenance, slots, note and history to the venue's manager and an admin", async () => {
    const d = (await ok(detail(a.w.manager, photo))) as Record<string, unknown>
    expect(d.assetId).toBe(photo)
    expect(d.capturedAtSource).toBe("metadata")
    expect(d.note).toBe("From the pass")
    expect(d.selfBlocked).toBe(false)
    expect((d.contributor as { id: string }).id).toBe(a.w.staffB.id)
    const dishes = d.dishes as Array<Record<string, unknown>>
    expect(dishes).toHaveLength(1)
    expect(dishes[0]!.itemId).toBe(a.items["mains--pie"]!.itemId)
    expect(dishes[0]!.waiting).toBe(true)
    expect(dishes[0]!.presentationRevision).toBe(1)
    expect(Array.isArray(d.history)).toBe(true)
    await ok(detail(a.w.admin, photo))
  })

  it("refuses other venues, staff, inactive accounts and anon", async () => {
    await fails(detail(b.w.manager, photo), "media_asset_not_found", "P0002")
    await fails(detail(a.w.staffA, photo), "media_asset_not_found", "P0002")
    await fails(detail(inactive, photo), "not_active_user", "42501")
    const { error } = await anonClient().rpc("review_photo_detail", {
      p_asset_id: photo,
    })
    expect(error?.code).toBe("42501")
  })
})

describe("Label corrected", () => {
  it("tells the contributor when a reviewer matches their photo to another dish", async () => {
    const photo = await dishPhoto(a, a.w.staffB, "mains--soup")
    const target = a.items["mains--pie"]!.itemId
    await ok(
      a.w.manager.client.rpc("assign_menu_item_photo", {
        p_asset_id: photo,
        p_item_id: target,
        p_variant_id: null as unknown as string,
        p_corrects_item_id: a.items["mains--soup"]!.itemId,
        p_corrects_variant_id: null as unknown as string,
        p_reason: "It is the pie",
        p_expected_revision: head(target),
        p_make_primary: false,
      })
    )
    const row = psql(
      `select kind || '|' || (payload ->> 'itemName') || '|' || (payload ->> 'fromItemName')
       from public.notifications where recipient_id = '${a.w.staffB.id}' and kind = 'label_corrected'
       order by id desc limit 1`
    )
    expect(row).toBe("label_corrected|Pie|Soup")
  })
})
