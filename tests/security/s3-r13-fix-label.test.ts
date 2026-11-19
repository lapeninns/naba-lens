// S3-R13 (20261118131000_fix_label_decided.sql): Fix label without a
// re-upload (spec §7 M2, AC15).
//   X7  a dish label with a decision (accepted, asked again) is corrected in
//       one step: the staff label's row is withdrawn with the reason, the
//       photo is accepted on the right dish, the staff label is kept.
//   X8  public.review_fix_label moves a photo to a place or an amenity, or
//       off one onto a dish, ending the source with the decision functions.
// Real signed-in identities through PostgREST; the service role and psql
// only build fixtures and read state back.
import { beforeAll, describe, expect, it } from "vitest"

import { anonClient, type TestIdentity } from "../support/identities"
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
  menu("TEST fix label", [
    section("mains", "Mains", [
      item("mains--pie", "Pie"),
      item("mains--soup", "Soup"),
      item("mains--stew", "Stew"),
    ]),
  ])

type Venue = { w: World; version: string; items: Record<string, CatalogueRow> }

async function venue(label: string): Promise<Venue> {
  const w = await world(label)
  const version = await publishMenu(w.admin, w.venue, MENU())
  const items = (await readDocument(service, version)).byKey
  return { w, version, items }
}

const id = (v: Venue, key: string) => v.items[key]!.itemId

async function dishPhoto(v: Venue, who: TestIdentity, key: string | null) {
  const asset = await reserveReady(service, who)
  await saveOk(who, {
    asset: asset.id,
    revision: 0,
    types: ["dish"],
    ...(key
      ? {
          items: [{ itemId: id(v, key), variantId: null }],
          catalogue: v.version,
        }
      : {}),
  })
  return asset.id
}

function head(itemId: string): number {
  return Number(
    psql(
      `select coalesce((select revision from public.menu_item_photo_heads where item_id = '${itemId}'), 1)`
    )
  )
}

function place(v: Venue, label: string) {
  return psql(
    `insert into public.knowledge_subjects (venue_id, kind, label, created_by)
     values ('${v.w.venue}', 'area', '${label}', '${v.w.admin.id}') returning id`
  )
}

async function areaPhoto(who: TestIdentity, subject: string) {
  const asset = (await reserveReady(service, who)).id
  const [row] = (await ok(
    who.client.rpc("set_media_area_label", {
      p_asset_id: asset,
      p_subject_id: subject,
    })
  )) as Array<{ label_id: string }>
  return { asset, label: row!.label_id }
}

const review = (
  who: TestIdentity,
  asset: string,
  itemId: string,
  decision: "accepted" | "better_photo_requested",
  reason?: string
) =>
  ok(
    who.client.rpc("review_menu_item_photo", {
      p_asset_id: asset,
      p_item_id: itemId,
      p_variant_id: null as unknown as string,
      p_decision: decision,
      p_expected_revision: head(itemId),
      p_make_primary: false,
      ...(reason ? { p_reason: reason } : {}),
    })
  )

const relink = (
  who: TestIdentity,
  asset: string,
  from: string,
  to: string,
  reason: string | null
) =>
  who.client.rpc("assign_menu_item_photo", {
    p_asset_id: asset,
    p_item_id: to,
    p_variant_id: null as unknown as string,
    p_corrects_item_id: from,
    p_corrects_variant_id: null as unknown as string,
    p_reason: reason as unknown as string,
    p_expected_revision: head(to),
  })

type FixArgs = {
  from: "dish" | "area" | "amenity" | "none"
  fromId?: string | null
  to: "dish" | "area" | "amenity"
  toId: string
  reason?: string
  level?: "public" | "reference"
  expected?: number
}
const fix = (
  who: { client: TestIdentity["client"] },
  asset: string,
  a: FixArgs
) =>
  who.client.rpc("review_fix_label", {
    p_asset_id: asset,
    p_from_kind: a.from,
    p_from_id: (a.fromId ?? null) as unknown as string,
    p_from_variant_id: null as unknown as string,
    p_to_kind: a.to,
    p_to_id: a.toId,
    ...(a.level ? { p_level: a.level } : {}),
    ...(a.reason ? { p_reason: a.reason } : {}),
    ...(a.expected != null ? { p_expected_revision: a.expected } : {}),
  })

/** The photo's live dish rows as "item:state:basis". */
function dishRows(asset: string, v: Venue): string[] {
  const names = Object.fromEntries(
    Object.entries(v.items).map(([k, r]) => [r.itemId, k])
  )
  const out = psql(
    `select string_agg(item_id || ':' || state || ':' || basis, ',' order by created_at, item_id)
     from public.menu_item_photos where asset_id = '${asset}'`
  )
  return out
    ? out.split(",").map((r) => {
        const [item, ...rest] = r.split(":")
        return [names[item!] ?? item, ...rest].join(":")
      })
    : []
}

const pending = (v: Venue, asset: string) =>
  psql(
    `select count(*) from private.menu_photo_pending_tuples('${v.w.venue}', true) where asset_id = '${asset}'`
  )

let a: Venue
let b: Venue

beforeAll(async () => {
  await knowledgeAdmin()
  ;[a, b] = await Promise.all([venue("r13-a"), venue("r13-b")])
})

describe("X7: Fix label on a decided dish label", () => {
  it("corrects an accepted label in one step and keeps the staff label", async () => {
    const asset = await dishPhoto(a, a.w.staffA, "mains--pie")
    await review(a.w.manager, asset, id(a, "mains--pie"), "accepted")

    // A correction still needs its reason.
    await fails(
      relink(
        a.w.manager,
        asset,
        id(a, "mains--pie"),
        id(a, "mains--soup"),
        null
      ),
      "reason_required"
    )
    const [row] = await ok(
      relink(
        a.w.manager,
        asset,
        id(a, "mains--pie"),
        id(a, "mains--soup"),
        "It is soup"
      )
    )
    expect(row!.state).toBe("accepted")
    expect(dishRows(asset, a)).toEqual([
      "mains--pie:withdrawn:staff_label",
      "mains--soup:accepted:reviewer",
    ])
    // The staff label is untouched; the withdrawal is its own event.
    expect(
      psql(
        `select count(*) from public.media_label_items where asset_id = '${asset}' and item_id = '${id(a, "mains--pie")}'`
      )
    ).toBe("1")
    expect(
      psql(
        `select reason || '|' || (detail ->> 'op') from public.menu_item_photo_events
         where asset_id = '${asset}' and action = 'withdrawn'`
      )
    ).toBe("It is soup|fix_label")
    expect(
      psql(
        `select corrects_item_id from public.menu_item_photos
         where asset_id = '${asset}' and state = 'accepted'`
      )
    ).toBe(id(a, "mains--pie"))

    // The detail marks the staff label as corrected, so Fix label is gone.
    const d = (await ok(
      a.w.manager.client.rpc("review_photo_detail", { p_asset_id: asset })
    )) as { dishes: Array<{ itemId: string; relinked: boolean }> }
    const pie = d.dishes.find((x) => x.itemId === id(a, "mains--pie"))
    expect(pie?.relinked).toBe(true)
    // A second correction of the same label waits for the first to go.
    await fails(
      relink(
        a.w.manager,
        asset,
        id(a, "mains--pie"),
        id(a, "mains--stew"),
        "x"
      ),
      "menu_item_relinked"
    )
  })

  it("corrects a label that was asked again", async () => {
    const asset = await dishPhoto(a, a.w.staffB, "mains--stew")
    await review(
      a.w.manager,
      asset,
      id(a, "mains--stew"),
      "better_photo_requested",
      "Blurry"
    )
    await ok(
      relink(a.w.admin, asset, id(a, "mains--stew"), id(a, "mains--pie"), "Pie")
    )
    expect(dishRows(asset, a)).toEqual([
      "mains--stew:withdrawn:staff_label",
      "mains--pie:accepted:reviewer",
    ])
  })

  it("refuses another venue, staff and anon", async () => {
    const asset = await dishPhoto(a, a.w.staffA, "mains--soup")
    await review(a.w.manager, asset, id(a, "mains--soup"), "accepted")
    const args = [
      asset,
      id(a, "mains--soup"),
      id(a, "mains--stew"),
      "x",
    ] as const
    await fails(relink(b.w.manager, ...args), "media_asset_not_found", "P0002")
    await fails(relink(a.w.staffB, ...args), "media_asset_not_found", "P0002")
    expect(dishRows(asset, a)).toEqual(["mains--soup:accepted:staff_label"])
  })
})

describe("X8: Fix label to a place or an amenity", () => {
  let bar: string
  let garden: string

  beforeAll(() => {
    bar = place(a, "Bar")
    garden = place(a, "Garden")
  })

  it("moves an accepted place photo to another place", async () => {
    const { asset, label } = await areaPhoto(a.w.staffA, garden)
    await ok(
      a.w.manager.client.rpc("review_decide_area_photo", {
        p_label_id: label,
        p_action: "accepted",
      })
    )
    await fails(
      fix(a.w.manager, asset, {
        from: "area",
        fromId: label,
        to: "area",
        toId: bar,
      }),
      "reason_required"
    )
    await fails(
      fix(a.w.manager, asset, {
        from: "area",
        fromId: label,
        to: "area",
        toId: garden,
        reason: "x",
      }),
      "fix_label_same_slot"
    )
    const out = (await ok(
      fix(a.w.manager, asset, {
        from: "area",
        fromId: label,
        to: "area",
        toId: bar,
        reason: "It shows the bar",
      })
    )) as { labelId: string }
    // The old label is closed with a withdrawal; the new one is credited to
    // the uploader, fixed by the manager, and accepted.
    expect(
      psql(
        `select (removed_at is not null)::text || '|' ||
           (select action from public.area_photo_decisions d where d.label_id = l.id order by id desc limit 1)
         from public.media_area_labels l where l.id = '${label}'`
      )
    ).toBe("true|withdrawn")
    expect(
      psql(
        `select subject_label || '|' || (added_by = '${a.w.staffA.id}')::text || '|' ||
           (fixed_by = '${a.w.manager.id}')::text || '|' || fixes_label_id
         from public.media_area_labels where id = '${out.labelId}'`
      )
    ).toBe(`Bar|true|true|${label}`)
    const accepted = await ok(
      a.w.manager.client.rpc("area_photo_queue", {
        p_venue_id: a.w.venue,
        p_status: "accepted",
      })
    )
    expect(
      accepted.filter((r) => r.asset_id === asset).map((r) => r.subject_label)
    ).toEqual(["Bar"])
  })

  it("moves a waiting dish label to a place", async () => {
    const asset = await dishPhoto(a, a.w.staffB, "mains--pie")
    expect(pending(a, asset)).toBe("1")
    await fails(
      fix(a.w.manager, asset, {
        from: "dish",
        fromId: id(a, "mains--pie"),
        to: "area",
        toId: garden,
        reason: "A garden table",
        expected: head(id(a, "mains--pie")) - 1,
      }),
      "coverage_conflict",
      "40001"
    )
    await ok(
      fix(a.w.manager, asset, {
        from: "dish",
        fromId: id(a, "mains--pie"),
        to: "area",
        toId: garden,
        reason: "A garden table",
        level: "reference",
        expected: head(id(a, "mains--pie")),
      })
    )
    expect(pending(a, asset)).toBe("0")
    expect(dishRows(asset, a)).toEqual(["mains--pie:withdrawn:staff_label"])
    expect(
      psql(
        `select l.subject_label || '|' || d.action || '|' || d.review_level
         from public.media_area_labels l
         join public.area_photo_decisions d on d.label_id = l.id
         where l.asset_id = '${asset}' and l.removed_at is null`
      )
    ).toBe("Garden|accepted|reference")
  })

  it("moves a Needs label photo to an amenity", async () => {
    const asset = await dishPhoto(a, a.w.staffA, null)
    const check = a.w.checks.onsite_parking!
    await ok(
      fix(a.w.manager, asset, { from: "none", to: "amenity", toId: check })
    )
    const rows = await ok(
      a.w.manager.client.rpc("amenity_photo_queue", {
        p_venue_id: a.w.venue,
        p_status: "accepted",
      })
    )
    expect(
      rows.filter((r) => r.asset_id === asset).map((r) => r.check_id)
    ).toEqual([check])
    // It now has a slot: no longer Needs label.
    expect(
      psql(`select private.asset_unlabelled_reason('${asset}') is null`)
    ).toBe("t")
  })

  it("moves an amenity photo onto a dish", async () => {
    const parking = await yes(a.w.staffB, a.w, "onsite_parking")
    const asset = psql(
      `select sa.asset_id from public.amenity_submission_assets sa
       where sa.submission_id = '${parking.submissionId}' limit 1`
    )
    const check = a.w.checks.onsite_parking!
    await ok(
      fix(a.w.manager, asset, {
        from: "amenity",
        fromId: check,
        to: "dish",
        toId: id(a, "mains--stew"),
        reason: "It is the stew",
        expected: head(id(a, "mains--stew")),
      })
    )
    expect(
      psql(
        `select action from public.amenity_photo_decisions
         where check_id = '${check}' and asset_id = '${asset}' order by id desc limit 1`
      )
    ).toBe("not_used")
    expect(dishRows(asset, a)).toEqual(["mains--stew:accepted:reviewer"])
  })

  it("keeps the unlabelled rule for a direct dish assignment", async () => {
    // No tag, no label, uploaded today: not listed, not food or drink. The
    // move's allowance is for review_fix_label's own transaction only.
    const asset = (await reserveReady(service, a.w.staffA)).id
    await fails(
      a.w.manager.client.rpc("assign_menu_item_photo", {
        p_asset_id: asset,
        p_item_id: id(a, "mains--pie"),
        p_variant_id: null as unknown as string,
        p_corrects_item_id: null as unknown as string,
        p_corrects_variant_id: null as unknown as string,
        p_reason: null as unknown as string,
        p_expected_revision: head(id(a, "mains--pie")),
      }),
      "evidence_not_eligible"
    )
  })

  it("refuses dish to dish, other venues, staff, set-aside photos and anon", async () => {
    const { asset, label } = await areaPhoto(a.w.staffA, bar)
    const args: FixArgs = {
      from: "area",
      fromId: label,
      to: "area",
      toId: garden,
      reason: "x",
    }
    await fails(
      fix(a.w.manager, asset, {
        from: "dish",
        fromId: id(a, "mains--pie"),
        to: "dish",
        toId: id(a, "mains--soup"),
        reason: "x",
      }),
      "invalid_input",
      "22023"
    )
    await fails(fix(b.w.manager, asset, args), "media_asset_not_found", "P0002")
    await fails(fix(a.w.staffB, asset, args), "media_asset_not_found", "P0002")
    // A place in another venue is not a target.
    await fails(
      fix(a.w.manager, asset, { ...args, toId: place(b, "Elsewhere") }),
      "area_wrong_venue"
    )
    const { error } = await anonClient().rpc("review_fix_label", {
      p_asset_id: asset,
      p_from_kind: "area",
      p_from_id: label,
      p_from_variant_id: null as unknown as string,
      p_to_kind: "area",
      p_to_id: garden,
    })
    expect(error?.code).toBe("42501")
    await ok(
      a.w.manager.client.rpc("review_set_aside", {
        p_asset_id: asset,
        p_action: "not_used",
        p_reason: "Blurry",
      })
    )
    await fails(fix(a.w.manager, asset, args), "review_conflict", "40001")
    // Nothing moved.
    expect(
      psql(
        `select subject_label from public.media_area_labels where asset_id = '${asset}' and removed_at is null`
      )
    ).toBe("Bar")
  })
})
