// Full App v1, S1-COV: one coverage rule for every slot, the review level
// (public or reference), the amenity photo requirement separate from its
// fact, and primaries for every slot kind (spec §2, §10 inv. 3, 4, 7, 8,
// §18.1; FA-11, FA-30, FA-31, FA-32; AC16, AC24, AC26, AC35, AC39).
// Migrations 20261118100000-100200. Real signed-in identities through
// PostgREST; the service role and psql only build fixtures and read back.
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import {
  anonClient,
  createIdentity,
  type TestIdentity,
} from "../support/identities"
import { ok, psql, requestKey } from "./coverage-fixtures"
import {
  admin as knowledgeAdmin,
  call,
  decide,
  json,
  service,
  submit,
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

type Slot = {
  kind: "dish" | "amenity" | "area"
  slotId: string
  category: string
  state: string
  counted: boolean
  unavailable: boolean
  primaryAssetId: string | null
  pendingCount: number
}
type Counts = Record<string, number>
type Coverage = {
  venueId: string
  slots: Slot[]
  categories: Array<{ category: string } & Counts>
  totals: Counts
}

const coverage = (who: TestIdentity, venue?: string) =>
  json<Coverage>(who, "coverage_slots", venue ? { p_venue_id: venue } : {})

const stateOf = async (who: TestIdentity, slotId: string, venue?: string) =>
  (await coverage(who, venue)).slots.find((s) => s.slotId === slotId)

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
  places: { bar: string; garden: string }
}

const MENU = () =>
  menu("TEST coverage", [
    section("mains", "Mains", [
      item("mains--pie", "Pie"),
      item("mains--fish", "Fish"),
    ]),
    section("drinks", "Drinks", [item("drinks--ale", "Ale")], "drinks"),
  ])

async function venue(label: string): Promise<V> {
  const w = await world(label)
  const version = await publishMenu(w.admin, w.venue, MENU())
  const items = (await readDocument(service, version)).byKey
  const place = (name: string) =>
    psql(
      `insert into public.knowledge_subjects (venue_id, kind, label, created_by)
       values ('${w.venue}', 'area', '${name}', '${w.admin.id}') returning id`
    )
  return {
    w,
    version,
    items,
    places: { bar: place("Bar"), garden: place("Garden") },
  }
}

/** A ready photo by `who`, labelled with a dish on the active menu. */
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

/** A ready photo by `who`, labelled with a place. */
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

const setLevel = (
  who: TestIdentity,
  asset: string,
  itemId: string,
  level: string,
  key?: string
) =>
  call(who, "set_menu_item_photo_level", {
    p_asset_id: asset,
    p_item_id: itemId,
    p_variant_id: null,
    p_level: level,
    p_expected_revision: head(itemId),
    ...(key ? { p_client_request_key: key } : {}),
  })

const decideArea = (
  who: TestIdentity,
  label: string,
  action: string,
  level = "public",
  reason?: string
) =>
  call(who, "decide_area_photo_level", {
    p_label_id: label,
    p_action: action,
    p_level: level,
    ...(reason ? { p_reason: reason } : {}),
  })

const decideAmenity = (
  who: TestIdentity,
  check: string,
  asset: string,
  action: string,
  level = "public",
  reason?: string
) =>
  call(who, "decide_amenity_photo", {
    p_check_id: check,
    p_asset_id: asset,
    p_action: action,
    p_level: level,
    ...(reason ? { p_reason: reason } : {}),
  })

let v: V
let other: V
let inactive: TestIdentity

beforeAll(async () => {
  await knowledgeAdmin()
  ;[v, other] = await Promise.all([venue("cov-s1"), venue("cov-s1-o")])
  inactive = await createIdentity(service, {
    label: "cov-s1-inactive",
    role: "staff",
    venueId: v.w.venue,
  })
  await ok(
    service.from("profiles").update({ active: false }).eq("id", inactive.id)
  )
})

// ---------------------------------------------------------------------------

describe("coverage_slots: access", () => {
  it("serves staff and the manager at the venue, and an admin naming it", async () => {
    const mine = await coverage(v.w.staffB)
    expect(mine.venueId).toBe(v.w.venue)
    expect(await coverage(v.w.manager)).toEqual(mine)
    expect(await coverage(v.w.admin, v.w.venue)).toEqual(mine)
  })

  it("refuses another venue, an admin without a venue, the inactive and anon", async () => {
    expect(
      await errorOf(
        call(v.w.staffA, "coverage_slots", { p_venue_id: other.w.venue })
      )
    ).toBe("wrong_venue")
    expect(
      await errorOf(
        call(v.w.manager, "coverage_slots", { p_venue_id: other.w.venue })
      )
    ).toBe("wrong_venue")
    expect(await errorOf(call(v.w.admin, "coverage_slots", {}))).toBe(
      "venue_required"
    )
    expect(await errorOf(call(inactive, "coverage_slots", {}))).not.toBeNull()
    const anon = await anonClient().rpc("coverage_slots" as never, {} as never)
    expect(anon.error).not.toBeNull()
    expect(anon.data).toBeNull()
  })

  it("lists every slot kind under the five categories", async () => {
    const read = await coverage(v.w.staffA)
    const kinds = new Set(read.slots.map((s) => `${s.kind}:${s.category}`))
    expect(kinds).toEqual(
      new Set(["dish:food", "dish:drinks", "area:spaces", "amenity:facilities"])
    )
    expect(read.categories.map((c) => c.category)).toEqual([
      "food",
      "drinks",
      "spaces",
      "facilities",
      "other",
    ])
  })
})

describe("dishes: review level (FA-31, AC16) and primary (AC35)", () => {
  it("keeps a reference photo stored while the requirement stays open", async () => {
    const pie = v.items["mains--pie"]!.itemId
    const asset = await dishPhoto(v, v.w.staffA, pie)
    expect((await stateOf(v.w.staffB, pie))!.state).toBe("pending")

    const { data, error } = await setLevel(v.w.manager, asset, pie, "reference")
    expect(error).toBeNull()
    expect(
      (data as Array<{ review_level: string; is_primary: boolean }>)[0]
    ).toMatchObject({
      review_level: "reference",
      is_primary: false,
    })
    const slot = (await stateOf(v.w.staffB, pie))!
    expect(slot.state).toBe("missing")
    expect(slot.primaryAssetId).toBeNull()
    // Still stored and accepted, with a level_set event in its history.
    expect(
      psql(
        `select state || ',' || review_level from public.menu_item_photos
         where asset_id = '${asset}' and item_id = '${pie}'`
      )
    ).toBe("accepted,reference")
    expect(
      psql(
        `select (deleted_at is null)::text from public.media_assets where id = '${asset}'`
      )
    ).toBe("true")
    const usages = await json<{
      items: Array<{ assetId: string; state: string }>
    }>(v.w.manager, "asset_usages", { p_asset_id: asset })
    expect(usages.items).toEqual([
      expect.objectContaining({ assetId: asset, state: "reference" }),
    ])

    // Approve for public use: covered, and it becomes the primary.
    expect((await setLevel(v.w.manager, asset, pie, "public")).error).toBeNull()
    const covered = (await stateOf(v.w.staffB, pie))!
    expect(covered.state).toBe("covered")
    expect(covered.primaryAssetId).toBe(asset)
    expect(
      psql(
        `select string_agg(action, ',' order by id) from public.menu_item_photo_events
         where asset_id = '${asset}' and item_id = '${pie}'`
      )
    ).toBe("accepted,level_set,primary_cleared,level_set,primary_set")
  })

  it("moves the primary atomically when the primary is kept as reference", async () => {
    const fish = v.items["mains--fish"]!.itemId
    const first = await dishPhoto(v, v.w.staffA, fish)
    const second = await dishPhoto(v, v.w.staffB, fish)
    expect(
      (await setLevel(v.w.manager, first, fish, "public")).error
    ).toBeNull()
    expect(
      (await setLevel(v.w.manager, second, fish, "public")).error
    ).toBeNull()
    expect((await stateOf(v.w.staffA, fish))!.primaryAssetId).toBe(first)

    expect(
      (await setLevel(v.w.manager, first, fish, "reference")).error
    ).toBeNull()
    expect((await stateOf(v.w.staffA, fish))!.primaryAssetId).toBe(second)
    expect(
      psql(
        `select count(*) from public.menu_item_photos where item_id = '${fish}' and is_primary`
      )
    ).toBe("1")
    // A reference photo can never be made primary.
    const refused = await call(v.w.manager, "set_menu_item_primary_photo", {
      p_photo_id: psql(
        `select id from public.menu_item_photos where asset_id = '${first}' and item_id = '${fish}'`
      ),
      p_expected_revision: head(fish),
    })
    expect(refused.error).not.toBeNull()
  })

  it("replays a request key and refuses its reuse for another level", async () => {
    const ale = v.items["drinks--ale"]!.itemId
    const asset = await dishPhoto(v, v.w.staffA, ale)
    const key = requestKey()
    expect(
      (await setLevel(v.w.manager, asset, ale, "reference", key)).error
    ).toBeNull()
    const again = await setLevel(v.w.manager, asset, ale, "reference", key)
    expect(again.error).toBeNull()
    expect((again.data as Array<{ replayed: boolean }>)[0]!.replayed).toBe(true)
    expect(
      await errorOf(setLevel(v.w.manager, asset, ale, "public", key))
    ).toBe("idempotency_key_reused")
  })

  it("is refused to staff, another venue's manager, and a stale revision", async () => {
    const pie = v.items["mains--pie"]!.itemId
    const asset = await dishPhoto(v, v.w.staffA, pie)
    expect(await errorOf(setLevel(v.w.staffB, asset, pie, "reference"))).toBe(
      "media_asset_not_found"
    )
    expect(
      await errorOf(setLevel(other.w.manager, asset, pie, "reference"))
    ).toBe("media_asset_not_found")
    expect(
      await errorOf(setLevel(inactive, asset, pie, "reference"))
    ).not.toBeNull()
    expect(
      await errorOf(
        call(v.w.manager, "set_menu_item_photo_level", {
          p_asset_id: asset,
          p_item_id: pie,
          p_variant_id: null,
          p_level: "reference",
          p_expected_revision: head(pie) + 5,
        })
      )
    ).toBe("coverage_conflict")
    expect(await errorOf(setLevel(v.w.manager, asset, pie, "best"))).toBe(
      "invalid_level"
    )
    const anon = await anonClient().rpc(
      "set_menu_item_photo_level" as never,
      {
        p_asset_id: asset,
        p_item_id: pie,
        p_variant_id: null,
        p_level: "reference",
        p_expected_revision: 1,
      } as never
    )
    expect(anon.error).not.toBeNull()
  })

  it("lets an admin set the level at any venue", async () => {
    const ale = other.items["drinks--ale"]!.itemId
    const asset = await dishPhoto(other, other.w.staffA, ale)
    expect((await setLevel(v.w.admin, asset, ale, "public")).error).toBeNull()
    expect((await stateOf(other.w.staffA, ale))!.state).toBe("covered")
  })
})

describe("areas: level, Not used and primary", () => {
  it("leaves a reference place photo missing and a public one covered", async () => {
    const ref = await areaPhoto(v.w.staffA, v.places.bar)
    expect((await stateOf(v.w.staffB, v.places.bar))!.state).toBe("pending")
    expect(
      (await decideArea(v.w.manager, ref.label, "accepted", "reference")).error
    ).toBeNull()
    expect((await stateOf(v.w.staffB, v.places.bar))!.state).toBe("missing")
    // The older signature means a public acceptance.
    expect(
      (
        await call(v.w.manager, "decide_area_photo", {
          p_label_id: ref.label,
          p_action: "accepted",
        })
      ).error
    ).toBeNull()
    const slot = (await stateOf(v.w.staffB, v.places.bar))!
    expect(slot).toMatchObject({ state: "covered", primaryAssetId: ref.asset })
  })

  it("records Not used and a retake request", async () => {
    const one = await areaPhoto(v.w.staffA, v.places.garden)
    expect(await errorOf(decideArea(v.w.manager, one.label, "not_used"))).toBe(
      "reason_required"
    )
    expect(
      (
        await decideArea(
          v.w.manager,
          one.label,
          "not_used",
          "public",
          "Blurred"
        )
      ).error
    ).toBeNull()
    expect((await stateOf(v.w.staffA, v.places.garden))!.state).toBe("missing")
    const two = await areaPhoto(v.w.staffB, v.places.garden)
    expect(
      (
        await decideArea(
          v.w.manager,
          two.label,
          "needs_another_photo",
          "public",
          "Too dark"
        )
      ).error
    ).toBeNull()
    expect((await stateOf(v.w.staffA, v.places.garden))!.state).toBe(
      "replacement_needed"
    )
  })

  it("chooses the primary among public photos only, atomically", async () => {
    const second = await areaPhoto(v.w.staffB, v.places.bar)
    expect(
      (await decideArea(v.w.manager, second.label, "accepted")).error
    ).toBeNull()
    // The newest public photo leads until someone chooses.
    expect((await stateOf(v.w.staffA, v.places.bar))!.primaryAssetId).toBe(
      second.asset
    )
    const first = psql(
      `select l.asset_id from public.media_area_labels l
       where l.subject_id = '${v.places.bar}' and l.asset_id <> '${second.asset}' and l.removed_at is null`
    )
    const choose = (who: TestIdentity, asset: string) =>
      call(who, "set_slot_primary_photo", {
        p_slot_kind: "area",
        p_slot_id: v.places.bar,
        p_asset_id: asset,
      })
    const chosen = await choose(v.w.manager, first)
    expect(chosen.error).toBeNull()
    expect(chosen.data).toMatchObject({
      changed: true,
      previousAssetId: second.asset,
    })
    expect((await stateOf(v.w.staffA, v.places.bar))!.primaryAssetId).toBe(
      first
    )
    expect(
      ((await choose(v.w.manager, first)).data as { changed: boolean }).changed
    ).toBe(false)

    // Keeping the chosen one as reference hands the primary to the other.
    const firstLabel = psql(
      `select id from public.media_area_labels where asset_id = '${first}' and removed_at is null`
    )
    expect(
      (await decideArea(v.w.manager, firstLabel, "accepted", "reference")).error
    ).toBeNull()
    expect((await stateOf(v.w.staffA, v.places.bar))!.primaryAssetId).toBe(
      second.asset
    )
    expect(await errorOf(choose(v.w.manager, first))).toBe("photo_not_eligible")

    // Who may choose.
    expect(await errorOf(choose(v.w.staffA, second.asset))).toBe(
      "slot_not_found"
    )
    expect(await errorOf(choose(other.w.manager, second.asset))).toBe(
      "slot_not_found"
    )
    expect(await errorOf(choose(inactive, second.asset))).toBe(
      "not_active_user"
    )
    expect((await choose(v.w.admin, second.asset)).error).toBeNull()
    const anon = await anonClient().rpc(
      "set_slot_primary_photo" as never,
      {
        p_slot_kind: "area",
        p_slot_id: v.places.bar,
        p_asset_id: second.asset,
      } as never
    )
    expect(anon.error).not.toBeNull()
    // History is append-only.
    expect(
      Number(
        psql(
          `select count(*) from public.slot_primary_choices where slot_id = '${v.places.bar}'`
        )
      )
    ).toBe(2)
  })

  it("refuses area decisions to staff, another venue, the uploader and the inactive", async () => {
    const p = await areaPhoto(v.w.staffA, v.places.garden)
    expect(await errorOf(decideArea(v.w.staffB, p.label, "accepted"))).toBe(
      "area_photo_not_found"
    )
    expect(
      await errorOf(decideArea(other.w.manager, p.label, "accepted"))
    ).toBe("area_photo_not_found")
    expect(await errorOf(decideArea(inactive, p.label, "accepted"))).toBe(
      "not_active_user"
    )
    expect(
      await errorOf(decideArea(v.w.manager, p.label, "accepted", "best"))
    ).toBe("invalid_level")
  })
})

describe("amenities: the photo is reviewed apart from the fact (FA-32, AC24)", () => {
  it("does not fill a confirmed Yes until its photo is accepted for public use", async () => {
    const sent = await yes(v.w.staffA, v.w, "onsite_parking")
    if (sent.outcome === "awaiting_confirmation")
      expect(
        (
          await decide(
            v.w.manager,
            v.w,
            "onsite_parking",
            { type: "contribution", id: sent.contributionId },
            "confirm"
          )
        ).error
      ).toBeNull()
    const check = v.w.checks.onsite_parking!
    expect((await stateOf(v.w.staffB, check))!.state).toBe("pending")
    const asset = psql(
      `select ka.asset_id from public.knowledge_contribution_assets ka
       where ka.contribution_id = '${sent.contributionId}' limit 1`
    )
    const queue = await json<Array<{ asset_id: string; state: string }>>(
      v.w.manager,
      "amenity_photo_queue",
      {}
    )
    expect(queue.map((q) => q.asset_id)).toContain(asset)

    // Uploader, staff, another venue and the inactive cannot decide.
    expect(
      await errorOf(decideAmenity(v.w.staffA, check, asset, "accepted"))
    ).toBe("amenity_photo_not_found")
    expect(
      await errorOf(decideAmenity(other.w.manager, check, asset, "accepted"))
    ).toBe("amenity_photo_not_found")
    expect(
      await errorOf(decideAmenity(inactive, check, asset, "accepted"))
    ).toBe("not_active_user")

    const fact = () =>
      psql(
        `select progress || ',' || answer || ',' || revision from public.venue_amenity_checks where id = '${check}'`
      )
    const factBefore = fact()
    expect(
      (await decideAmenity(v.w.manager, check, asset, "accepted", "reference"))
        .error
    ).toBeNull()
    expect((await stateOf(v.w.staffB, check))!.state).toBe("missing")
    expect(
      (await decideAmenity(v.w.admin, check, asset, "accepted")).error
    ).toBeNull()
    const slot = (await stateOf(v.w.staffB, check))!
    expect(slot).toMatchObject({ state: "covered", primaryAssetId: asset })
    // The fact itself was not touched by the photo decisions.
    expect(fact()).toBe(factBefore)
  })

  it("resolves a confirmed No with no photo and leaves it out of the total (inv. 8)", async () => {
    const sent = await submit(v.w.staffA, v.w, "guest_toilets", {
      answer: "no",
    })
    if (sent.outcome === "awaiting_confirmation")
      expect(
        (
          await decide(
            v.w.manager,
            v.w,
            "guest_toilets",
            { type: "contribution", id: sent.contributionId },
            "confirm"
          )
        ).error
      ).toBeNull()
    const slot = (await stateOf(v.w.staffB, v.w.checks.guest_toilets!))!
    expect(slot).toMatchObject({ state: "not_here", counted: false })
  })

  it("asks no photo of a policy question (Wi-Fi)", async () => {
    const slot = (await stateOf(v.w.staffB, v.w.checks.guest_wifi!))!
    expect(slot).toMatchObject({ state: "inactive", counted: false })
  })
})

describe("the numbers reproduce from the rows (AC39)", () => {
  it("gives totals and categories that recount from the slots", async () => {
    const read = await coverage(v.w.manager)
    const counted = read.slots.filter((s) => s.counted)
    expect(read.totals.total).toBe(counted.length)
    expect(read.totals.covered).toBe(
      read.slots.filter((s) => s.state === "covered").length
    )
    for (const c of read.categories)
      expect(c.total).toBe(
        counted.filter((s) => s.category === c.category).length
      )
  })

  it("feeds admin albums and Our menu's summary the same counts", async () => {
    const cov = await coverage(v.w.admin, v.w.venue)
    const admin = await json<{
      totals: Counts
      sections: Array<{ accepted: number; total: number }>
    }>(v.w.admin, "album_admin_counts", { p_venue_id: v.w.venue })
    expect(admin.totals).toEqual(cov.totals)
    const dishCovered = cov.slots.filter(
      (s) => s.kind === "dish" && s.state === "covered"
    ).length
    expect(admin.sections.reduce((n, s) => n + s.accepted, 0)).toBe(dishCovered)
    const summary = await json<Array<{ covered_items: number }>>(
      v.w.manager,
      "menu_item_photo_summary",
      {}
    )
    expect(summary.reduce((n, s) => n + s.covered_items, 0)).toBe(dishCovered)
    expect(
      await errorOf(
        call(v.w.manager, "album_admin_counts", { p_venue_id: v.w.venue })
      )
    ).toBe("not_admin")
  })
})

describe("a temporarily unavailable dish stays in the total (inv. 7, AC26)", () => {
  const original = psql(
    `select pg_get_functiondef('private.coverage_temporarily_unavailable(text, uuid)'::regprocedure)`
  )
  afterAll(() => {
    psql(original)
  })

  it("keeps its state and its place in the denominator", async () => {
    const ale = v.items["drinks--ale"]!.itemId
    const before = await coverage(v.w.manager)
    // Stand in for the availability work's hook, for this one dish.
    psql(`create or replace function private.coverage_temporarily_unavailable(p_kind text, p_slot_id uuid)
      returns boolean language sql stable security definer set search_path = ''
      as $$ select p_slot_id = '${ale}'::uuid $$`)
    const after = await coverage(v.w.manager)
    const slot = after.slots.find((s) => s.slotId === ale)!
    expect(slot.unavailable).toBe(true)
    expect(slot.state).toBe(before.slots.find((s) => s.slotId === ale)!.state)
    expect(after.totals.total).toBe(before.totals.total)
    expect(after.totals.unavailable).toBe(1)
  })
})

describe("privileges", () => {
  it("grants no table access and keeps the rule private", () => {
    expect(
      psql(
        `select string_agg(has_table_privilege('authenticated', t, 'select')::text, ',')
         from unnest(array['public.amenity_photo_decisions', 'public.amenity_photo_requirements',
           'public.slot_primary_choices']) t`
      )
    ).toBe("false,false,false")
    expect(
      psql(
        `select string_agg(has_function_privilege(r, f, 'execute')::text, ',')
         from unnest(array['authenticated', 'anon']) r,
           unnest(array['private.coverage_slot_rows(uuid)', 'private.amenity_photo_rows(uuid)',
             'private.slot_effective_primary(text, uuid)']) f`
      )
    ).toBe("false,false,false,false,false,false")
    expect(
      psql(
        `select string_agg(has_function_privilege('anon', f, 'execute')::text, ',')
         from unnest(array['public.coverage_slots(uuid)', 'public.asset_usages(uuid, uuid)',
           'public.decide_amenity_photo(uuid, uuid, text, text, text)',
           'public.set_slot_primary_photo(text, uuid, uuid, text)']) f`
      )
    ).toBe("false,false,false,false")
  })

  it("refuses asset_usages to staff and another venue's manager", async () => {
    expect(await errorOf(call(v.w.staffA, "asset_usages", {}))).not.toBeNull()
    expect(
      await errorOf(
        call(other.w.manager, "asset_usages", { p_venue_id: v.w.venue })
      )
    ).not.toBeNull()
  })
})
