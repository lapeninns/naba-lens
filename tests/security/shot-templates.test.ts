// Full App v1, S5-TEMPLATES (FA-52): shot templates and the one slot brief
// resolver (20261118134000_shot_templates.sql). Real signed-in identities
// through PostgREST; the service role and psql only build fixtures and read
// back.
//
//   1 every active person reads the five templates; only an aal2 admin
//     changes one, with a revision, limits and an activity record
//   2 an example must be a ready image accepted at the public level and not
//     withdrawn; one that stops qualifying is no longer shown anywhere
//   3 public.slot_briefs resolves request, manager, catalogue, template, in
//     that order, with the example that goes with it; a template change
//     never rewrites a manager's brief
//   4 the venue rule: staff and managers read their own venue only; an admin
//     names one; an aal1 admin, anon and another venue's manager are refused
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import {
  anonClient,
  createIdentity,
  type TestIdentity,
} from "../support/identities"
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

type Template = {
  category: string
  instruction: string
  exampleAssetId: string | null
  revision: number
  storedExampleAssetId?: string | null
  exampleUnavailable?: boolean
  updatedBy?: string | null
}
type Resolved = {
  kind: string
  slotId: string
  category: string
  brief: string
  source: "request" | "manager" | "catalogue" | "template"
  exampleAssetId: string | null
}

const MENU = () =>
  menu("TEST templates", [
    section("mains", "Mains", [
      item("mains--pie", "Pie"),
      item("mains--fish", "Fish"),
    ]),
    section("drinks", "Drinks", [item("drinks--ale", "Ale")], "drinks"),
  ])

type V = {
  w: World
  pie: string
  fish: string
  ale: string
  garden: string
}

async function venue(label: string): Promise<V> {
  const w = await world(label)
  const version = await publishMenu(w.admin, w.venue, MENU())
  const byKey = (await readDocument(service, version)).byKey
  const garden = psql(
    `insert into public.knowledge_subjects (venue_id, kind, label, created_by)
     values ('${w.venue}', 'area', 'Garden', '${w.admin.id}') returning id`
  )
  return {
    w,
    pie: byKey["mains--pie"]!.itemId,
    fish: byKey["mains--fish"]!.itemId,
    ale: byKey["drinks--ale"]!.itemId,
    garden,
  }
}

/** A ready image (or video) with a thumbnail, uploaded by `who`. */
async function image(
  who: TestIdentity,
  mediaType: "image" | "video" = "image"
) {
  const { id } = await reserve(who, mediaType)
  await ok(
    service
      .from("media_assets")
      .update({ upload_state: "processing" })
      .eq("id", id)
  )
  // A ready asset is immutable, so the thumbnail is written as it turns ready.
  psql(
    `update public.media_assets set upload_state = 'ready',
       validated_mime_type = '${mediaType === "image" ? "image/jpeg" : "video/mp4"}',
       size_bytes = 4, width = 1, height = 1,
       thumbnail_path = uploader_id::text || '/' || id::text || '/thumb.webp'
     where id = '${id}'`
  )
  return id
}

/** Labels the asset with a new place and records an accepted decision. */
function acceptOnPlace(asset: string, decider: string, level = "public") {
  return psql(
    `with a as (
       select id, venue_id, uploader_id from public.media_assets where id = '${asset}'
     ), s as (
       insert into public.knowledge_subjects (venue_id, kind, label, created_by)
       select a.venue_id, 'area', 'Example ' || left(md5(random()::text), 8), '${decider}'
       from a returning id, venue_id, label
     ), l as (
       insert into public.media_area_labels (asset_id, venue_id, subject_id, subject_kind, subject_label, added_by)
       select a.id, s.venue_id, s.id, 'area', s.label, a.uploader_id from a, s
       returning id, venue_id, asset_id
     ), d as (
       insert into public.area_photo_decisions (label_id, venue_id, asset_id, action, review_level, decided_by)
       select l.id, l.venue_id, l.asset_id, 'accepted', '${level}', '${decider}' from l
       returning label_id
     )
     select label_id from d`
  )
}

const templates = (who: { client: unknown }) =>
  json<Template[]>(who, "shot_templates")

const templateOf = async (who: { client: unknown }, category: string) =>
  (await templates(who)).find((t) => t.category === category)!

const setTemplate = (
  who: { client: unknown },
  args: {
    category: string
    instruction: string
    example?: string | null
    revision: number
    reason?: string | null
  }
) =>
  call(who, "shot_template_set", {
    p_category: args.category,
    p_instruction: args.instruction,
    p_example_asset_id: args.example ?? null,
    p_expected_revision: args.revision,
    p_reason: args.reason ?? null,
  }) as PromiseLike<{
    data: { changed: boolean; revision: number } | null
    error: { message: string; code: string; details?: string } | null
  }>

async function setOk(
  who: { client: unknown },
  category: string,
  instruction: string,
  example: string | null = null
) {
  const current = await templateOf(who, category)
  return (await ok(
    setTemplate(who, {
      category,
      instruction,
      example,
      revision: current.revision,
    })
  ))!
}

const briefs = async (
  who: { client: unknown },
  venue?: string,
  includeRequests = true
) =>
  (
    await json<{ venueId: string; items: Resolved[] }>(who, "slot_briefs", {
      ...(venue ? { p_venue_id: venue } : {}),
      p_include_requests: includeRequests,
    })
  ).items

const briefOf = async (
  who: { client: unknown },
  kind: string,
  slotId: string,
  venue?: string,
  includeRequests = true
) =>
  (await briefs(who, venue, includeRequests)).find(
    (r) => r.kind === kind && r.slotId === slotId
  )!

const canOpen = async (who: { client: unknown }, asset: string) =>
  json<boolean>(who, "shot_template_example_can_open", { p_asset_id: asset })

let a: V
let b: V
let adminAal1: TestIdentity
let inactive: TestIdentity
const seeded = new Map<string, string>()

beforeAll(async () => {
  ;[a, b] = await Promise.all([venue("tmpl-a"), venue("tmpl-b")])
  adminAal1 = await createIdentity(service, {
    label: "tmpl-admin-aal1",
    role: "staff",
    venueId: a.w.venue,
  })
  await ok(
    service
      .from("profiles")
      .update({ role: "admin", venue_id: null })
      .eq("id", adminAal1.id)
  )
  inactive = await createIdentity(service, {
    label: "tmpl-inactive",
    role: "staff",
    venueId: a.w.venue,
    active: false,
  })
  for (const line of psql(
    `select category || '|' || instruction from public.shot_templates order by category`
  ).split("\n"))
    seeded.set(line.split("|")[0]!, line.slice(line.indexOf("|") + 1))
})

afterAll(() => {
  // The templates are organisation-wide: put the seeded words back.
  for (const [category, instruction] of seeded)
    psql(
      `update public.shot_templates set instruction = $q$${instruction}$q$, example_asset_id = null
       where category = '${category}'`
    )
})

describe("reading the templates", () => {
  it("gives every active person the five categories in order, with plain seeded words", async () => {
    const list = await templates(a.w.staffA)
    expect(list.map((t) => t.category)).toEqual([
      "food",
      "drinks",
      "spaces",
      "facilities",
      "other",
    ])
    for (const t of list) {
      expect(t.instruction.length).toBeGreaterThan(0)
      expect(t.instruction.length).toBeLessThanOrEqual(140)
      // Staff never see who changed it or a stored example.
      expect(t).not.toHaveProperty("storedExampleAssetId")
      expect(t).not.toHaveProperty("updatedBy")
    }
    // Spec §11: a clear, truthful photograph of the normal serving or space.
    expect(seeded.get("food")).toMatch(/normally served/)
    expect(seeded.get("spaces")).toMatch(/clear, true photo/)
    const admin = await templateOf(a.w.admin, "food")
    expect(admin).toHaveProperty("storedExampleAssetId")
    expect(admin).toHaveProperty("exampleUnavailable", false)
  })

  it("refuses anon and an inactive account", async () => {
    const anon = await anonClient().rpc("shot_templates" as never)
    expect(anon.error).not.toBeNull()
    await fails(call(inactive, "shot_templates") as never, "not_active_user")
  })
})

describe("changing a template", () => {
  it("refuses staff, managers (own or another venue), an aal1 admin, inactive and anon", async () => {
    const t = await templateOf(a.w.admin, "other")
    for (const who of [
      a.w.staffA,
      a.w.manager,
      a.w.staffManager,
      b.w.manager,
      adminAal1,
      inactive,
    ]) {
      await fails(
        setTemplate(who, {
          category: "other",
          instruction: "Nope",
          revision: t.revision,
        }) as never,
        "not_admin"
      )
      await fails(
        call(who, "shot_template_example_choices", {}) as never,
        "not_admin"
      )
    }
    const anon = await anonClient().rpc(
      "shot_template_set" as never,
      {
        p_category: "other",
        p_instruction: "Nope",
        p_example_asset_id: null,
        p_expected_revision: t.revision,
      } as never
    )
    expect(anon.error).not.toBeNull()
    expect((await templateOf(a.w.admin, "other")).instruction).toBe(
      seeded.get("other")
    )
  })

  it("lets an aal2 admin change it, records the change once, and refuses a stale revision", async () => {
    const before = await templateOf(a.w.admin, "other")
    const count = () =>
      Number(
        psql(
          `select count(*) from public.activity_events
           where action = 'shot_template_set' and object_id = 'other'`
        )
      )
    const events = count()
    const saved = (await ok(
      setTemplate(a.w.admin, {
        category: "other",
        instruction: "  The thing itself, in good light.  ",
        revision: before.revision,
        reason: "Clearer words",
      })
    ))!
    expect(saved).toMatchObject({
      changed: true,
      revision: before.revision + 1,
    })
    const after = await templateOf(a.w.staffA, "other")
    expect(after).toMatchObject({
      instruction: "The thing itself, in good light.",
      revision: before.revision + 1,
    })
    expect(count()).toBe(events + 1)
    expect(
      psql(
        `select actor_id || '|' || actor_role || '|' || coalesce(venue_id::text, 'org') || '|' ||
           object_type || '|' || old_revision || '|' || new_revision || '|' || reason || '|' ||
           (before ->> 'instruction') || '|' || (after ->> 'instruction')
         from public.activity_events
         where action = 'shot_template_set' and object_id = 'other' order by id desc limit 1`
      )
    ).toBe(
      `${a.w.admin.id}|admin|org|shot_template|${before.revision}|${before.revision + 1}|Clearer words|${before.instruction}|The thing itself, in good light.`
    )
    // The admin's Activity screen lists it.
    const activity = await json<{ items: { action: string }[] }>(
      a.w.admin,
      "admin_activity",
      { p_action: "shot_template_set" }
    )
    expect(activity.items.length).toBeGreaterThan(0)

    // The same values again: nothing changes, nothing is recorded.
    const same = (await ok(
      setTemplate(a.w.admin, {
        category: "other",
        instruction: "The thing itself, in good light.",
        revision: before.revision + 1,
      })
    ))!
    expect(same.changed).toBe(false)
    expect(count()).toBe(events + 1)

    await fails(
      setTemplate(a.w.admin, {
        category: "other",
        instruction: "Old tab",
        revision: before.revision,
      }) as never,
      "stale_revision"
    )
  })

  it("holds the one-line limit and the five categories", async () => {
    const t = await templateOf(a.w.admin, "other")
    const bad = (instruction: string, code: string, category = "other") =>
      fails(
        setTemplate(a.w.admin, {
          category,
          instruction,
          revision: t.revision,
        }) as never,
        code
      )
    await bad("a".repeat(141), "invalid_instruction")
    await bad("two\nlines", "invalid_instruction")
    await bad("   ", "instruction_required")
    await bad("Fine", "invalid_category", "garnish")
    await ok(
      setTemplate(a.w.admin, {
        category: "other",
        instruction: "a".repeat(140),
        revision: t.revision,
      })
    )
  })
})

describe("the example photo", () => {
  it("takes only a ready image accepted at the public level and not withdrawn", async () => {
    const unreviewed = await image(a.w.staffA)
    const reference = await image(a.w.staffA)
    acceptOnPlace(reference, a.w.admin.id, "reference")
    const video = await image(a.w.staffA, "video")
    acceptOnPlace(video, a.w.admin.id)
    const good = await image(a.w.staffA)
    acceptOnPlace(good, a.w.admin.id)

    const t = await templateOf(a.w.admin, "spaces")
    for (const asset of [unreviewed, reference, video]) {
      await fails(
        setTemplate(a.w.admin, {
          category: "spaces",
          instruction: t.instruction,
          example: asset,
          revision: t.revision,
        }) as never,
        "invalid_example"
      )
    }

    const choices = await json<{
      items: { assetId: string; venueId: string }[]
    }>(a.w.admin, "shot_template_example_choices", {
      p_venue_id: a.w.venue,
      p_limit: 60,
    })
    const listed = choices.items.map((c) => c.assetId)
    expect(listed).toContain(good)
    expect(listed).not.toContain(unreviewed)
    expect(listed).not.toContain(reference)
    expect(listed).not.toContain(video)
    expect(choices.items.every((c) => c.venueId === a.w.venue)).toBe(true)

    await setOk(a.w.admin, "spaces", t.instruction, good)
    expect((await templateOf(a.w.staffA, "spaces")).exampleAssetId).toBe(good)
    // Staff at any venue may open a current example's thumbnail.
    expect(await canOpen(b.w.staffA, good)).toBe(true)
    expect(await canOpen(b.w.staffA, unreviewed)).toBe(false)

    // Withdrawn in the Library: no longer shown, still stored for Settings.
    await ok(
      call(a.w.admin, "library_withdraw_asset", {
        p_asset_id: good,
        p_reason: "TEST withdrawn example",
      }) as never
    )
    expect((await templateOf(a.w.staffA, "spaces")).exampleAssetId).toBeNull()
    expect(await templateOf(a.w.admin, "spaces")).toMatchObject({
      exampleAssetId: null,
      storedExampleAssetId: good,
      exampleUnavailable: true,
    })
    expect(await canOpen(b.w.staffA, good)).toBe(false)
    expect(
      (await briefOf(a.w.staffA, "area", a.garden)).exampleAssetId
    ).toBeNull()
    // Saving the words again keeps the stored example (it is not re-checked).
    await setOk(a.w.admin, "spaces", "The space, tidy, in good light.", good)
    await setOk(a.w.admin, "spaces", "The space, tidy, in good light.", null)
  })
})

describe("slot_briefs: one resolver", () => {
  it("falls back to the category's template, with its example", async () => {
    const example = await image(a.w.staffB)
    acceptOnPlace(example, a.w.admin.id)
    await setOk(a.w.admin, "food", "Food template words", example)
    await setOk(a.w.admin, "drinks", "Drinks template words")
    await setOk(a.w.admin, "spaces", "Spaces template words")

    const all = await briefs(a.w.staffA)
    const of = (kind: string, id: string) =>
      all.find((r) => r.kind === kind && r.slotId === id)!
    expect(of("dish", a.pie)).toMatchObject({
      category: "food",
      source: "template",
      brief: "Food template words",
      exampleAssetId: example,
    })
    expect(of("dish", a.ale)).toMatchObject({
      category: "drinks",
      source: "template",
      brief: "Drinks template words",
      exampleAssetId: null,
    })
    expect(of("area", a.garden)).toMatchObject({
      category: "spaces",
      source: "template",
      brief: "Spaces template words",
    })
    // A facility question keeps its catalogue capture brief.
    const amenity = all.find((r) => r.kind === "amenity")!
    expect(amenity.category).toBe("facilities")
    expect(["catalogue", "template"]).toContain(amenity.source)
    // Every slot has a brief from day one.
    expect(all.every((r) => r.brief.length > 0)).toBe(true)
  })

  it("puts the manager's brief before the template, and a template change never rewrites it", async () => {
    await ok(
      call(a.w.manager, "album_brief_set", {
        p_venue_id: null,
        p_source: "menu_section",
        p_key: "mains",
        p_brief: "Mains: on the pass, steam visible",
      }) as never
    )
    await ok(
      call(a.w.manager, "album_brief_set", {
        p_venue_id: null,
        p_source: "menu_item",
        p_key: a.fish,
        p_brief: "Fish: whole, lemon on the side",
      }) as never
    )
    // The example stays the category template's: an example of a good
    // photo, beside whichever words apply.
    expect(await briefOf(a.w.staffA, "dish", a.pie)).toMatchObject({
      source: "manager",
      brief: "Mains: on the pass, steam visible",
      exampleAssetId: (await templateOf(a.w.staffA, "food")).exampleAssetId,
    })
    expect(await briefOf(a.w.staffA, "dish", a.fish)).toMatchObject({
      source: "manager",
      brief: "Fish: whole, lemon on the side",
    })
    await setOk(a.w.admin, "food", "Changed food template")
    expect((await briefOf(a.w.staffA, "dish", a.pie)).brief).toBe(
      "Mains: on the pass, steam visible"
    )
    expect(
      psql(
        `select brief from public.album_briefs
         where venue_id = '${a.w.venue}' and source = 'menu_section' and source_key = 'mains'`
      )
    ).toBe("Mains: on the pass, steam visible")
  })

  it("puts an open request's brief first, with its reference photo, and only while it is open", async () => {
    const reference = await image(a.w.staffA)
    acceptOnPlace(reference, a.w.admin.id)
    const made = (await ok(
      call(a.w.manager, "media_request_create", {
        p_type: "missing_photo",
        p_venue_id: null,
        p_intended_use: "public",
        p_slot_kind: "dish",
        p_slot_id: a.pie,
        p_brief: "Asked: the pie cut open",
        p_reference_asset_id: reference,
      }) as never
    )) as unknown as { id: string; revision: number }
    expect(await briefOf(a.w.staffA, "dish", a.pie)).toMatchObject({
      source: "request",
      brief: "Asked: the pie cut open",
      exampleAssetId: reference,
    })
    // A manager starting another request sees the standing brief.
    expect(
      await briefOf(a.w.manager, "dish", a.pie, undefined, false)
    ).toMatchObject({ source: "manager" })

    await json(a.w.manager, "media_request_close", {
      p_request_id: made.id,
      p_revision: made.revision,
      p_state: "cancelled",
      p_reason: "TEST done",
    })
    expect((await briefOf(a.w.staffA, "dish", a.pie)).source).toBe("manager")
  })
})

describe("slot_briefs: who may read which venue", () => {
  it("reads the caller's own venue; another venue is refused", async () => {
    const own = await json<{ venueId: string }>(a.w.staffA, "slot_briefs", {})
    expect(own.venueId).toBe(a.w.venue)
    await fails(
      call(b.w.manager, "slot_briefs", { p_venue_id: a.w.venue }) as never,
      "wrong_venue"
    )
    await fails(
      call(a.w.staffA, "slot_briefs", { p_venue_id: b.w.venue }) as never,
      "wrong_venue"
    )
    // An admin names the venue; an aal1 admin is not an admin.
    expect(
      (
        await json<{ venueId: string }>(a.w.admin, "slot_briefs", {
          p_venue_id: b.w.venue,
        })
      ).venueId
    ).toBe(b.w.venue)
    await fails(
      call(adminAal1, "slot_briefs", { p_venue_id: a.w.venue }) as never,
      "not_venue_manager"
    )
    await fails(call(inactive, "slot_briefs", {}) as never, "not_active_user")
    const anon = await anonClient().rpc("slot_briefs" as never, {} as never)
    expect(anon.error).not.toBeNull()
    // Venue B's slots never appear in venue A's list.
    const ids = (await briefs(a.w.staffA)).map((r) => r.slotId)
    expect(ids).not.toContain(b.pie)
  })
})
