// Album A2 placements (20261117120000_album_places.sql) and the admin counts
// read (20261117140000_album_admin.sql, access only): who may place a menu
// section or amenity category at a place, who may read the placements, which
// keys and places a placement may use, the order of the checks, and that the
// history is append-only. Real signed-in identities through PostgREST; the
// service role and psql only build fixtures and read back.
import { beforeAll, describe, expect, it } from "vitest"

import {
  anonClient,
  createIdentity,
  type TestIdentity,
} from "../support/identities"
import { fails, ok, psql } from "./coverage-fixtures"
import {
  admin as knowledgeAdmin,
  call,
  service,
  world,
  type World,
} from "./knowledge-fixtures"
import { item, menu, publishMenu, section } from "./menus-fixtures"

type Placements = {
  venueId: string
  items: { source: string; key: string; subjectId: string }[]
  sections: { sectionId: string; slug: string; name: string; kind: string }[]
}

type Rpc<T> = PromiseLike<{
  data: T | null
  error: { message: string; code: string; details?: string } | null
}>

type Venue = { w: World; bar: string; garden: string; retired: string }

const MENU = () =>
  menu("TEST places", [
    section("mains", "Mains", [item("mains--korma", "Korma")]),
    section("drinks", "Drinks", [item("drinks--lassi", "Lassi")], "drinks"),
  ])

function place(w: World, label: string, retired = false) {
  return psql(
    `insert into public.knowledge_subjects (venue_id, kind, label, created_by${retired ? ", retired_at, retired_by, retire_reason" : ""})
     values ('${w.venue}', 'area', '${label}', '${w.admin.id}'${retired ? `, now(), '${w.admin.id}', 'TEST retired'` : ""})
     returning id`
  )
}

async function venue(label: string): Promise<Venue> {
  const w = await world(label)
  await publishMenu(w.admin, w.venue, MENU())
  return {
    w,
    bar: place(w, "Bar"),
    garden: place(w, "Garden"),
    retired: place(w, "Old cellar", true),
  }
}

function setPlace(
  who: TestIdentity,
  source: string,
  key: string,
  subjectId: string | null,
  venueId?: string
) {
  return call(who, "album_place_set", {
    p_venue_id: venueId ?? null,
    p_source: source,
    p_key: key,
    p_subject_id: subjectId,
  }) as unknown as Rpc<{ changed: boolean; subjectId: string | null }>
}

const readPlaces = (who: TestIdentity, venueId?: string) =>
  call(
    who,
    "album_places",
    venueId ? { p_venue_id: venueId } : {}
  ) as unknown as Rpc<Placements>

const adminCounts = (who: TestIdentity, venueId: string) =>
  call(who, "album_admin_counts", { p_venue_id: venueId }) as unknown as Rpc<
    Record<string, unknown>
  >

async function events(venueId: string) {
  const { data, error } = await service
    .from("album_place_events" as never)
    .select("id, source, source_key, subject_id")
    .eq("venue_id", venueId)
    .order("id")
  if (error) throw error
  return (data ?? []) as unknown as {
    id: number
    source: string
    source_key: string
    subject_id: string | null
  }[]
}

let v: Venue
let other: Venue

beforeAll(async () => {
  await knowledgeAdmin()
  ;[v, other] = await Promise.all([venue("album-pl-a"), venue("album-pl-b")])
})

describe("album_place_set", () => {
  it("lets the manager place, move and clear a section and a category", async () => {
    expect(
      await ok(setPlace(v.w.manager, "menu_section", "mains", v.bar))
    ).toMatchObject({ changed: true, subjectId: v.bar })
    // The same place again changes nothing and writes no event.
    expect(
      await ok(setPlace(v.w.manager, "menu_section", "mains", v.bar))
    ).toMatchObject({ changed: false })
    await ok(setPlace(v.w.manager, "menu_section", "mains", v.garden))
    await ok(setPlace(v.w.manager, "amenity_category", "Games", v.bar))
    await ok(setPlace(v.w.manager, "amenity_category", "Games", null))

    expect(
      (await events(v.w.venue)).map((e) => [e.source_key, e.subject_id])
    ).toEqual([
      ["mains", v.bar],
      ["mains", v.garden],
      ["Games", v.bar],
      ["Games", null],
    ])
    expect((await ok(readPlaces(v.w.staffA))).items).toEqual([
      { source: "menu_section", key: "mains", subjectId: v.garden },
    ])
  })

  it("lets a grant holder and an admin (naming the venue) write", async () => {
    await ok(setPlace(v.w.staffManager, "menu_section", "drinks", v.bar))
    await ok(
      setPlace(v.w.admin, "amenity_category", "Games", v.garden, v.w.venue)
    )
    await fails(
      setPlace(v.w.admin, "amenity_category", "Games", v.garden),
      "venue_required"
    )
    const read = await ok(readPlaces(v.w.admin, v.w.venue))
    expect(read.items).toEqual(
      expect.arrayContaining([
        { source: "menu_section", key: "drinks", subjectId: v.bar },
        { source: "amenity_category", key: "Games", subjectId: v.garden },
      ])
    )
  })

  it("refuses staff, another venue's manager, an inactive account and anon", async () => {
    await fails(
      setPlace(v.w.staffA, "menu_section", "mains", v.bar),
      "not_venue_manager"
    )
    await fails(
      setPlace(other.w.manager, "menu_section", "mains", v.bar, v.w.venue),
      "not_venue_manager"
    )
    // Their own venue: this venue's place is not one of theirs.
    await fails(
      setPlace(other.w.manager, "menu_section", "mains", v.bar),
      "unknown_place"
    )

    const leaver = await createIdentity(service, {
      label: "album-pl-leaver",
      role: "manager",
      venueId: v.w.venue,
    })
    await ok(
      service.from("profiles").update({ active: false }).eq("id", leaver.id)
    )
    await fails(
      setPlace(leaver, "menu_section", "mains", v.bar, v.w.venue),
      "not_active_user"
    )

    const { error } = await anonClient().rpc(
      "album_place_set" as never,
      {
        p_venue_id: v.w.venue,
        p_source: "menu_section",
        p_key: "mains",
        p_subject_id: v.bar,
      } as never
    )
    expect(error).not.toBeNull()
  })

  it("checks permission before the input", async () => {
    // Staff, here and at another venue, learn nothing about the input.
    for (const who of [v.w.staffA, other.w.staffA])
      await fails(
        setPlace(who, "menu_section", "x".repeat(121), v.bar, v.w.venue),
        "not_venue_manager"
      )
    await fails(
      setPlace(v.w.manager, "menu_section", "x".repeat(121), v.bar),
      "invalid_key"
    )
  })

  it("refuses an unknown section, an unknown category, a retired or foreign place", async () => {
    const before = (await events(v.w.venue)).length
    await fails(
      setPlace(v.w.manager, "menu_section", "does-not-exist", v.bar),
      "unknown_slot"
    )
    await fails(
      setPlace(v.w.manager, "amenity_category", "Not A Category", v.bar),
      "unknown_slot"
    )
    await fails(
      setPlace(v.w.manager, "menu_section", "mains", v.retired),
      "unknown_place"
    )
    await fails(
      setPlace(v.w.manager, "menu_section", "mains", other.bar),
      "unknown_place"
    )
    await fails(
      setPlace(v.w.manager, "menu_item", "mains", v.bar),
      "invalid_source"
    )
    await fails(
      setPlace(v.w.manager, "menu_section", "  ", v.bar),
      "invalid_key"
    )
    expect(await events(v.w.venue)).toHaveLength(before)
  })

  it("still clears a section left off the active menu", async () => {
    await ok(setPlace(other.w.manager, "menu_section", "drinks", other.bar))
    // The next menu has no Drinks section.
    await publishMenu(
      other.w.admin,
      other.w.venue,
      menu("TEST places 2", [
        section("mains", "Mains", [item("mains--korma", "Korma")]),
      ])
    )
    await fails(
      setPlace(other.w.manager, "menu_section", "drinks", other.garden),
      "unknown_slot"
    )
    expect(
      await ok(setPlace(other.w.manager, "menu_section", "drinks", null))
    ).toMatchObject({ changed: true, subjectId: null })
    // Clearing a key with no placement changes nothing.
    expect(
      await ok(setPlace(other.w.manager, "menu_section", "never-placed", null))
    ).toMatchObject({ changed: false })
  })

  it("keeps the history append-only", async () => {
    const [first] = await events(v.w.venue)
    expect(first).toBeDefined()
    expect(() =>
      psql(
        `update public.album_place_events set source_key = 'changed' where id = ${first!.id}`
      )
    ).toThrow()
    expect(() =>
      psql(`delete from public.album_place_events where id = ${first!.id}`)
    ).toThrow()
    expect((await events(v.w.venue))[0]!.source_key).toBe(first!.source_key)
  })
})

describe("album_places", () => {
  it("reads the venue's placements and active sections for staff, grant holder, manager and admin", async () => {
    const mine = await ok(readPlaces(v.w.staffB))
    expect(mine.venueId).toBe(v.w.venue)
    expect(mine.sections.map((s) => s.slug)).toEqual(["mains", "drinks"])
    for (const who of [v.w.staffA, v.w.staffManager, v.w.manager])
      expect(await ok(readPlaces(who))).toEqual(mine)
    expect(await ok(readPlaces(v.w.admin, v.w.venue))).toEqual(mine)
    await fails(readPlaces(v.w.admin), "venue_required")
  })

  it("reads a group placed in a retired place as not placed", async () => {
    const shed = place(v.w, "Shed")
    await ok(setPlace(v.w.manager, "amenity_category", "Outdoor", shed))
    expect((await ok(readPlaces(v.w.staffA))).items).toContainEqual({
      source: "amenity_category",
      key: "Outdoor",
      subjectId: shed,
    })
    psql(
      `update public.knowledge_subjects
       set retired_at = now(), retired_by = '${v.w.admin.id}', retire_reason = 'TEST retired'
       where id = '${shed}'`
    )
    expect(
      (await ok(readPlaces(v.w.staffA))).items.map((i) => i.subjectId)
    ).not.toContain(shed)
  })

  it("refuses another venue, an inactive account and anon", async () => {
    await fails(readPlaces(other.w.staffA, v.w.venue), "wrong_venue")
    await fails(readPlaces(other.w.manager, v.w.venue), "wrong_venue")
    expect(
      (await ok(readPlaces(other.w.staffA))).items.map((i) => i.subjectId)
    ).not.toContain(v.bar)

    const leaver = await createIdentity(service, {
      label: "album-pl-reader",
      role: "staff",
      venueId: v.w.venue,
    })
    await ok(
      service.from("profiles").update({ active: false }).eq("id", leaver.id)
    )
    await fails(readPlaces(leaver), "not_active_user")

    const anon = await anonClient().rpc("album_places" as never, {} as never)
    expect(anon.error).not.toBeNull()
    expect(anon.data).toBeNull()

    // No direct table access for signed-in users.
    const { data: direct } = await v.w.manager.client
      .from("album_places" as never)
      .select("*")
    expect(direct ?? []).toEqual([])
  })
})

describe("album_admin_counts (access only)", () => {
  it("answers an admin and refuses everyone else", async () => {
    expect(await ok(adminCounts(v.w.admin, v.w.venue))).toBeTruthy()
    for (const who of [
      v.w.staffA,
      v.w.staffManager,
      v.w.manager,
      other.w.manager,
    ])
      await fails(adminCounts(who, v.w.venue), "not_admin")
    const anon = await anonClient().rpc(
      "album_admin_counts" as never,
      { p_venue_id: v.w.venue } as never
    )
    expect(anon.error).not.toBeNull()
    expect(anon.data).toBeNull()
  })

  it("gives the functions no anon grant", () => {
    expect(
      psql(
        `select has_function_privilege('anon', 'public.album_places(uuid)', 'execute')::text
           || ',' || has_function_privilege('anon', 'public.album_place_set(uuid, text, text, uuid)', 'execute')::text
           || ',' || has_function_privilege('anon', 'public.album_admin_counts(uuid)', 'execute')::text`
      )
    ).toBe("false,false,false")
  })
})
