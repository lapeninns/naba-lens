// S1-MENUS local offering state (20261118103100_menu_local_offerings.sql),
// change requests (20261118103200_menu_change_requests.sql) and venue scope
// (20261118103300_venue_scope.sql): who may change availability, local names,
// presentation, specials, requests and scope; that a temporary sold-out keeps
// the photo requirement and history (AC26); that a presentation change sends
// accepted photos to recheck; that specials expire into review; that a pub
// without accommodation has it recorded as out of scope (AC29). Real
// signed-in identities through PostgREST; the service role and psql only
// build fixtures and read back.
import { randomUUID } from "node:crypto"
import { beforeAll, describe, expect, it } from "vitest"

import type { LabelCatalogue } from "../../lib/menus/types"
import {
  anonClient,
  createIdentity,
  createVenue,
  serviceClient,
  type TestIdentity,
} from "../support/identities"
import { fails, makeManager, ok, psql } from "./coverage-fixtures"
import { call, world as knowledgeWorld } from "./knowledge-fixtures"
import {
  createDraft,
  item,
  menu,
  publishMenu,
  readDocument,
  reserveReady,
  saveLabels,
  saveOk,
  section,
} from "./menus-fixtures"
import { removeAsAdmin } from "./privacy-fixtures"

const service = serviceClient()

type Rpc<T = unknown> = PromiseLike<{
  data: T | null
  error: { message: string; code: string; details?: string } | null
}>

const MENU = () =>
  menu("TEST local", [
    section("mains", "Mains", [
      item("mains--korma", "Korma"),
      item("mains--dal", "Dal"),
    ]),
    section("drinks", "Drinks", [item("drinks--lassi", "Lassi")], "drinks"),
  ])

type World = {
  venue: string
  version: string
  id: (key: string) => string
  mgr: TestIdentity
  staff: TestIdentity
  staff2: TestIdentity
}

let admin: TestIdentity
let w: World
let other: World
let leaver: TestIdentity

async function world(label: string): Promise<World> {
  const venue = (await createVenue(service, label)).id
  const version = await publishMenu(admin, venue, MENU())
  const { byKey } = await readDocument(service, version)
  const [mgr, staff, staff2] = await Promise.all(
    ["mgr", "s", "s2"].map((s) =>
      createIdentity(service, {
        label: `${label}-${s}`,
        role: "staff",
        venueId: venue,
      })
    )
  )
  await makeManager(admin, mgr!, venue)
  return {
    venue,
    version,
    id: (key) => byKey[key]!.itemId,
    mgr: mgr!,
    staff: staff!,
    staff2: staff2!,
  }
}

function londonDay(days = 0): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(Date.now() + days * 86_400_000))
}

async function head(itemId: string) {
  const { data } = await service
    .from("menu_item_photo_heads")
    .select("revision")
    .eq("item_id", itemId)
    .maybeSingle()
  return data?.revision ?? 1
}

async function photoCatalogue(who: TestIdentity, venue: string) {
  return (await ok(
    who.client.rpc("menu_label_catalogue", { p_venue_id: venue })
  )) as LabelCatalogue
}

async function catalogueItems(who: TestIdentity, venue: string) {
  const catalogue = await photoCatalogue(who, venue)
  return catalogue.status === "active"
    ? catalogue.sections.flatMap((section) => section.items)
    : []
}

async function acceptedPhoto(w: World, itemId: string) {
  const asset = await reserveReady(service, w.staff)
  await saveOk(w.staff, {
    asset: asset.id,
    revision: 0,
    types: ["dish"],
    items: [{ itemId, variantId: null }],
    catalogue: w.version,
  })
  const [row] = await ok(
    w.mgr.client.rpc("review_menu_item_photo", {
      p_asset_id: asset.id,
      p_item_id: itemId,
      p_variant_id: null as unknown as string,
      p_decision: "accepted",
      p_expected_revision: await head(itemId),
      p_make_primary: true,
    })
  )
  return row!.photo_id as string
}

async function photoState(id: string) {
  return ok(
    service
      .from("menu_item_photos")
      .select("state, recheck_kind, is_primary")
      .eq("id", id)
      .single()
  )
}

async function itemSummary(who: TestIdentity, itemId: string) {
  const rows = (await ok(
    who.client.rpc("manager_menu_photo_items", {
      p_limit: 101,
    } as never) as unknown as Rpc<{ item_id: string; accepted_count: number }[]>
  ))!
  return rows.find((r) => r.item_id === itemId)
}

const availability = (
  who: TestIdentity,
  itemId: string,
  available: boolean,
  until: string | null = null,
  reason: string | null = "TEST sold out"
) =>
  call(who, "menu_item_availability_set", {
    p_item_id: itemId,
    p_available: available,
    p_until: until,
    p_reason: reason,
  }) as Rpc<{ changed: boolean }>

type State = {
  itemId: string
  available: boolean
  unavailableReason: string | null
  displayName: string | null
  presentationRevision: number
}

async function states(who: TestIdentity, venue?: string) {
  return (await ok(
    call(
      who,
      "menu_offering_states",
      venue ? { p_venue_id: venue } : {}
    ) as Rpc<{
      items: State[]
    }>
  ))!.items
}

async function anonRefused(fn: string, args: object) {
  const { error } = await anonClient().rpc(fn as never, args as never)
  expect(error).not.toBeNull()
}

beforeAll(async () => {
  admin = await createIdentity(service, {
    label: "menus-local-admin",
    role: "admin",
  })
  ;[w, other] = await Promise.all([
    world("menus-local-a"),
    world("menus-local-b"),
  ])
  leaver = await createIdentity(service, {
    label: "menus-local-leaver",
    role: "staff",
    venueId: w.venue,
  })
  await makeManager(admin, leaver, w.venue)
  await ok(
    service.from("profiles").update({ active: false }).eq("id", leaver.id)
  )
})

describe("temporary availability (AC26)", () => {
  it("marks a dish sold out without touching its photo requirement or history", async () => {
    const korma = w.id("mains--korma")
    const photo = await acceptedPhoto(w, korma)
    const before = await itemSummary(w.mgr, korma)
    expect(before).toMatchObject({ accepted_count: 1 })

    expect(await ok(availability(w.mgr, korma, false))).toMatchObject({
      changed: true,
    })
    // Same state again writes nothing.
    expect(await ok(availability(w.mgr, korma, false))).toMatchObject({
      changed: false,
    })
    // Staff read it to draw "Not on today".
    expect(
      (await states(w.staff)).find((s) => s.itemId === korma)
    ).toMatchObject({ available: false, unavailableReason: "TEST sold out" })

    // The requirement and the accepted photo stay exactly as they were.
    expect(await itemSummary(w.mgr, korma)).toEqual(before)
    expect(await photoState(photo)).toMatchObject({
      state: "accepted",
      is_primary: true,
    })

    await ok(availability(w.mgr, korma, true))
    expect(
      (await states(w.staff)).find((s) => s.itemId === korma)
    ).toBeUndefined()
    const { data: events } = await service
      .from("menu_events")
      .select("action")
      .eq("item_id", korma)
      .order("id")
    expect(events!.map((e) => e.action)).toEqual([
      "availability_set",
      "availability_cleared",
    ])
  })

  it("needs a reason and a date from today", async () => {
    const dal = w.id("mains--dal")
    await fails(availability(w.mgr, dal, false, null, " "), "reason_required")
    await fails(availability(w.mgr, dal, false, londonDay(-2)), "invalid_until")
    await ok(availability(admin, dal, false, londonDay(3)))
    await ok(availability(admin, dal, true))
  })

  it("refuses staff, another venue's manager, an inactive manager and anon", async () => {
    const dal = w.id("mains--dal")
    await fails(availability(w.staff, dal, false), "not_venue_manager")
    await fails(availability(other.mgr, dal, false), "not_venue_manager")
    await fails(availability(leaver, dal, false), "not_active_user")
    await anonRefused("menu_item_availability_set", {
      p_item_id: dal,
      p_available: false,
      p_until: null,
      p_reason: "x",
    })
    await fails(
      call(other.staff, "menu_offering_states", { p_venue_id: w.venue }) as Rpc,
      "wrong_venue"
    )
  })
})

describe("local display names", () => {
  it("sets and clears an audited override; staff and other venues cannot", async () => {
    const lassi = w.id("drinks--lassi")
    const set = (
      who: TestIdentity,
      name: string | null,
      reason: string | null
    ) =>
      call(who, "menu_item_display_name_set", {
        p_item_id: lassi,
        p_name: name,
        p_reason: reason,
      }) as Rpc<{ changed: boolean }>
    await fails(set(w.mgr, "Mango lassi", null), "reason_required")
    await ok(set(w.mgr, "Mango lassi", "TEST local name"))
    expect(
      (await states(w.staff)).find((s) => s.itemId === lassi)
    ).toMatchObject({ displayName: "Mango lassi" })
    expect(await catalogueItems(w.staff, w.venue)).toContainEqual(
      expect.objectContaining({
        itemId: lassi,
        name: "Mango lassi",
        aliases: ["Lassi"],
      })
    )
    for (const query of ["Mango", "Lassi"]) {
      const dishes = await ok(
        w.staff.client.rpc("menu_item_photo_items", { p_query: query })
      )
      expect(dishes).toContainEqual(
        expect.objectContaining({ item_id: lassi, name: "Mango lassi" })
      )
    }
    const { byKey } = await readDocument(service, w.version)
    expect(byKey["drinks--lassi"]).toMatchObject({ name: "Lassi" })
    await fails(set(w.staff, "x", "TEST"), "not_venue_manager")
    await fails(set(other.mgr, "x", "TEST"), "not_venue_manager")
    await fails(set(leaver, "x", "TEST"), "not_active_user")
    await anonRefused("menu_item_display_name_set", {
      p_item_id: lassi,
      p_name: "x",
      p_reason: "x",
    })
    await ok(set(admin, null, null))
    expect(await catalogueItems(w.staff, w.venue)).toContainEqual(
      expect.objectContaining({ itemId: lassi, name: "Lassi", aliases: [] })
    )
    const { data: events } = await service
      .from("menu_events")
      .select("action, detail")
      .eq("item_id", lassi)
      .order("id")
    expect(events!.map((e) => e.action)).toEqual([
      "display_name_set",
      "display_name_cleared",
    ])
  })
})

it("counts an accepted photo on the next menu only while its asset is live", async () => {
  const v = await world("next-menu-photo-removal")
  const { sections } = await readDocument(service, v.version)
  const version = await createDraft(
    admin,
    v.venue,
    menu("TEST next menu", sections),
    v.version
  )
  const draft = await ok<{ revision: number }>(
    service.from("menu_versions").select("revision").eq("id", version).single()
  )
  await ok(
    admin.client.rpc("schedule_menu_version", {
      p_version_id: version,
      p_expected_revision: draft.revision,
      p_at: new Date(Date.now() + 60 * 60_000).toISOString(),
      p_retirements: 0,
    })
  )
  const approved = await acceptedPhoto(v, v.id("mains--korma"))
  const photo = await ok<{ asset_id: string }>(
    service
      .from("menu_item_photos")
      .select("asset_id")
      .eq("id", approved)
      .single()
  )
  const next = () =>
    ok(
      admin.client.rpc("admin_group_overview", {
        p_venue_ids: [v.venue],
        p_menu: "next",
      })
    )
  const food = (covered: number, missing: number) => ({
    rows: [
      {
        categories: expect.arrayContaining([
          expect.objectContaining({
            category: "food",
            total: 2,
            covered,
            missing,
          }),
        ]),
      },
    ],
  })
  expect(await next()).toMatchObject(food(1, 1))
  await removeAsAdmin(photo.asset_id)
  expect(await next()).toMatchObject(food(0, 2))
})

describe("presentation changed", () => {
  it("bumps the presentation revision and sends accepted photos to recheck", async () => {
    const v = await world("menus-local-pres")
    const korma = v.id("mains--korma")
    const photo = await acceptedPhoto(v, korma)
    const headBefore = await head(korma)
    const res = (await ok(
      call(v.mgr, "menu_item_presentation_changed", {
        p_item_id: korma,
        p_note: "TEST new plating",
      }) as Rpc<{ presentationRevision: number; photosToRecheck: number }>
    ))!
    expect(res).toMatchObject({ presentationRevision: 2, photosToRecheck: 1 })
    expect(await photoState(photo)).toMatchObject({
      state: "needs_recheck",
      recheck_kind: "presentation_changed",
      is_primary: false,
    })
    expect(await head(korma)).toBe(headBefore + 1)
    expect(
      (await states(v.staff)).find((s) => s.itemId === korma)
    ).toMatchObject({ presentationRevision: 2 })

    for (const [who, message] of [
      [v.staff, "not_venue_manager"],
      [w.mgr, "not_venue_manager"],
      [leaver, "not_active_user"],
    ] as const)
      await fails(
        call(who, "menu_item_presentation_changed", {
          p_item_id: korma,
          p_note: "x",
        }) as Rpc,
        message
      )
    await anonRefused("menu_item_presentation_changed", {
      p_item_id: korma,
      p_note: "x",
    })
  })
})

describe("local specials", () => {
  type Special = {
    specialId: string
    itemId: string
    state: string
    revision: number
  }
  const create = (
    who: TestIdentity,
    venue: string,
    starts = londonDay(0),
    ends = londonDay(7)
  ) =>
    call(who, "menu_special_create", {
      p_venue_id: venue,
      p_name: "TEST Game pie",
      p_description: null,
      p_kind: "food",
      p_starts_on: starts,
      p_ends_on: ends,
    }) as Rpc<{ specialId: string; itemId: string; status: string }>
  const list = async (who: TestIdentity, archived = false) =>
    (await ok(
      call(who, "menu_specials_list", {
        p_venue_id: w.venue,
        p_include_archived: archived,
      }) as Rpc<{ items: Special[] }>
    ))!.items

  it("lets staff suggest and the manager accept; expiry asks for review; ending keeps the item's history", async () => {
    const suggested = (await ok(create(w.staff, w.venue)))!
    expect(suggested.status).toBe("suggested")
    // Another staff member does not see someone else's suggestion.
    expect((await list(w.staff2)).map((s) => s.specialId)).not.toContain(
      suggested.specialId
    )
    await fails(
      call(w.staff, "menu_special_decide", {
        p_special_id: suggested.specialId,
        p_accept: true,
        p_reason: null,
        p_revision: 1,
      }) as Rpc,
      "not_venue_manager"
    )
    await ok(
      call(w.mgr, "menu_special_decide", {
        p_special_id: suggested.specialId,
        p_accept: true,
        p_reason: null,
        p_revision: 1,
      }) as Rpc
    )
    expect(
      (await list(w.staff2)).find((s) => s.specialId === suggested.specialId)
    ).toMatchObject({ state: "running" })

    // Its end date passes: it reads as review_due until the manager acts.
    psql(
      `update public.menu_specials set starts_on = current_date - 10, ends_on = current_date - 2 where id = '${suggested.specialId}'`
    )
    const due = (await list(w.mgr)).find(
      (s) => s.specialId === suggested.specialId
    )!
    expect(due.state).toBe("review_due")
    await fails(
      call(w.mgr, "menu_special_review", {
        p_special_id: suggested.specialId,
        p_action: "end",
        p_ends_on: null,
        p_reason: null,
        p_revision: 1,
      }) as Rpc,
      "menu_special_conflict"
    )
    await ok(
      call(w.mgr, "menu_special_review", {
        p_special_id: suggested.specialId,
        p_action: "end",
        p_ends_on: null,
        p_reason: "TEST finished",
        p_revision: due.revision,
      }) as Rpc
    )
    const { data: itemRow } = await service
      .from("menu_items")
      .select("archived_at")
      .eq("id", suggested.itemId)
      .single()
    expect(itemRow!.archived_at).not.toBeNull()
    expect((await list(w.mgr)).map((s) => s.specialId)).not.toContain(
      suggested.specialId
    )
    expect(
      (await list(w.mgr, true)).find((s) => s.specialId === suggested.specialId)
    ).toMatchObject({ state: "ended" })
  })

  it("lets the manager place a staff photo on an accepted suggestion, while expired and future specials are excluded", async () => {
    const { venue, version, staff, mgr } = await world("menus-special-photo")
    const suggested = (await ok(create(staff, venue)))!
    const future = (await ok(create(mgr, venue, londonDay(2), londonDay(7))))!
    const asset = await reserveReady(service, staff)
    await ok(staff.client.rpc("request_label_help", { p_asset_id: asset.id }))
    const assign = (itemId: string) =>
      call(mgr, "assign_menu_item_photo", {
        p_asset_id: asset.id,
        p_item_id: itemId,
        p_variant_id: null,
        p_corrects_item_id: null,
        p_corrects_variant_id: null,
        p_reason: null,
        p_expected_revision: 1,
      }) as Rpc<{ state: string }[]>

    const before = (await catalogueItems(staff, venue)).map((i) => i.itemId)
    expect(before).not.toContain(suggested.itemId)
    expect(before).not.toContain(future.itemId)
    await fails(assign(suggested.itemId), "menu_item_unavailable")
    await fails(assign(future.itemId), "menu_item_unavailable")
    const needsLabel = await ok(
      mgr.client.rpc("manager_menu_photo_queue", { p_status: "unlabelled" })
    )
    expect(needsLabel).toContainEqual(
      expect.objectContaining({ asset_id: asset.id })
    )

    await ok(
      call(mgr, "menu_special_decide", {
        p_special_id: suggested.specialId,
        p_accept: true,
        p_reason: null,
        p_revision: 1,
      }) as Rpc
    )
    expect(await catalogueItems(staff, venue)).toContainEqual(
      expect.objectContaining({
        itemId: suggested.itemId,
        name: "TEST Game pie",
        variants: [],
      })
    )
    expect((await ok(assign(suggested.itemId)))![0]).toMatchObject({
      state: "accepted",
    })
    const detail = await ok(
      mgr.client.rpc("review_photo_detail", { p_asset_id: asset.id })
    )
    expect(detail).toMatchObject({
      dishes: [
        {
          itemId: suggested.itemId,
          itemName: "TEST Game pie",
          sectionName: "Food specials",
          onMenu: true,
          state: "accepted",
        },
      ],
    })
    const coverage = () => ok(staff.client.rpc("coverage_slots"))
    expect(await coverage()).toMatchObject({
      slots: expect.arrayContaining([
        expect.objectContaining({ slotId: suggested.itemId, state: "covered" }),
      ]),
    })
    const { byKey } = await readDocument(service, version)
    expect(
      Object.values(byKey)
        .map((i) => i.itemId)
        .sort()
    ).toEqual(before.sort())
    expect(
      await ok(
        other.staff.client.rpc("menu_label_catalogue", { p_venue_id: venue })
      )
    ).toBeNull()

    psql(
      `update public.menu_specials set starts_on = current_date - 10, ends_on = current_date - 2 where id = '${suggested.specialId}'`
    )
    expect(
      (await catalogueItems(staff, venue)).map((i) => i.itemId)
    ).not.toContain(suggested.itemId)
    expect(await coverage()).not.toMatchObject({
      slots: expect.arrayContaining([
        expect.objectContaining({ slotId: suggested.itemId }),
      ]),
    })
  })

  it("accepts and covers a staff-matched special before the venue publishes its first menu", async () => {
    const venue = (await createVenue(service, "menus-special-only")).id
    const [mgr, staff] = await Promise.all(
      ["mgr", "staff"].map((role) =>
        createIdentity(service, {
          label: `special-only-${role}`,
          role: "staff",
          venueId: venue,
        })
      )
    )
    await makeManager(admin, mgr!, venue)
    const running = (await ok(create(mgr!, venue)))!
    expect(await photoCatalogue(staff!, venue)).toMatchObject({
      status: "active",
      versionId: null,
      sections: [{ name: "Food specials", kind: "food" }],
    })
    const asset = await reserveReady(service, staff!)
    const labels = {
      asset: asset.id,
      revision: 0,
      types: ["dish"],
      items: [{ itemId: running.itemId, variantId: null }],
    }
    await fails(
      saveLabels(staff!, {
        ...labels,
        items: [{ itemId: running.itemId, variantId: randomUUID() }],
      }),
      "menu_item_unavailable"
    )
    await saveOk(staff!, labels)
    expect(
      await ok(
        staff!.client.rpc("media_label_details", { p_asset_ids: [asset.id] })
      )
    ).toContainEqual(
      expect.objectContaining({
        item_id: running.itemId,
        name: "TEST Game pie",
        state: "current",
      })
    )
    const queue = () =>
      ok(
        mgr!.client.rpc("manager_menu_photo_queue", {
          p_status: "pending",
          p_item_id: running.itemId,
        })
      )
    expect(await queue()).toContainEqual(
      expect.objectContaining({
        asset_id: asset.id,
        item_name: "TEST Game pie",
      })
    )
    expect(
      await ok(
        call(staff!, "my_contributions_feed", {
          p_cursor: null,
          p_limit: 20,
        }) as Rpc
      )
    ).toMatchObject({
      items: expect.arrayContaining([
        expect.objectContaining({
          assetId: asset.id,
          menuDecisions: [
            expect.objectContaining({
              itemId: running.itemId,
              itemName: "TEST Game pie",
              state: "waiting",
            }),
          ],
        }),
      ]),
    })
    const [accepted] = await ok(
      mgr!.client.rpc("review_menu_item_photo", {
        p_asset_id: asset.id,
        p_item_id: running.itemId,
        p_variant_id: null as unknown as string,
        p_decision: "accepted",
        p_expected_revision: await head(running.itemId),
        p_make_primary: true,
      })
    )
    expect(accepted).toMatchObject({
      item_id: running.itemId,
      state: "accepted",
    })
    expect(await queue()).toEqual([])
    expect(
      await ok(staff!.client.rpc("menu_item_photo_summary"))
    ).toContainEqual(
      expect.objectContaining({
        menu_state: "ready",
        section_name: "Food specials",
        covered_items: 1,
      })
    )
    expect(
      await ok(
        service
          .from("menu_item_photos")
          .select("menu_version_id")
          .eq("id", accepted!.photo_id)
          .single()
      )
    ).toEqual({ menu_version_id: null })
  })

  it("lets the manager create a running special, extend it, and decline a suggestion with a reason", async () => {
    const mine = (await ok(create(w.mgr, w.venue)))!
    expect(mine.status).toBe("running")
    await ok(
      call(w.mgr, "menu_special_review", {
        p_special_id: mine.specialId,
        p_action: "extend",
        p_ends_on: londonDay(14),
        p_reason: null,
        p_revision: 1,
      }) as Rpc
    )
    const s = (await ok(create(w.staff, w.venue)))!
    await fails(
      call(w.mgr, "menu_special_decide", {
        p_special_id: s.specialId,
        p_accept: false,
        p_reason: null,
        p_revision: 1,
      }) as Rpc,
      "reason_required"
    )
    await ok(
      call(w.mgr, "menu_special_decide", {
        p_special_id: s.specialId,
        p_accept: false,
        p_reason: "TEST not this week",
        p_revision: 1,
      }) as Rpc
    )
    expect(
      (await list(w.staff, true)).find((x) => x.specialId === s.specialId)
    ).toMatchObject({ state: "declined" })
  })

  it("refuses dates in the past, other venues, inactive accounts and anon", async () => {
    await fails(
      create(w.mgr, w.venue, londonDay(-5), londonDay(-1)),
      "invalid_dates"
    )
    await fails(create(other.staff, w.venue), "not_venue_member")
    await fails(create(other.mgr, w.venue), "not_venue_member")
    await fails(create(leaver, w.venue), "not_active_user")
    await anonRefused("menu_special_create", {
      p_venue_id: w.venue,
      p_name: "x",
      p_description: null,
      p_kind: "food",
      p_starts_on: londonDay(0),
      p_ends_on: londonDay(1),
    })
    const mine = (await ok(create(w.mgr, w.venue)))!
    await fails(
      call(other.mgr, "menu_special_review", {
        p_special_id: mine.specialId,
        p_action: "end",
        p_ends_on: null,
        p_reason: null,
        p_revision: 1,
      }) as Rpc,
      "not_venue_manager"
    )
    await fails(
      call(other.staff, "menu_specials_list", { p_venue_id: w.venue }) as Rpc,
      "wrong_venue"
    )
  })
})

describe("change requests and retirement impact", () => {
  it("lets the manager request, the admin decide with a reason, and both read", async () => {
    const dal = w.id("mains--dal")
    const created = (await ok(
      call(w.mgr, "menu_change_request_create", {
        p_venue_id: w.venue,
        p_item_id: dal,
        p_kind: "remove",
        p_detail: "TEST we no longer make it",
      }) as Rpc<{ requestId: string }>
    ))!
    await fails(
      call(w.mgr, "menu_change_request_create", {
        p_venue_id: w.venue,
        p_item_id: null,
        p_kind: "rename",
        p_detail: "TEST",
      }) as Rpc,
      "item_required"
    )
    const mine = (await ok(
      call(w.mgr, "menu_change_requests_list", { p_venue_id: w.venue }) as Rpc<{
        items: { requestId: string; status: string; itemName: string }[]
      }>
    ))!
    expect(mine.items[0]).toMatchObject({
      requestId: created.requestId,
      status: "open",
      itemName: "Dal",
    })

    // Manager cannot decide; admin needs a reason to decline.
    await fails(
      call(w.mgr, "menu_change_request_decide", {
        p_request_id: created.requestId,
        p_decision: "accepted",
        p_reason: null,
        p_revision: 1,
      }) as Rpc,
      "not_active_admin"
    )
    await fails(
      call(admin, "menu_change_request_decide", {
        p_request_id: created.requestId,
        p_decision: "declined",
        p_reason: null,
        p_revision: 1,
      }) as Rpc,
      "reason_required"
    )
    await ok(
      call(admin, "menu_change_request_decide", {
        p_request_id: created.requestId,
        p_decision: "accepted",
        p_reason: null,
        p_revision: 1,
      }) as Rpc
    )
    const all = (await ok(
      call(admin, "menu_change_requests_list", {}) as Rpc<{
        items: { requestId: string; status: string }[]
      }>
    ))!
    expect(
      all.items.find((r) => r.requestId === created.requestId)
    ).toMatchObject({ status: "accepted" })

    const impact = (await ok(
      call(w.mgr, "menu_item_retirement_impact", { p_item_id: dal }) as Rpc<
        Record<string, unknown>
      >
    ))!
    expect(impact).toMatchObject({ onActiveMenu: true, openRequests: 0 })
  })

  it("refuses staff, other venues, inactive accounts and anon", async () => {
    const korma = w.id("mains--korma")
    const args = {
      p_venue_id: w.venue,
      p_item_id: korma,
      p_kind: "rename",
      p_detail: "TEST",
    }
    await fails(
      call(w.staff, "menu_change_request_create", args) as Rpc,
      "not_venue_manager"
    )
    await fails(
      call(other.mgr, "menu_change_request_create", args) as Rpc,
      "not_venue_manager"
    )
    await fails(
      call(leaver, "menu_change_request_create", args) as Rpc,
      "not_active_user"
    )
    await anonRefused("menu_change_request_create", args)
    await fails(
      call(w.mgr, "menu_change_requests_list", {}) as Rpc,
      "venue_required"
    )
    await fails(
      call(other.mgr, "menu_change_requests_list", {
        p_venue_id: w.venue,
      }) as Rpc,
      "not_venue_manager"
    )
    await fails(
      call(w.staff, "menu_item_retirement_impact", { p_item_id: korma }) as Rpc,
      "not_venue_manager"
    )
    await fails(
      call(other.mgr, "menu_item_retirement_impact", {
        p_item_id: korma,
      }) as Rpc,
      "not_venue_manager"
    )

    // Only the requester withdraws.
    const r = (await ok(
      call(w.mgr, "menu_change_request_create", args) as Rpc<{
        requestId: string
      }>
    ))!
    await fails(
      call(admin, "menu_change_request_withdraw", {
        p_request_id: r.requestId,
        p_revision: 1,
      }) as Rpc,
      "menu_change_request_not_found"
    )
    await ok(
      call(w.mgr, "menu_change_request_withdraw", {
        p_request_id: r.requestId,
        p_revision: 1,
      }) as Rpc
    )
  })
})

describe("venue scope (AC29) and amenity applicability", () => {
  type ScopeRead = {
    items: {
      key: string
      applicable: boolean
      decided: boolean
      revision: number
      reason: string | null
      history: unknown[] | null
    }[]
  }
  const read = async (who: TestIdentity, venue?: string) =>
    (await ok(
      call(
        who,
        "venue_scope_read",
        venue ? { p_venue_id: venue } : {}
      ) as Rpc<ScopeRead>
    ))!.items[0]!
  const set = (
    who: TestIdentity,
    venue: string,
    applicable: boolean,
    reason: string | null,
    revision: number
  ) =>
    call(who, "venue_scope_set", {
      p_venue_id: venue,
      p_key: "accommodation",
      p_applicable: applicable,
      p_reason: reason,
      p_revision: revision,
    }) as Rpc<{ changed: boolean; revision: number }>

  it("reads accommodation as out of scope until an admin records otherwise, with a reason and history", async () => {
    expect(await read(w.staff)).toMatchObject({
      key: "accommodation",
      applicable: false,
      decided: false,
      reason: null,
      history: null,
    })
    await fails(set(admin, w.venue, false, null, 0), "reason_required")
    await ok(set(admin, w.venue, false, "TEST no rooms", 0))
    await fails(set(admin, w.venue, true, "TEST", 0), "venue_scope_conflict")
    await ok(set(admin, w.venue, true, "TEST rooms opened", 1))
    const after = await read(w.mgr)
    expect(after).toMatchObject({
      applicable: true,
      decided: true,
      revision: 2,
      reason: "TEST rooms opened",
    })
    expect(after.history).toHaveLength(2)
    expect(
      psql(`select private.venue_scope_applies('${w.venue}', 'accommodation')`)
    ).toBe("t")
    expect(
      psql(
        `select private.venue_scope_applies('${other.venue}', 'accommodation')`
      )
    ).toBe("f")
  })

  it("is admin-only to change, venue-only to read", async () => {
    for (const who of [w.mgr, w.staff])
      await fails(set(who, w.venue, false, "x", 2), "not_active_admin")
    await fails(
      call(other.mgr, "venue_scope_read", { p_venue_id: w.venue }) as Rpc,
      "wrong_venue"
    )
    await fails(call(leaver, "venue_scope_read", {}) as Rpc, "not_active_user")
    await anonRefused("venue_scope_read", { p_venue_id: w.venue })
    await anonRefused("venue_scope_set", {
      p_venue_id: w.venue,
      p_key: "accommodation",
      p_applicable: true,
      p_reason: "x",
      p_revision: 0,
    })
  })

  it("archives and restores an amenity check only with a reason, recorded", async () => {
    const k = await knowledgeWorld("menus-scope-amen", {
      extra: ["pool_table"],
    })
    const check = k.checks["pool_table"]!
    const rev = async () =>
      (await ok(
        service
          .from("venue_amenity_checks")
          .select("revision, status")
          .eq("id", check)
          .single()
      )) as { revision: number; status: string }
    const apply = (
      who: TestIdentity,
      applicable: boolean,
      reason: string | null,
      revision: number
    ) =>
      call(who, "amenity_check_set_applicability", {
        p_check_id: check,
        p_applicable: applicable,
        p_reason: reason,
        p_revision: revision,
        p_idempotency_key: crypto.randomUUID(),
      }) as Rpc

    await fails(
      apply(k.manager, false, null, (await rev()).revision),
      "reason_required"
    )
    await fails(
      apply(k.staffA, false, "x", (await rev()).revision),
      "not_venue_manager"
    )
    await fails(
      apply(w.mgr, false, "x", (await rev()).revision),
      "not_venue_manager"
    )
    await ok(
      apply(k.manager, false, "TEST no table here", (await rev()).revision)
    )
    expect((await rev()).status).toBe("archived")
    await ok(
      apply(k.admin, true, "TEST table installed", (await rev()).revision)
    )
    expect((await rev()).status).toBe("active")
    const { data } = await service
      .from("amenity_scope_events" as never)
      .select("applicable, reason")
      .eq("check_id", check)
      .order("id")
    expect(data).toEqual([
      { applicable: false, reason: "TEST no table here" },
      { applicable: true, reason: "TEST table installed" },
    ])

    // A core check is admin-only through this path.
    const core = k.checks["step_free_entrance"]!
    await fails(
      call(k.manager, "amenity_check_set_applicability", {
        p_check_id: core,
        p_applicable: false,
        p_reason: "x",
        p_revision: 1,
        p_idempotency_key: crypto.randomUUID(),
      }) as Rpc,
      "core_check_admin_only"
    )
    await anonRefused("amenity_check_set_applicability", {
      p_check_id: check,
      p_applicable: false,
      p_reason: "x",
      p_revision: 1,
      p_idempotency_key: crypto.randomUUID(),
    })
  })
})
