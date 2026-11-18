// Full App v1, S5-R2 (Y4, FA-52): the manager review screen shows the brief
// staff were given. Review in a thumb reads the waiting area photos
// (public.area_photo_queue) and every slot's brief (public.slot_briefs with
// open requests) at the manager's venue, and joins them by slot key
// ("dish:<item id>", "area:<subject id>"). Real signed-in identities through
// PostgREST; the service role and psql only build fixtures.
//
//   1 the queue's subject id is the key slot_briefs uses for the area, so an
//     area photo gets the Spaces template, then an open request's brief
//   2 a dish's request brief reaches the manager's read, as staff see it
//   3 another venue's manager, staff and an aal1 admin cannot read either
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { createIdentity, type TestIdentity } from "../support/identities"
import { fails, ok, psql } from "./coverage-fixtures"
import { call, json, service, world, type World } from "./knowledge-fixtures"
import {
  item,
  menu,
  publishMenu,
  readDocument,
  reserve,
  section,
} from "./menus-fixtures"

type Resolved = {
  kind: string
  slotId: string
  brief: string
  source: "request" | "manager" | "catalogue" | "template"
}
type QueueRow = { label_id: string; subject_id: string; subject_label: string }

type V = { w: World; shank: string; garden: string }

async function venue(label: string): Promise<V> {
  const w = await world(label)
  const version = await publishMenu(
    w.admin,
    w.venue,
    menu("TEST review briefs", [
      section("mains", "Mains", [item("mains--shank", "Lamb shank")]),
    ])
  )
  const byKey = (await readDocument(service, version)).byKey
  const garden = psql(
    `insert into public.knowledge_subjects (venue_id, kind, label, created_by)
     values ('${w.venue}', 'area', 'Garden', '${w.admin.id}') returning id`
  )
  return { w, shank: byKey["mains--shank"]!.itemId, garden }
}

/** A ready image by `who`, labelled with the area and waiting for review. */
async function pendingAreaPhoto(who: TestIdentity, v: V) {
  const { id } = await reserve(who, "image")
  await ok(
    service
      .from("media_assets")
      .update({ upload_state: "processing" })
      .eq("id", id)
  )
  psql(
    `update public.media_assets set upload_state = 'ready',
       validated_mime_type = 'image/jpeg', size_bytes = 4, width = 1, height = 1,
       thumbnail_path = uploader_id::text || '/' || id::text || '/thumb.webp'
     where id = '${id}'`
  )
  return psql(
    `insert into public.media_area_labels (asset_id, venue_id, subject_id, subject_kind, subject_label, added_by)
     values ('${id}', '${v.w.venue}', '${v.garden}', 'area', 'Garden', '${who.id}')
     returning id`
  )
}

const reviewBriefs = async (who: { client: unknown }, venue: string) =>
  new Map(
    (
      await json<{ items: Resolved[] }>(who, "slot_briefs", {
        p_venue_id: venue,
        p_include_requests: true,
      })
    ).items.map((r) => [`${r.kind}:${r.slotId}`, r])
  )

const queue = (who: { client: unknown }, venue: string) =>
  json<QueueRow[]>(who, "area_photo_queue", {
    p_venue_id: venue,
    p_status: "pending",
    p_limit: 50,
  })

let a: V
let b: V
let adminAal1: TestIdentity
let spaces: string

beforeAll(async () => {
  ;[a, b] = await Promise.all([venue("s5r2-a"), venue("s5r2-b")])
  adminAal1 = await createIdentity(service, {
    label: "s5r2-admin-aal1",
    role: "staff",
    venueId: a.w.venue,
  })
  await ok(
    service
      .from("profiles")
      .update({ role: "admin", venue_id: null })
      .eq("id", adminAal1.id)
  )
  spaces = psql(
    `select instruction from public.shot_templates where category = 'spaces'`
  )
})

afterAll(() => {
  // Templates are organisation-wide: leave Spaces as it was.
  psql(
    `update public.shot_templates set instruction = $q$${spaces}$q$
     where category = 'spaces'`
  )
})

describe("review briefs: the manager reads what staff were given", () => {
  it("an area photo's queue subject is its slot key: the template, then a request's brief", async () => {
    const label = await pendingAreaPhoto(a.w.staffA, a)
    const row = (await queue(a.w.manager, a.w.venue)).find(
      (r) => r.label_id === label
    )!
    expect(row.subject_id).toBe(a.garden)

    const before = await reviewBriefs(a.w.manager, a.w.venue)
    expect(before.get(`area:${row.subject_id}`)).toMatchObject({
      source: "template",
      brief: spaces,
    })

    // A template change reaches the review read (FA-52: the brief shown
    // everywhere it is the fallback).
    const current = (
      await json<{ category: string; revision: number }[]>(
        a.w.admin,
        "shot_templates"
      )
    ).find((t) => t.category === "spaces")!
    await ok(
      call(a.w.admin, "shot_template_set", {
        p_category: "spaces",
        p_instruction: "TEST wide, from the door",
        p_example_asset_id: null,
        p_expected_revision: current.revision,
        p_reason: null,
      }) as never
    )
    expect(
      (await reviewBriefs(a.w.manager, a.w.venue)).get(`area:${a.garden}`)
    ).toMatchObject({ source: "template", brief: "TEST wide, from the door" })

    await ok(
      call(a.w.manager, "media_request_create", {
        p_type: "missing_photo",
        p_venue_id: null,
        p_intended_use: "public",
        p_slot_kind: "area",
        p_slot_id: a.garden,
        p_brief: "TEST the garden with the lights on",
      }) as never
    )
    expect(
      (await reviewBriefs(a.w.manager, a.w.venue)).get(`area:${a.garden}`)
    ).toMatchObject({
      source: "request",
      brief: "TEST the garden with the lights on",
    })
  })

  it("a dish's open request brief is the manager's review brief, as on the staff side", async () => {
    await ok(
      call(a.w.manager, "album_brief_set", {
        p_venue_id: null,
        p_source: "menu_section",
        p_key: "mains",
        p_brief: "TEST mains on the pass",
      }) as never
    )
    expect(
      (await reviewBriefs(a.w.manager, a.w.venue)).get(`dish:${a.shank}`)
    ).toMatchObject({ source: "manager", brief: "TEST mains on the pass" })
    await ok(
      call(a.w.manager, "media_request_create", {
        p_type: "missing_photo",
        p_venue_id: null,
        p_intended_use: "public",
        p_slot_kind: "dish",
        p_slot_id: a.shank,
        p_brief: "Side view showing the mash",
      }) as never
    )
    const managerSees = (await reviewBriefs(a.w.manager, a.w.venue)).get(
      `dish:${a.shank}`
    )
    const staffSee = (
      await json<{ items: Resolved[] }>(a.w.staffA, "slot_briefs", {})
    ).items.find((r) => r.kind === "dish" && r.slotId === a.shank)
    expect(managerSees).toMatchObject({
      source: "request",
      brief: "Side view showing the mash",
    })
    expect(staffSee).toEqual(managerSees)
  })

  it("another venue's manager, staff and an aal1 admin read neither", async () => {
    await fails(
      call(b.w.manager, "slot_briefs", { p_venue_id: a.w.venue }) as never,
      "wrong_venue"
    )
    const other = await call(b.w.manager, "area_photo_queue", {
      p_venue_id: a.w.venue,
      p_status: "pending",
      p_limit: 50,
    })
    expect((other as { error: unknown }).error).not.toBeNull()
    const staff = await call(a.w.staffA, "area_photo_queue", {
      p_venue_id: a.w.venue,
      p_status: "pending",
      p_limit: 50,
    })
    expect((staff as { error: unknown }).error).not.toBeNull()
    await fails(
      call(adminAal1, "slot_briefs", { p_venue_id: a.w.venue }) as never,
      "not_venue_manager"
    )
    // Venue B's slots never appear in venue A's review read.
    expect(
      (await reviewBriefs(a.w.manager, a.w.venue)).has(`dish:${b.shank}`)
    ).toBe(false)
  })
})
