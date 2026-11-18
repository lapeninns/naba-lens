// S1-MENUS scheduled activation (20261118103000_menu_scheduled_activation.sql):
// who may schedule, activate with confirmed retirements and promote; that a
// scheduled draft changes nothing until it is due (AC27); that a schedule
// lapses when its draft or retirements change; that retirements need explicit
// approval (AC28); the manager's read of active and future menus. Real
// signed-in identities through PostgREST; the service role and psql only
// build fixtures and read back.
import { beforeAll, describe, expect, it } from "vitest"

import {
  anonClient,
  createIdentity,
  createVenue,
  serviceClient,
  type TestIdentity,
} from "../support/identities"
import { fails, makeManager, ok, psql } from "./coverage-fixtures"
import { call } from "./knowledge-fixtures"
import {
  createDraft,
  item,
  menu,
  publishMenu,
  readDocument,
  section,
} from "./menus-fixtures"

const service = serviceClient()

type Rpc<T = unknown> = PromiseLike<{
  data: T | null
  error: { message: string; code: string; details?: string } | null
}>

const V1 = () =>
  menu("TEST v1", [
    section("mains", "Mains", [
      item("mains--korma", "Korma"),
      item("mains--dal", "Dal"),
    ]),
  ])

type World = {
  venue: string
  active: string
  mgr: TestIdentity
  staff: TestIdentity
}

let admin: TestIdentity
let w: World
let other: World

async function world(label: string): Promise<World> {
  const venue = (await createVenue(service, label)).id
  const active = await publishMenu(admin, venue, V1())
  const [mgr, staff] = await Promise.all([
    createIdentity(service, {
      label: `${label}-mgr`,
      role: "staff",
      venueId: venue,
    }),
    createIdentity(service, {
      label: `${label}-s`,
      role: "staff",
      venueId: venue,
    }),
  ])
  await makeManager(admin, mgr, venue)
  return { venue, active, mgr, staff }
}

/** Stable ids of the active version's items, by source key. */
async function ids(versionId: string) {
  const { byKey } = await readDocument(service, versionId)
  return (key: string) => byKey[key]!.itemId
}

/** V2 based on the active version: Korma carried, Dal retired, Tikka new. */
async function draftOf(w: World) {
  const id = await ids(w.active)
  return createDraft(
    admin,
    w.venue,
    menu("TEST v2", [
      section("mains", "Mains", [
        item("mains--korma", "Korma", { itemId: id("mains--korma") }),
        item("mains--tikka", "Tikka"),
      ]),
    ]),
    w.active
  )
}

async function version(id: string) {
  return ok(
    service
      .from("menu_versions")
      .select("status, revision")
      .eq("id", id)
      .single()
  ) as Promise<{ status: string; revision: number }>
}

const inMinutes = (m: number) => new Date(Date.now() + m * 60_000).toISOString()

function schedule(
  who: TestIdentity,
  id: string,
  revision: number,
  at: string,
  retirements: number | null
) {
  return call(who, "schedule_menu_version", {
    p_version_id: id,
    p_expected_revision: revision,
    p_at: at,
    p_retirements: retirements,
  }) as Rpc<{ retirements: number }>
}

function activateConfirmed(
  who: TestIdentity,
  id: string,
  revision: number,
  retirements: number | null
) {
  return call(who, "activate_menu_version_confirmed", {
    p_version_id: id,
    p_expected_revision: revision,
    p_retirements: retirements,
  }) as Rpc
}

const due = (who: TestIdentity, venue: string) =>
  call(who, "menu_activate_due", { p_venue_id: venue }) as Rpc<number>

function makeDue(id: string) {
  psql(
    `update public.menu_versions set scheduled_for = now() - interval '1 minute' where id = '${id}'`
  )
}

function withoutKeys(doc: Awaited<ReturnType<typeof readDocument>>) {
  const { byKey: _byKey, ...rest } = doc
  void _byKey
  return rest
}

async function actions(venue: string) {
  const { data, error } = await service
    .from("menu_events")
    .select("action, detail")
    .eq("venue_id", venue)
    .order("id")
  if (error) throw error
  return data
}

beforeAll(async () => {
  admin = await createIdentity(service, {
    label: "menus-sched-admin",
    role: "admin",
  })
  ;[w, other] = await Promise.all([
    world("menus-sched-a"),
    world("menus-sched-b"),
  ])
})

describe("activation impact and confirmed retirements (AC28)", () => {
  it("lists what a draft retires and refuses activation until the count is confirmed", async () => {
    const v = await world("menus-sched-ret")
    const id = await draftOf(v)
    const impact = (await ok(
      call(admin, "menu_version_activation_impact", {
        p_version_id: id,
      }) as Rpc<{
        retirements: { name: string }[]
      }>
    ))!
    expect(impact.retirements.map((r) => r.name)).toEqual(["Dal"])

    const { revision } = await version(id)
    const missing = await fails(
      activateConfirmed(admin, id, revision, null),
      "menu_retirements_unconfirmed"
    )
    expect(JSON.parse(missing.details!)).toEqual({ retirements: 1 })
    await fails(
      activateConfirmed(admin, id, revision, 0),
      "menu_retirements_unconfirmed"
    )
    await ok(activateConfirmed(admin, id, revision, 1))
    expect((await version(id)).status).toBe("active")
    expect((await version(v.active)).status).toBe("retired")
  })

  it("is admin-only", async () => {
    const id = await draftOf(w)
    const { revision } = await version(id)
    for (const who of [w.mgr, w.staff])
      await fails(
        activateConfirmed(who, id, revision, 1),
        "not_active_admin",
        "42501"
      )
    for (const who of [w.mgr, w.staff])
      await fails(
        call(who, "menu_version_activation_impact", {
          p_version_id: id,
        }) as Rpc,
        "not_active_admin"
      )
    const { error } = await anonClient().rpc(
      "activate_menu_version_confirmed" as never,
      {
        p_version_id: id,
        p_expected_revision: revision,
        p_retirements: 1,
      } as never
    )
    expect(error).not.toBeNull()
    await ok(call(admin, "discard_menu_draft", { p_version_id: id }) as Rpc)
  })
})

describe("scheduling", () => {
  it("keeps the current menu until the schedule is due, then activates as the scheduler (AC27)", async () => {
    const v = await world("menus-sched-due")
    const id = await draftOf(v)
    const { revision } = await version(id)
    await fails(
      schedule(admin, id, revision, inMinutes(-5), 1),
      "menu_schedule_in_past"
    )
    await fails(
      schedule(admin, id, revision, inMinutes(60 * 24 * 400), 1),
      "menu_schedule_too_far"
    )
    await fails(
      schedule(admin, id, revision, inMinutes(30), null),
      "menu_retirements_unconfirmed"
    )
    expect(
      await ok(schedule(admin, id, revision, inMinutes(30), 1))
    ).toMatchObject({ retirements: 1 })

    // Not due: nothing changes, for the manager's call either.
    expect(await ok(due(v.mgr, v.venue))).toBe(0)
    expect((await version(v.active)).status).toBe("active")
    expect((await version(id)).status).toBe("draft")

    // The manager sees it as scheduled, with what it adds and retires.
    const read = (await ok(
      call(v.mgr, "menu_versions_for_venue", { p_venue_id: v.venue }) as Rpc<{
        items: {
          versionId: string
          state: string
          upcomingCount: number | null
          retiringCount: number | null
        }[]
      }>
    ))!
    expect(read.items.map((i) => [i.versionId, i.state])).toEqual([
      [id, "scheduled"],
      [v.active, "active"],
    ])
    expect(read.items[0]).toMatchObject({ upcomingCount: 1, retiringCount: 1 })

    makeDue(id)
    expect(await ok(due(v.mgr, v.venue))).toBe(1)
    expect((await version(id)).status).toBe("active")
    expect((await version(v.active)).status).toBe("retired")
    // Repeating finds nothing due.
    expect(await ok(due(v.mgr, v.venue))).toBe(0)

    const { data: row } = await service
      .from("menu_versions")
      .select("activated_by")
      .eq("id", id)
      .single()
    expect(row!.activated_by).toBe(admin.id)
    expect((await actions(v.venue)).map((e) => e.action)).toEqual(
      expect.arrayContaining(["scheduled", "activated", "retired"])
    )

    // Archive filter: the retired version only on request.
    const withArchived = (await ok(
      call(v.mgr, "menu_versions_for_venue", {
        p_venue_id: v.venue,
        p_include_archived: true,
      }) as Rpc<{ items: { state: string }[] }>
    ))!
    expect(withArchived.items.map((i) => i.state)).toEqual([
      "active",
      "retired",
    ])
  })

  it("clears the schedule when the draft is saved, and lapses when its retirements change", async () => {
    const v = await world("menus-sched-lapse")
    const id = await draftOf(v)
    let { revision } = await version(id)
    await ok(schedule(admin, id, revision, inMinutes(30), 1))
    await ok(
      call(admin, "save_menu_draft", {
        p_version_id: id,
        p_expected_revision: revision,
        p_document: withoutKeys(await readDocument(service, id)),
      }) as Rpc
    )
    const { data: cleared } = await service
      .from("menu_versions")
      .select("scheduled_for")
      .eq("id", id)
      .single()
    expect(cleared!.scheduled_for).toBeNull()

    // Schedule again, then the active menu changes underneath it.
    ;({ revision } = await version(id))
    await ok(schedule(admin, id, revision, inMinutes(30), 1))
    const activeId = await ids(v.active)
    const keepAll = await createDraft(
      admin,
      v.venue,
      menu("TEST v1b", [
        section("mains", "Mains", [
          item("mains--korma", "Korma", { itemId: activeId("mains--korma") }),
          item("mains--dal", "Dal", { itemId: activeId("mains--dal") }),
          item("mains--bhaji", "Bhaji"),
        ]),
      ]),
      v.active
    )
    await ok(
      activateConfirmed(admin, keepAll, (await version(keepAll)).revision, null)
    )
    makeDue(id)
    // Now it would retire Dal and Bhaji, not the one approved.
    expect(await ok(due(admin, v.venue))).toBe(0)
    expect((await version(id)).status).toBe("draft")
    const lapsed = (await actions(v.venue)).filter(
      (e) => e.action === "schedule_lapsed"
    )
    expect(lapsed).toHaveLength(1)
    expect(lapsed[0]!.detail).toMatchObject({ reason: "retirements_changed" })
  })

  it("allows one scheduled draft per venue and lets an admin unschedule", async () => {
    const a = await draftOf(other)
    const b = await draftOf(other)
    await ok(schedule(admin, a, (await version(a)).revision, inMinutes(60), 1))
    await fails(
      schedule(admin, b, (await version(b)).revision, inMinutes(90), 1),
      "menu_schedule_exists"
    )
    await fails(
      call(other.mgr, "unschedule_menu_version", { p_version_id: a }) as Rpc,
      "not_active_admin"
    )
    await ok(call(admin, "unschedule_menu_version", { p_version_id: a }) as Rpc)
    await ok(schedule(admin, b, (await version(b)).revision, inMinutes(90), 1))
    await ok(call(admin, "unschedule_menu_version", { p_version_id: b }) as Rpc)
  })

  it("refuses scheduling and promotion to everyone else", async () => {
    const id = await draftOf(w)
    const { revision } = await version(id)
    for (const who of [w.mgr, w.staff])
      await fails(
        schedule(who, id, revision, inMinutes(30), 1),
        "not_active_admin"
      )
    // Promotion: staff, another venue's manager.
    await fails(due(w.staff, w.venue), "not_venue_manager")
    await fails(due(other.mgr, w.venue), "not_venue_manager")
    // The all-venues promotion is the service role's (cron) only.
    for (const who of [admin, w.mgr]) {
      const { error } = await call(who, "menu_activate_due_all", {})
      expect(error).not.toBeNull()
    }
    expect(
      typeof (await ok(
        service.rpc("menu_activate_due_all" as never) as unknown as Rpc<number>
      ))
    ).toBe("number")

    // Inactive manager and anon.
    const leaver = await createIdentity(service, {
      label: "menus-sched-leaver",
      role: "staff",
      venueId: w.venue,
    })
    await makeManager(admin, leaver, w.venue)
    await ok(
      service.from("profiles").update({ active: false }).eq("id", leaver.id)
    )
    await fails(due(leaver, w.venue), "not_active_user")
    await fails(
      call(leaver, "menu_versions_for_venue", { p_venue_id: w.venue }) as Rpc,
      "not_active_user"
    )
    const { error } = await anonClient().rpc(
      "menu_activate_due" as never,
      { p_venue_id: w.venue } as never
    )
    expect(error).not.toBeNull()
  })

  it("lets only the venue's manager and admins read its versions", async () => {
    await ok(
      call(admin, "menu_versions_for_venue", { p_venue_id: w.venue }) as Rpc
    )
    await ok(
      call(w.mgr, "menu_versions_for_venue", { p_venue_id: w.venue }) as Rpc
    )
    await fails(
      call(w.staff, "menu_versions_for_venue", { p_venue_id: w.venue }) as Rpc,
      "not_venue_manager"
    )
    await fails(
      call(other.mgr, "menu_versions_for_venue", {
        p_venue_id: w.venue,
      }) as Rpc,
      "not_venue_manager"
    )
  })
})
