// Retake notes, G-3 (docs/plans/goals-not-tasks.md, decisions 4 and 14):
// my_retake_notes() decides open / cleared / retaken / set aside and whether
// a note can be retaken, for menu "needs another photo" notes and coverage
// "needs another photo" requests; set_retake_note_aside() records Later.
// Real signed-in identities through PostgREST; the service role only builds
// fixtures and reads state back.
import { beforeAll, describe, expect, it } from "vitest"

import {
  createIdentity,
  createVenue,
  serviceClient,
  signIn,
  type Db,
  type TestIdentity,
} from "../support/identities"
import {
  assign,
  createRequirement,
  currentMonth,
  fails,
  itemRevision,
  legacyStaffGrant,
  ok,
  psql,
  review as reviewCoverage,
  staffProgress,
  submit,
} from "./coverage-fixtures"
import {
  item,
  menu,
  publishMenu,
  readDocument,
  reserveReady,
  saveLabels,
  saveOk,
  section,
  type CatalogueRow,
} from "./menus-fixtures"

const service = serviceClient()
let admin: TestIdentity

// The new RPCs are not in lib/db/types.ts yet (the coordinator regenerates it
// once), so they are called through this narrow untyped view.
type RpcResult = {
  data: unknown
  error: { code: string; message: string; details?: string } | null
}
type Untyped = { rpc: (fn: string, args?: object) => PromiseLike<RpcResult> }
const rpc = (client: Db, fn: string, args: object = {}) =>
  (client as unknown as Untyped).rpc(fn, args)

type Note = {
  kind: "menu" | "coverage"
  note_id: string
  note_revision: number
  asset_id: string
  item_id: string | null
  variant_id: string | null
  item_name: string | null
  variant_name: string | null
  requirement_id: string | null
  requirement_title: string | null
  requirement_kind: string | null
  reason: string | null
  asked_by_name: string | null
  asked_at: string
  status: "open" | "cleared" | "retaken" | "set_aside"
  can_retake: boolean
  set_aside_at: string | null
}

async function notes(who: TestIdentity | Db): Promise<Note[]> {
  const client = "client" in who ? who.client : who
  return (await ok(rpc(client, "my_retake_notes"))) as Note[]
}

async function note(who: TestIdentity | Db, id: string) {
  return (await notes(who)).find((n) => n.note_id === id) ?? null
}

const aside = (
  who: TestIdentity,
  target: { photo?: string; submissionItem?: string }
) =>
  rpc(who.client, "set_retake_note_aside", {
    ...(target.photo ? { p_photo_id: target.photo } : {}),
    ...(target.submissionItem
      ? { p_submission_item_id: target.submissionItem }
      : {}),
  })

async function asideOk(
  who: TestIdentity,
  target: { photo?: string; submissionItem?: string }
) {
  const rows = (await ok(aside(who, target))) as {
    set_aside_at: string
    replayed: boolean
  }[]
  return rows[0]!
}

async function asideRows(filter: { photo?: string; staff?: string } = {}) {
  let query = service
    .from("retake_note_set_asides" as never)
    .select("*")
    .order("set_aside_at")
  if (filter.photo) query = query.eq("photo_id", filter.photo)
  if (filter.staff) query = query.eq("staff_id", filter.staff)
  const { data, error } = await query
  if (error) throw error
  return data as unknown as {
    staff_id: string
    photo_id: string | null
    photo_revision: number | null
    submission_item_id: string | null
  }[]
}

async function totalRows() {
  return Number(psql("select count(*) from public.retake_note_set_asides"))
}

type Fixture = {
  venue: string
  version: string
  manager: TestIdentity
  staff: TestIdentity
  staff2: TestIdentity
  items: Record<string, CatalogueRow>
}

const MENU = () =>
  menu("TEST Retake notes", [
    section("mains", "Mains", [
      item("mains--korma", "Korma", { variants: ["Chicken", "Lamb"] }),
      item("mains--tikka", "Tikka"),
      item("mains--dal", "Dal"),
      item("mains--bhaji", "Bhaji"),
      item("mains--naan", "Naan"),
      item("mains--rice", "Rice"),
    ]),
  ])

async function venueWithMenu(label: string): Promise<Fixture> {
  const venue = (await createVenue(service, label)).id
  const [manager, staff, staff2] = await Promise.all(
    ["mgr", "s1", "s2"].map((who) =>
      createIdentity(service, {
        label: `${label}-${who}`,
        role: "staff",
        venueId: venue,
      })
    )
  )
  await legacyStaffGrant(service, admin, manager!.id, venue)
  const version = await publishMenu(admin, venue, MENU())
  const items = (await readDocument(service, version)).byKey
  return {
    venue,
    version,
    manager: manager!,
    staff: staff!,
    staff2: staff2!,
    items,
  }
}

type Tuple = { itemId: string; variantId: string | null }
const t = (row: CatalogueRow, variant?: number): Tuple => ({
  itemId: row.itemId,
  variantId: variant === undefined ? null : row.variants[variant]!.variantId,
})

async function labelled(who: TestIdentity, version: string, tuples: Tuple[]) {
  const asset = await reserveReady(service, who, "image")
  const saved = await saveOk(who, {
    asset: asset.id,
    revision: 0,
    items: tuples,
    catalogue: version,
  })
  return { id: asset.id, revision: saved!.revision }
}

async function head(itemId: string) {
  const { data, error } = await service
    .from("menu_item_photo_heads")
    .select("revision")
    .eq("item_id", itemId)
    .maybeSingle()
  if (error) throw error
  return data?.revision ?? 1
}

async function decide(
  who: TestIdentity,
  asset: string,
  tuple: Tuple,
  decision: "accepted" | "better_photo_requested",
  reason?: string
) {
  const [row] = await ok(
    who.client.rpc("review_menu_item_photo", {
      p_asset_id: asset,
      p_item_id: tuple.itemId,
      p_variant_id: tuple.variantId as string,
      p_decision: decision,
      p_expected_revision: await head(tuple.itemId),
      ...(reason ? { p_reason: reason } : {}),
      p_make_primary: false,
    })
  )
  return row!
}

/** A menu "needs another photo" note on a new photo by `author`. */
async function menuNote(f: Fixture, author: TestIdentity, tuple: Tuple) {
  const asset = await labelled(author, f.version, [tuple])
  const row = await decide(
    f.manager,
    asset.id,
    tuple,
    "better_photo_requested",
    "Too dark, try the window light"
  )
  return { photoId: row.photo_id, asset }
}

async function photoRow(id: string) {
  const { data, error } = await service
    .from("menu_item_photos")
    .select("state, revision")
    .eq("id", id)
    .single()
  if (error) throw error
  return data
}

beforeAll(async () => {
  admin = await createIdentity(service, { label: "rn-admin", role: "admin" })
})

describe("menu notes: read and Later", () => {
  let f: Fixture
  let korma: Tuple
  let photoId: string

  beforeAll(async () => {
    f = await venueWithMenu("rn-menu")
    korma = t(f.items["mains--korma"]!, 0)
    photoId = (await menuNote(f, f.staff, korma)).photoId
  })

  it("lists the note as open, retakeable, with the reason and who asked", async () => {
    expect(await note(f.staff, photoId)).toMatchObject({
      kind: "menu",
      note_revision: 1,
      item_id: korma.itemId,
      variant_id: korma.variantId,
      item_name: "Korma",
      variant_name: "Chicken",
      reason: "Too dark, try the window light",
      asked_by_name: "TEST rn-menu-mgr",
      status: "open",
      can_retake: true,
      set_aside_at: null,
    })
    // Nobody else sees it.
    expect(await note(f.staff2, photoId)).toBeNull()
  })

  it("staff B cannot set aside A's note: the same error as a missing note, and no row", async () => {
    const before = await totalRows()
    const theirs = await fails(
      aside(f.staff2, { photo: photoId }),
      "retake_note_not_found",
      "P0002"
    )
    const missing = await fails(
      aside(f.staff2, { photo: crypto.randomUUID() }),
      "retake_note_not_found",
      "P0002"
    )
    expect(theirs).toEqual(missing)
    await fails(
      aside(f.staff2, { submissionItem: crypto.randomUUID() }),
      "retake_note_not_found",
      "P0002"
    )
    expect(await totalRows()).toBe(before)
  })

  it("refuses admins, manager accounts and inactive users", async () => {
    const manager = await createIdentity(service, {
      label: "rn-menu-mgr-account",
      role: "manager",
      venueId: f.venue,
    })
    const inactive = await createIdentity(service, {
      label: "rn-menu-inactive",
      role: "staff",
      venueId: f.venue,
    })
    const own = await menuNote(f, inactive, t(f.items["mains--naan"]!))
    await service
      .from("profiles")
      .update({ active: false })
      .eq("id", inactive.id)
    const before = await totalRows()
    for (const who of [admin, manager]) {
      await fails(
        aside(who, { photo: photoId }),
        "work_profile_forbidden",
        "42501"
      )
      await fails(
        rpc(who.client, "my_retake_notes"),
        "work_profile_forbidden",
        "42501"
      )
    }
    await fails(
      aside(inactive, { photo: own.photoId }),
      "work_profile_forbidden",
      "42501"
    )
    await fails(
      rpc(inactive.client, "my_retake_notes"),
      "work_profile_forbidden",
      "42501"
    )
    await fails(rpc(service, "my_retake_notes"), "work_profile_forbidden")
    expect(await totalRows()).toBe(before)
  })

  it("asks for exactly one note", async () => {
    await fails(aside(f.staff, {}), "invalid_retake_note", "22023")
    await fails(
      aside(f.staff, {
        photo: photoId,
        submissionItem: crypto.randomUUID(),
      }),
      "invalid_retake_note",
      "22023"
    )
  })

  it("Later changes no count and no manager queue", async () => {
    const month = currentMonth()
    const read = async () => ({
      progress: await staffProgress(f.manager, f.venue, month),
      summary: await ok(
        f.manager.client.rpc("menu_item_photo_summary", { p_venue_id: f.venue })
      ),
      items: await ok(
        f.staff.client.rpc("menu_item_photo_items", {
          p_venue_id: f.venue,
          p_limit: 101,
        })
      ),
      candidates: await ok(
        f.manager.client.rpc("menu_item_photo_candidates", {
          p_venue_id: f.venue,
        })
      ),
      queue: await ok(
        f.manager.client.rpc("coverage_items_page", {
          p_venue_id: f.venue,
          p_states: ["submitted", "needs_another_photo"],
        })
      ),
      photo: await photoRow(photoId),
    })
    const before = await read()
    const first = await asideOk(f.staff, { photo: photoId })
    expect(first.replayed).toBe(false)
    expect(await read()).toEqual(before)
  })

  it("hides from a second session after a reload, stays listed, and a repeat call does nothing new", async () => {
    const second = await signIn(service, f.staff.email)
    const seen = await note(second, photoId)
    expect(seen).toMatchObject({ status: "set_aside", can_retake: true })
    expect(seen!.set_aside_at).not.toBeNull()
    const rows = await asideRows({ photo: photoId })
    expect(rows).toEqual([
      expect.objectContaining({
        staff_id: f.staff.id,
        photo_id: photoId,
        photo_revision: 1,
        submission_item_id: null,
      }),
    ])
    const again = await asideOk(f.staff, { photo: photoId })
    expect(again.replayed).toBe(true)
    expect(Date.parse(again.set_aside_at)).toBe(Date.parse(seen!.set_aside_at!))
    expect(await asideRows({ photo: photoId })).toHaveLength(1)
  })

  it("a new revision of the same note shows again and can be set aside again", async () => {
    const { error } = await service
      .from("menu_item_photos")
      .update({
        revision: 2,
        reason: "Closer, please",
        decided_at: new Date().toISOString(),
      })
      .eq("id", photoId)
    if (error) throw error
    expect(await note(f.staff, photoId)).toMatchObject({
      status: "open",
      note_revision: 2,
      reason: "Closer, please",
      set_aside_at: null,
    })
    expect((await asideOk(f.staff, { photo: photoId })).replayed).toBe(false)
    expect(
      (await asideRows({ photo: photoId })).map((r) => r.photo_revision)
    ).toEqual([1, 2])
  })

  it("authenticated has no insert, update or delete grant, and nobody reads another person's set-asides", async () => {
    for (const privilege of ["INSERT", "UPDATE", "DELETE", "TRUNCATE"]) {
      expect(
        psql(
          `select has_table_privilege('authenticated', 'public.retake_note_set_asides', '${privilege}')`
        )
      ).toBe("f")
      expect(
        psql(
          `select has_table_privilege('anon', 'public.retake_note_set_asides', '${privilege}')`
        )
      ).toBe("f")
    }
    const insert = await f.staff.client
      .from("retake_note_set_asides" as never)
      .insert({
        staff_id: f.staff.id,
        photo_id: photoId,
        photo_revision: 9,
      } as never)
    expect(insert.error?.code).toBe("42501")

    const read = async (who: TestIdentity) => {
      const { data, error } = await who.client
        .from("retake_note_set_asides" as never)
        .select("staff_id")
      if (error) throw error
      return data as unknown as { staff_id: string }[]
    }
    const mine = await read(f.staff)
    expect(mine.length).toBeGreaterThan(0)
    expect(mine.every((r) => r.staff_id === f.staff.id)).toBe(true)
    expect(await read(f.staff2)).toEqual([])
    expect(await read(f.manager)).toEqual([])
    expect(await read(admin)).toEqual([])
  })
})

describe("menu notes: refused states", () => {
  let f: Fixture

  beforeAll(async () => {
    f = await venueWithMenu("rn-refuse")
  })

  it("refuses an accepted note", async () => {
    const tikka = t(f.items["mains--tikka"]!)
    const asset = await labelled(f.staff, f.version, [tikka])
    const row = await decide(f.manager, asset.id, tikka, "accepted")
    await fails(
      aside(f.staff, { photo: row.photo_id }),
      "retake_note_not_open",
      "P0001"
    )
  })

  it("refuses a withdrawn note", async () => {
    const dal = t(f.items["mains--dal"]!)
    const { photoId } = await menuNote(f, f.staff, dal)
    await ok(
      f.manager.client.rpc("withdraw_menu_item_photo", {
        p_photo_id: photoId,
        p_expected_revision: await head(dal.itemId),
        p_reason: "Wrong dish",
      })
    )
    expect((await photoRow(photoId)).state).toBe("withdrawn")
    await fails(
      aside(f.staff, { photo: photoId }),
      "retake_note_not_open",
      "P0001"
    )
    expect(await note(f.staff, photoId)).toBeNull()
  })

  it("refuses an invalidated note (its label was removed)", async () => {
    const bhaji = t(f.items["mains--bhaji"]!)
    const { photoId, asset } = await menuNote(f, f.staff, bhaji)
    const { error } = await saveLabels(f.staff, {
      asset: asset.id,
      revision: asset.revision,
      items: [],
      catalogue: f.version,
    })
    expect(error).toBeNull()
    expect((await photoRow(photoId)).state).toBe("invalidated")
    await fails(
      aside(f.staff, { photo: photoId }),
      "retake_note_not_open",
      "P0001"
    )
  })
})

describe("menu notes: clearing (decision 4) and retaken", () => {
  let f: Fixture

  beforeAll(async () => {
    f = await venueWithMenu("rn-clear")
  })

  it("clears when anyone's photo of the same dish is newly accepted, whatever the variant, and stays cleared after a withdrawal", async () => {
    const chicken = t(f.items["mains--korma"]!, 0)
    const lamb = t(f.items["mains--korma"]!, 1)
    const { photoId } = await menuNote(f, f.staff, chicken)
    // A colleague's photo, never among the author's own tiles.
    const other = await labelled(f.staff2, f.version, [lamb])
    const accepted = await decide(f.manager, other.id, lamb, "accepted")
    expect(await note(f.staff, photoId)).toMatchObject({
      status: "cleared",
      can_retake: false,
    })
    await fails(
      aside(f.staff, { photo: photoId }),
      "retake_note_not_open",
      "P0001"
    )
    await ok(
      f.manager.client.rpc("withdraw_menu_item_photo", {
        p_photo_id: accepted.photo_id,
        p_expected_revision: await head(lamb.itemId),
        p_reason: "Not ours",
      })
    )
    expect(await note(f.staff, photoId)).toMatchObject({ status: "cleared" })
  })

  it("an acceptance before the note, or a primary set after it, does not clear it", async () => {
    const tikka = t(f.items["mains--tikka"]!)
    const one = await labelled(f.staff2, f.version, [tikka])
    const two = await labelled(f.staff2, f.version, [tikka])
    const first = await decide(f.manager, one.id, tikka, "accepted")
    const other = await decide(f.manager, two.id, tikka, "accepted")
    expect(first.is_primary).toBe(true)
    expect(other.is_primary).toBe(false)
    const { photoId } = await menuNote(f, f.staff, tikka)
    // primary_set after the note is not a new acceptance.
    await ok(
      f.manager.client.rpc("set_menu_item_primary_photo", {
        p_photo_id: other.photo_id,
        p_expected_revision: await head(tikka.itemId),
      })
    )
    expect(await note(f.staff, photoId)).toMatchObject({ status: "open" })
    // A newly accepted photo after the note does clear it.
    const three = await labelled(f.staff2, f.version, [tikka])
    await decide(f.manager, three.id, tikka, "accepted")
    expect(await note(f.staff, photoId)).toMatchObject({ status: "cleared" })
  })

  it("shows retaken once the author labels a newer photo of the dish, until it is decided", async () => {
    const rice = t(f.items["mains--rice"]!)
    const { photoId } = await menuNote(f, f.staff, rice)
    expect(await note(f.staff, photoId)).toMatchObject({ status: "open" })
    const retake = await labelled(f.staff, f.version, [rice])
    expect(await note(f.staff, photoId)).toMatchObject({
      status: "retaken",
      can_retake: true,
    })
    await fails(
      aside(f.staff, { photo: photoId }),
      "retake_note_not_open",
      "P0001"
    )
    await decide(f.manager, retake.id, rice, "accepted")
    expect(await note(f.staff, photoId)).toMatchObject({ status: "cleared" })
  })
})

describe("coverage notes (month and non-menu sends)", () => {
  let f: Fixture
  let monthItem: string
  let taskItem: string
  let requirement: string

  async function askAgain(itemId: string) {
    const { revision } = await itemRevision(service, itemId)
    await ok(
      reviewCoverage(
        f.manager,
        itemId,
        revision,
        "needs_another_photo",
        "Show the whole bar"
      )
    )
  }

  beforeAll(async () => {
    f = await venueWithMenu("rn-cov")
    const a = await reserveReady(service, f.staff, "image")
    const [sent] = await submit(f.staff, [a.id])
    monthItem = sent!.item_id
    await askAgain(monthItem)

    requirement = await createRequirement(admin, f.venue, {
      title: "TEST Bar set-up",
      kind: "venue_specific",
    })
    await assign(admin, requirement, [f.staff.id])
    const b = await reserveReady(service, f.staff, "image")
    const [task] = await submit(f.staff, [b.id], requirement)
    taskItem = task!.item_id
    await askAgain(taskItem)
  })

  it("lists month and task requests as open and retakeable", async () => {
    expect(await note(f.staff, monthItem)).toMatchObject({
      kind: "coverage",
      requirement_id: null,
      reason: "Show the whole bar",
      status: "open",
      can_retake: true,
    })
    expect(await note(f.staff, taskItem)).toMatchObject({
      kind: "coverage",
      requirement_id: requirement,
      requirement_title: "TEST Bar set-up",
      requirement_kind: "venue_specific",
      status: "open",
      can_retake: true,
    })
  })

  it("Later on a coverage request: own only, once, and hidden from a second session", async () => {
    const before = await totalRows()
    await fails(
      aside(f.staff2, { submissionItem: monthItem }),
      "retake_note_not_found",
      "P0002"
    )
    expect(await totalRows()).toBe(before)
    expect(
      (await asideOk(f.staff, { submissionItem: monthItem })).replayed
    ).toBe(false)
    expect(
      (await asideOk(f.staff, { submissionItem: monthItem })).replayed
    ).toBe(true)
    expect(await totalRows()).toBe(before + 1)
    const second = await signIn(service, f.staff.email)
    expect(await note(second, monthItem)).toMatchObject({ status: "set_aside" })
  })

  it("a replacement makes it retaken, and a decision on the replacement clears it", async () => {
    const c = await reserveReady(service, f.staff, "image")
    const [replacement] = await ok(
      f.staff.client.rpc("submit_coverage_photos", {
        p_asset_ids: [c.id],
        p_requirement_id: requirement,
        p_client_request_key: `test-${crypto.randomUUID()}`,
        p_replaces_item_id: taskItem,
      })
    )
    expect(await note(f.staff, taskItem)).toMatchObject({ status: "retaken" })
    const { revision } = await itemRevision(service, replacement!.item_id)
    await ok(
      reviewCoverage(f.manager, replacement!.item_id, revision, "accepted")
    )
    expect(await note(f.staff, taskItem)).toMatchObject({
      status: "cleared",
      can_retake: false,
    })
    await fails(
      aside(f.staff, { submissionItem: taskItem }),
      "retake_note_not_open",
      "P0001"
    )
  })

  it("refuses an accepted send, and a task no longer open to the person cannot be retaken", async () => {
    const d = await reserveReady(service, f.staff, "image")
    const [sent] = await submit(f.staff, [d.id])
    const { revision } = await itemRevision(service, sent!.item_id)
    await ok(reviewCoverage(f.manager, sent!.item_id, revision, "accepted"))
    await fails(
      aside(f.staff, { submissionItem: sent!.item_id }),
      "retake_note_not_open",
      "P0001"
    )

    const e = await reserveReady(service, f.staff, "image")
    const [other] = await submit(f.staff, [e.id], requirement)
    await askAgain(other!.item_id)
    await assign(admin, requirement, [f.staff2.id])
    expect(await note(f.staff, other!.item_id)).toMatchObject({
      status: "open",
      can_retake: false,
    })
  })
})
