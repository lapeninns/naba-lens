// Full App v1, S2-REQ: requests and shot lists (spec §7 M4, §2; FA-5; AC01,
// AC24, AC39). Migration 20261118114000_media_requests.sql. Real signed-in
// identities through PostgREST; the service role and psql only build
// fixtures and read back.
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
  decide,
  json,
  londonToday,
  service,
  slotRevision,
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

type RequestView = {
  id: string
  type: string
  required: boolean
  slot: { kind: string; slotId: string; name: string; state: string } | null
  fact: { checkId: string; verification: string | null } | null
  subject: string
  brief: string
  intendedUse: string
  team: string
  photoCount: number
  priority: string
  assignee: { id: string; name: string } | null
  date: string | null
  dateKind: "needed_by" | "due" | null
  overdue: boolean
  state: "open" | "submitted" | "completed" | "blocked" | "cancelled"
  blockedReason: string | null
  closedReason: string | null
  closedByRule: boolean
  shotListId: string | null
  revision: number
}
type ListView = {
  venueId: string
  items: RequestView[]
  shotLists: Array<{
    id: string
    state: string
    total: number
    completed: number
    revision: number
  }>
  people: Array<{ id: string; role: string }>
}
type StaffView = {
  venueId: string
  items: Array<{
    id: string
    type: string
    slot: { kind: string; slotId: string } | null
    brief: string
    forMe: boolean
    state: string
  }>
}

type V = {
  w: World
  version: string
  items: Record<string, CatalogueRow>
  bar: string
}

const MENU = () =>
  menu("TEST requests", [
    section("mains", "Mains", [
      item("mains--pie", "Pie"),
      item("mains--fish", "Fish"),
      item("mains--stew", "Stew"),
    ]),
    section("drinks", "Drinks", [item("drinks--ale", "Ale")], "drinks"),
  ])

async function venue(label: string): Promise<V> {
  const w = await world(label)
  const version = await publishMenu(w.admin, w.venue, MENU())
  const items = (await readDocument(service, version)).byKey
  const bar = psql(
    `insert into public.knowledge_subjects (venue_id, kind, label, created_by)
     values ('${w.venue}', 'area', 'Bar', '${w.admin.id}') returning id`
  )
  return { w, version, items, bar }
}

async function errorOf(p: PromiseLike<{ error: { message: string } | null }>) {
  const { error } = await p
  return error?.message ?? null
}

const dayPlus = (n: number) => {
  const d = new Date(`${londonToday()}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

const create = (who: TestIdentity, args: Record<string, unknown>) =>
  call(who, "media_request_create", {
    p_venue_id: null,
    p_intended_use: "public",
    ...args,
  })

const createOk = async (who: TestIdentity, args: Record<string, unknown>) =>
  (await ok(
    create(who, args) as PromiseLike<{
      data: { id: string; revision: number } | null
      error: { code: string; message: string } | null
    }>
  ))!

const list = (who: TestIdentity, venue?: string, closed = true) =>
  json<ListView>(who, "media_requests", {
    ...(venue ? { p_venue_id: venue } : {}),
    p_include_closed: closed,
  })

const find = async (who: TestIdentity, id: string, venue?: string) =>
  (await list(who, venue)).items.find((r) => r.id === id)!

const head = (itemId: string) =>
  Number(
    psql(
      `select coalesce((select revision from public.menu_item_photo_heads where item_id = '${itemId}'), 1)`
    )
  )

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

const setLevel = (
  who: TestIdentity,
  asset: string,
  itemId: string,
  level: string
) =>
  call(who, "set_menu_item_photo_level", {
    p_asset_id: asset,
    p_item_id: itemId,
    p_variant_id: null,
    p_level: level,
    p_expected_revision: head(itemId),
  })

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

const notices = (recipient: string, request: string) =>
  psql(
    `select coalesce(string_agg(case when resolved_at is null then 'open' else 'resolved' end, ',' order by id), '')
     from public.notifications
     where recipient_id = '${recipient}' and kind = 'assigned'
       and subject_type = 'media_request' and subject_id = '${request}'`
  )

const coverageTotals = async (who: TestIdentity) =>
  (await json<{ totals: Record<string, number> }>(who, "coverage_slots", {}))
    .totals

let v: V
let other: V
let inactive: TestIdentity

beforeAll(async () => {
  await knowledgeAdmin()
  ;[v, other] = await Promise.all([venue("req-a"), venue("req-b")])
  inactive = await createIdentity(service, {
    label: "req-inactive",
    role: "manager",
    venueId: v.w.venue,
  })
  await ok(
    service.from("profiles").update({ active: false }).eq("id", inactive.id)
  )
})

// ---------------------------------------------------------------------------

describe("who may create and read requests (S3.3-create-tasks)", () => {
  it("lets the venue's manager create one, and an admin naming the venue", async () => {
    const pie = v.items["mains--pie"]!.itemId
    const made = await createOk(v.w.manager, {
      p_type: "missing_photo",
      p_slot_kind: "dish",
      p_slot_id: pie,
      p_brief: "Whole pie, steam visible",
    })
    const r = await find(v.w.manager, made.id)
    expect(r).toMatchObject({
      type: "missing_photo",
      required: true,
      subject: "Pie",
      brief: "Whole pie, steam visible",
      intendedUse: "public",
      // M4 defaults: kitchen for food, one photograph, normal priority.
      team: "boh",
      photoCount: 1,
      priority: "normal",
      state: "open",
    })
    const byAdmin = await createOk(v.w.admin, {
      p_venue_id: v.w.venue,
      p_type: "optional_angle",
      p_slot_kind: "dish",
      p_slot_id: pie,
      p_brief: "Overhead",
    })
    expect((await find(v.w.admin, byAdmin.id, v.w.venue)).required).toBe(false)
  })

  it("refuses staff, another venue's manager, an admin without a venue, the inactive and anon", async () => {
    const args = {
      p_type: "campaign",
      p_subject: "Christmas tree",
      p_brief: "The tree by the fire",
    }
    expect(await errorOf(create(v.w.staffA, args))).toBe("not_venue_manager")
    expect(
      await errorOf(create(other.w.manager, { ...args, p_venue_id: v.w.venue }))
    ).toBe("not_venue_manager")
    expect(await errorOf(create(v.w.admin, args))).toBe("venue_required")
    expect(await errorOf(create(inactive, args))).toBe("not_active_user")
    const anon = await anonClient().rpc(
      "media_request_create" as never,
      { p_venue_id: v.w.venue, ...args, p_intended_use: "public" } as never
    )
    expect(anon.error).not.toBeNull()

    expect(await errorOf(call(v.w.staffA, "media_requests", {}))).toBe(
      "not_venue_manager"
    )
    expect(
      await errorOf(
        call(other.w.manager, "media_requests", { p_venue_id: v.w.venue })
      )
    ).toBe("not_venue_manager")
    expect(await errorOf(call(inactive, "media_requests", {}))).toBe(
      "not_active_user"
    )
    expect(
      (await anonClient().rpc("media_requests" as never, {} as never)).error
    ).not.toBeNull()
  })

  it("never lists another venue's requests", async () => {
    const mine = await list(v.w.manager)
    const theirs = await list(other.w.manager)
    const ids = new Set(mine.items.map((r) => r.id))
    expect(theirs.items.some((r) => ids.has(r.id))).toBe(false)
    expect(theirs.venueId).toBe(other.w.venue)
  })

  it("denies direct table access", async () => {
    for (const table of [
      "media_requests",
      "shot_lists",
      "media_request_events",
    ]) {
      const { data } = await v.w.manager.client.from(table as never).select("*")
      expect(data ?? []).toEqual([])
    }
  })
})

describe("required fields and slots (M4-required-fields, M4-new-brief)", () => {
  it("requires the brief, the intended use and, for a New brief, the subject", async () => {
    const fish = v.items["mains--fish"]!.itemId
    const slot = { p_slot_kind: "dish", p_slot_id: fish }
    expect(
      await errorOf(create(v.w.manager, { p_type: "missing_photo", ...slot }))
    ).toBe("brief_required")
    expect(
      await errorOf(
        create(v.w.manager, {
          p_type: "missing_photo",
          ...slot,
          p_brief: "Plated",
          p_intended_use: null,
        })
      )
    ).toBe("intended_use_required")
    expect(
      await errorOf(
        create(v.w.manager, { p_type: "campaign", p_brief: "Anything" })
      )
    ).toBe("subject_required")
    expect(
      await errorOf(
        create(v.w.manager, {
          p_type: "missing_photo",
          ...slot,
          p_brief: "two\nlines",
        })
      )
    ).toBe("invalid_brief")
  })

  it("refuses a slot of another venue and a replacement without a slot", async () => {
    expect(
      await errorOf(
        create(v.w.manager, {
          p_type: "missing_photo",
          p_slot_kind: "dish",
          p_slot_id: other.items["mains--pie"]!.itemId,
          p_brief: "Plated",
        })
      )
    ).toBe("unknown_slot")
    expect(
      await errorOf(
        create(v.w.manager, {
          p_type: "replacement",
          p_subject: "Beer garden",
          p_brief: "New benches",
        })
      )
    ).toBe("invalid_slot")
  })

  it("creates a New brief with no slot, a real due date and every optional field", async () => {
    const made = await createOk(v.w.manager, {
      p_type: "missing_photo",
      p_subject: "New fire pit",
      p_brief: "Lit, after dark",
      p_intended_use: "social",
      p_team: "foh",
      p_photo_count: 3,
      p_priority: "high",
      p_assignee_id: v.w.staffA.id,
      p_due_on: dayPlus(5),
      p_orientation: "portrait",
      p_wants_video: true,
      p_capture_window: "After 8pm",
    })
    const r = await find(v.w.manager, made.id)
    expect(r).toMatchObject({
      slot: null,
      subject: "New fire pit",
      intendedUse: "social",
      photoCount: 3,
      priority: "high",
      assignee: { id: v.w.staffA.id },
      date: dayPlus(5),
      dateKind: "due",
      overdue: false,
      state: "open",
    })
    // An assignee must belong to the venue; dates are not in the past.
    expect(
      await errorOf(
        create(v.w.manager, {
          p_type: "campaign",
          p_subject: "Quiz night",
          p_brief: "Teams at the tables",
          p_assignee_id: other.w.staffA.id,
        })
      )
    ).toBe("invalid_assignee")
    expect(
      await errorOf(
        create(v.w.manager, {
          p_type: "campaign",
          p_subject: "Quiz night",
          p_brief: "Teams at the tables",
          p_due_on: dayPlus(-1),
        })
      )
    ).toBe("invalid_date")
  })

  it("reads a slot request's date as needed by, never overdue (FA-5)", async () => {
    const stew = v.items["mains--stew"]!.itemId
    const made = await createOk(v.w.manager, {
      p_type: "missing_photo",
      p_slot_kind: "dish",
      p_slot_id: stew,
      p_brief: "In the bowl",
      p_due_on: londonToday(),
    })
    psql(
      `update public.media_requests set due_on = current_date - 3 where id = '${made.id}'`
    )
    const r = await find(v.w.manager, made.id)
    expect(r).toMatchObject({ dateKind: "needed_by", overdue: false })
    // One open required request per slot.
    expect(
      await errorOf(
        create(v.w.manager, {
          p_type: "missing_photo",
          p_slot_kind: "dish",
          p_slot_id: stew,
          p_brief: "Again",
        })
      )
    ).toBe("request_exists")
  })
})

describe("states and completion (M4-states)", () => {
  it("goes Open, Submitted, then Completed only on a public acceptance", async () => {
    const ale = v.items["drinks--ale"]!.itemId
    const made = await createOk(v.w.manager, {
      p_type: "missing_photo",
      p_slot_kind: "dish",
      p_slot_id: ale,
      p_brief: "Pint on the bar",
    })
    expect((await find(v.w.manager, made.id)).team).toBe("foh")
    const asset = await dishPhoto(v, v.w.staffA, ale)
    expect((await find(v.w.manager, made.id)).state).toBe("submitted")

    // Keep as reference leaves it open (inv. 4).
    expect(
      (await setLevel(v.w.manager, asset, ale, "reference")).error
    ).toBeNull()
    expect((await find(v.w.manager, made.id)).state).toBe("open")

    expect((await setLevel(v.w.manager, asset, ale, "public")).error).toBeNull()
    const done = await find(v.w.manager, made.id)
    expect(done).toMatchObject({ state: "completed", closedByRule: true })
    // Once covered, a new Missing photo request is refused.
    expect(
      await errorOf(
        create(v.w.manager, {
          p_type: "missing_photo",
          p_slot_kind: "dish",
          p_slot_id: ale,
          p_brief: "Again",
        })
      )
    ).toBe("slot_already_covered")

    // A replacement completes only on a public photo accepted after it.
    const repl = await createOk(v.w.manager, {
      p_type: "replacement",
      p_slot_kind: "dish",
      p_slot_id: ale,
      p_brief: "New glass",
    })
    expect((await find(v.w.manager, repl.id)).state).toBe("open")
    const second = await dishPhoto(v, v.w.staffB, ale)
    expect(
      (await setLevel(v.w.manager, second, ale, "public")).error
    ).toBeNull()
    expect((await find(v.w.manager, repl.id)).state).toBe("completed")
  })

  it("keeps a two-photo optional angle open until two distinct approvals", async () => {
    const made = await createOk(v.w.manager, {
      p_type: "optional_angle",
      p_slot_kind: "area",
      p_slot_id: v.bar,
      p_brief: "From the door",
      p_photo_count: 2,
    })
    const p = await areaPhoto(v.w.staffA, v.bar)
    expect((await find(v.w.manager, made.id)).state).toBe("submitted")
    expect(
      (
        await call(v.w.manager, "decide_area_photo_level", {
          p_label_id: p.label,
          p_action: "accepted",
          p_level: "reference",
        })
      ).error
    ).toBeNull()
    expect((await find(v.w.manager, made.id)).state).toBe("open")
    await ok(
      call(v.w.manager, "decide_area_photo_level", {
        p_label_id: p.label,
        p_action: "accepted",
        p_level: "public",
      })
    )
    expect((await find(v.w.manager, made.id)).state).toBe("open")
    const second = await areaPhoto(v.w.staffB, v.bar)
    await ok(
      call(v.w.manager, "decide_area_photo_level", {
        p_label_id: second.label,
        p_action: "accepted",
        p_level: "reference",
      })
    )
    expect((await find(v.w.manager, made.id)).state).toBe("completed")
  })

  it("does not count an approval from before a multi-photo campaign request", async () => {
    const campaign = await venue("request-campaign-count")
    const fish = campaign.items["mains--fish"]!.itemId
    const { manager, staffA, staffB } = campaign.w
    const earlier = await dishPhoto(campaign, staffA, fish)
    await ok(setLevel(manager, earlier, fish, "public"))
    const made = await createOk(manager, {
      p_type: "campaign",
      p_slot_kind: "dish",
      p_slot_id: fish,
      p_brief: "Two angles for the campaign",
      p_photo_count: 2,
    })

    const first = await dishPhoto(campaign, staffA, fish)
    await ok(setLevel(manager, first, fish, "public"))
    expect((await find(manager, made.id)).state).toBe("open")
    const second = await dishPhoto(campaign, staffB, fish)
    await ok(setLevel(manager, second, fish, "reference"))
    expect((await find(manager, made.id)).state).toBe("completed")
  })

  it.each(["missing_photo", "replacement"] as const)(
    "requires two public approvals for a two-photo %s request",
    async (type) => {
      const { manager, staffA, staffB, admin } = v.w
      const subject = psql(
        `insert into public.knowledge_subjects (venue_id, kind, label, created_by)
         values ('${v.w.venue}', 'area', 'TEST ${type}', '${admin.id}') returning id`
      )
      const approve = (label: string, level: "public" | "reference") =>
        ok(
          call(manager, "decide_area_photo_level", {
            p_label_id: label,
            p_action: "accepted",
            p_level: level,
          })
        )

      if (type === "replacement") {
        const earlier = await areaPhoto(staffA, subject)
        await approve(earlier.label, "public")
      }
      const made = await createOk(manager, {
        p_type: type,
        p_slot_kind: "area",
        p_slot_id: subject,
        p_brief: "Two photos for the album",
        p_photo_count: 2,
      })
      const first = await areaPhoto(staffA, subject)
      await approve(first.label, "public")
      expect((await find(manager, made.id)).state).toBe("open")
      const second = await areaPhoto(staffB, subject)
      await approve(second.label, "reference")
      expect((await find(manager, made.id)).state).toBe("open")
      await approve(second.label, "public")
      expect((await find(manager, made.id)).state).toBe("completed")
    }
  )

  it("blocks with a reason, refuses a stale write, and unblocks", async () => {
    const made = await createOk(v.w.manager, {
      p_type: "campaign",
      p_subject: "Sunday roast table",
      p_brief: "Full table, from above",
    })
    const blocked = await json<{ revision: number }>(
      v.w.manager,
      "media_request_set_blocked",
      {
        p_request_id: made.id,
        p_revision: made.revision,
        p_reason: "Roast is off this week",
      }
    )
    expect(await find(v.w.manager, made.id)).toMatchObject({
      state: "blocked",
      blockedReason: "Roast is off this week",
    })
    expect(
      await errorOf(
        call(v.w.manager, "media_request_set_blocked", {
          p_request_id: made.id,
          p_revision: made.revision,
          p_reason: null,
        })
      )
    ).toBe("request_conflict")
    await json(v.w.manager, "media_request_set_blocked", {
      p_request_id: made.id,
      p_revision: blocked.revision,
      p_reason: null,
    })
    expect((await find(v.w.manager, made.id)).state).toBe("open")
    expect(
      await errorOf(
        call(v.w.staffA, "media_request_set_blocked", {
          p_request_id: made.id,
          p_revision: blocked.revision + 1,
          p_reason: "No",
        })
      )
    ).toBe("request_not_found")
  })

  it("cancels only with a reason, completes by hand only without a slot, and freezes once closed", async () => {
    const free = await createOk(v.w.manager, {
      p_type: "campaign",
      p_subject: "Staff party",
      p_brief: "Group photo",
    })
    expect(
      await errorOf(
        call(v.w.manager, "media_request_close", {
          p_request_id: free.id,
          p_revision: free.revision,
          p_state: "cancelled",
        })
      )
    ).toBe("reason_required")
    await json(v.w.manager, "media_request_close", {
      p_request_id: free.id,
      p_revision: free.revision,
      p_state: "completed",
    })
    expect((await find(v.w.manager, free.id)).state).toBe("completed")
    expect(
      await errorOf(
        call(v.w.manager, "media_request_edit", {
          p_request_id: free.id,
          p_revision: free.revision + 1,
          p_patch: { brief: "Changed" },
        })
      )
    ).toBe("request_closed")

    const fish = v.items["mains--fish"]!.itemId
    const slot = await createOk(v.w.manager, {
      p_type: "missing_photo",
      p_slot_kind: "dish",
      p_slot_id: fish,
      p_brief: "On the plate",
    })
    expect(
      await errorOf(
        call(v.w.manager, "media_request_close", {
          p_request_id: slot.id,
          p_revision: slot.revision,
          p_state: "completed",
        })
      )
    ).toBe("completes_automatically")
    await json(v.w.manager, "media_request_close", {
      p_request_id: slot.id,
      p_revision: slot.revision,
      p_state: "cancelled",
      p_reason: "Off the menu next week",
    })
    expect(await find(v.w.manager, slot.id)).toMatchObject({
      state: "cancelled",
      closedReason: "Off the menu next week",
      closedByRule: false,
    })
    const detail = await json<{ history: Array<{ kind: string }> }>(
      v.w.manager,
      "media_request_detail",
      { p_request_id: slot.id }
    )
    expect(detail.history.map((h) => h.kind)).toEqual(["created", "cancelled"])
    expect(
      await errorOf(
        call(other.w.manager, "media_request_detail", { p_request_id: slot.id })
      )
    ).toBe("request_not_found")
    // History is append-only.
    expect(() =>
      psql(
        `update public.media_request_events set reason = 'x' where request_id = '${slot.id}'`
      )
    ).toThrow()
  })
})

describe("coverage stays the slots' own (M4-optional-vs-required, AC39)", () => {
  it("adds nothing to the totals for required or optional requests", async () => {
    const before = await coverageTotals(other.w.manager)
    const pie = other.items["mains--pie"]!.itemId
    await createOk(other.w.manager, {
      p_type: "missing_photo",
      p_slot_kind: "dish",
      p_slot_id: pie,
      p_brief: "Whole pie",
    })
    await createOk(other.w.manager, {
      p_type: "optional_angle",
      p_slot_kind: "dish",
      p_slot_id: pie,
      p_brief: "Cut open",
    })
    await createOk(other.w.manager, {
      p_type: "campaign",
      p_subject: "Pie week",
      p_brief: "Every pie on one board",
    })
    expect(await coverageTotals(other.w.manager)).toEqual(before)
  })
})

describe("a named person is told (S1-OPS notify)", () => {
  it("sends an assigned notice, a new one on a change, and resolves it on close", async () => {
    const made = await createOk(v.w.manager, {
      p_type: "campaign",
      p_subject: "Fireworks night",
      p_brief: "The garden at 7",
      p_assignee_id: v.w.staffA.id,
    })
    expect(notices(v.w.staffA.id, made.id)).toBe("open")
    const edited = await json<{ revision: number; changed: boolean }>(
      v.w.manager,
      "media_request_edit",
      {
        p_request_id: made.id,
        p_revision: made.revision,
        p_patch: { assigneeId: v.w.staffB.id, priority: "high" },
      }
    )
    expect(edited.changed).toBe(true)
    expect(notices(v.w.staffA.id, made.id)).toBe("resolved")
    expect(notices(v.w.staffB.id, made.id)).toBe("open")
    await json(v.w.manager, "media_request_close", {
      p_request_id: made.id,
      p_revision: edited.revision,
      p_state: "cancelled",
      p_reason: "Rained off",
    })
    expect(notices(v.w.staffB.id, made.id)).toBe("resolved")
    // The manager naming themselves gets no notice.
    const self = await createOk(v.w.manager, {
      p_type: "campaign",
      p_subject: "Menu boards",
      p_brief: "Both boards",
      p_assignee_id: v.w.manager.id,
    })
    expect(notices(v.w.manager.id, self.id)).toBe("")
  })
})

describe("fact confirmation (M4-fact-confirmation-task, AC24)", () => {
  it("is assigned to a manager or admin and completes only through a confirmed fact", async () => {
    const wifi = v.w.checks.guest_wifi!
    expect(
      await errorOf(
        create(v.w.manager, {
          p_type: "fact_confirmation",
          p_fact_check_id: wifi,
          p_assignee_id: v.w.staffA.id,
        })
      )
    ).toBe("assignee_cannot_verify")
    expect(
      await errorOf(
        create(v.w.manager, {
          p_type: "fact_confirmation",
          p_fact_check_id: other.w.checks.guest_wifi!,
        })
      )
    ).toBe("unknown_fact")
    const made = await createOk(v.w.manager, {
      p_type: "fact_confirmation",
      p_fact_check_id: wifi,
      p_brief: null,
      p_intended_use: null,
    })
    let r = await find(v.w.manager, made.id)
    expect(r).toMatchObject({
      type: "fact_confirmation",
      assignee: { id: v.w.manager.id },
      intendedUse: "internal",
      state: "open",
    })
    // A staff finding is evidence: Submitted, not Completed (AC25).
    const sent = await yes(v.w.staffA, v.w, "guest_wifi")
    expect(sent.outcome).toBe("awaiting_confirmation")
    r = await find(v.w.manager, made.id)
    expect(r.state).toBe("submitted")
    // Staff never see a fact request.
    const staffView = await json<StaffView>(v.w.staffA, "my_media_requests", {})
    expect(staffView.items.some((i) => i.id === made.id)).toBe(false)

    expect(
      (
        await decide(
          v.w.manager,
          v.w,
          "guest_wifi",
          { type: "contribution", id: sent.contributionId },
          "confirm"
        )
      ).error
    ).toBeNull()
    r = await find(v.w.manager, made.id)
    expect(r).toMatchObject({ state: "completed", closedByRule: true })

    // A reconfirmation ("Still right") also completes one.
    const again = await createOk(v.w.manager, {
      p_type: "fact_confirmation",
      p_fact_check_id: wifi,
    })
    expect((await find(v.w.manager, again.id)).state).toBe("open")
    await json(v.w.manager, "knowledge_reconfirm", {
      p_check_id: wifi,
      p_slot_revision: slotRevision(v.w.venue, "guest_wifi"),
    })
    expect((await find(v.w.manager, again.id)).state).toBe("completed")
  })

  it("leaves no impossible photo request after a confirmed No (AC24)", async () => {
    const toilets = v.w.checks.guest_toilets!
    const made = await createOk(v.w.manager, {
      p_type: "missing_photo",
      p_slot_kind: "amenity",
      p_slot_id: toilets,
      p_brief: "Signage to the toilets",
    })
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
    expect(await find(v.w.manager, made.id)).toMatchObject({
      state: "cancelled",
      closedReason: "No longer needed",
      closedByRule: true,
    })
    expect(
      await errorOf(
        create(v.w.manager, {
          p_type: "missing_photo",
          p_slot_kind: "amenity",
          p_slot_id: toilets,
          p_brief: "Again",
        })
      )
    ).toBe("slot_not_needed")
  })
})

describe("staff see requests as slots with the brief (AC01)", () => {
  it("lists open media requests at their venue, theirs first", async () => {
    const pie = other.items["mains--pie"]!.itemId
    const forB = await createOk(other.w.manager, {
      p_type: "campaign",
      p_slot_kind: "dish",
      p_slot_id: other.items["mains--fish"]!.itemId,
      p_brief: "Fish on the pass",
      p_assignee_id: other.w.staffB.id,
    })
    const view = await json<StaffView>(other.w.staffB, "my_media_requests", {})
    expect(view.venueId).toBe(other.w.venue)
    expect(view.items[0]).toMatchObject({ id: forB.id, forMe: true })
    const onPie = view.items.find(
      (i) => i.slot?.slotId === pie && i.type === "missing_photo"
    )
    expect(onPie).toMatchObject({ brief: "Whole pie", forMe: false })
    // A colleague sees the same list, with nothing marked for them.
    const a = await json<StaffView>(other.w.staffA, "my_media_requests", {})
    expect(a.items.find((i) => i.id === forB.id)?.forMe).toBe(false)
  })

  it("refuses another venue, the inactive and anon", async () => {
    expect(
      await errorOf(
        call(v.w.staffA, "my_media_requests", { p_venue_id: other.w.venue })
      )
    ).toBe("wrong_venue")
    expect(
      await errorOf(call(inactive, "my_media_requests", {}))
    ).not.toBeNull()
    expect(
      (await anonClient().rpc("my_media_requests" as never, {} as never)).error
    ).not.toBeNull()
    // An admin names the venue.
    const view = await json<StaffView>(v.w.admin, "my_media_requests", {
      p_venue_id: v.w.venue,
    })
    expect(view.venueId).toBe(v.w.venue)
  })
})

describe("shot lists (M4-shot-lists)", () => {
  it("groups requests, counts them, and cancels them with the list", async () => {
    expect(
      await errorOf(
        call(v.w.staffA, "shot_list_create", {
          p_venue_id: null,
          p_name: "Spring launch",
          p_purpose: "menu_launch",
        })
      )
    ).toBe("not_venue_manager")
    expect(
      await errorOf(
        call(v.w.manager, "shot_list_create", {
          p_venue_id: null,
          p_name: "Spring launch",
          p_purpose: "launch",
        })
      )
    ).toBe("invalid_purpose")
    const listMade = await json<{ id: string; revision: number }>(
      v.w.manager,
      "shot_list_create",
      {
        p_venue_id: null,
        p_name: "Spring launch",
        p_purpose: "menu_launch",
        p_due_on: dayPlus(10),
      }
    )
    const a = await createOk(v.w.manager, {
      p_type: "campaign",
      p_subject: "Spring board",
      p_brief: "The chalkboard",
      p_shot_list_id: listMade.id,
    })
    const b = await createOk(v.w.manager, {
      p_type: "campaign",
      p_subject: "Spring cocktails",
      p_brief: "Three glasses",
    })
    await json(v.w.manager, "media_request_edit", {
      p_request_id: b.id,
      p_revision: b.revision,
      p_patch: { shotListId: listMade.id },
    })
    let read = (await list(v.w.manager)).shotLists.find(
      (l) => l.id === listMade.id
    )!
    expect(read).toMatchObject({ state: "open", total: 2, completed: 0 })
    // Another venue's list cannot be used.
    expect(
      await errorOf(
        create(other.w.manager, {
          p_type: "campaign",
          p_subject: "X",
          p_brief: "Y",
          p_shot_list_id: listMade.id,
        })
      )
    ).toBe("invalid_shot_list")
    expect(
      await errorOf(
        call(other.w.manager, "shot_list_cancel", {
          p_shot_list_id: listMade.id,
          p_revision: listMade.revision,
          p_reason: "No",
        })
      )
    ).toBe("shot_list_not_found")

    const cancelled = await json<{ requestsCancelled: number }>(
      v.w.manager,
      "shot_list_cancel",
      {
        p_shot_list_id: listMade.id,
        p_revision: listMade.revision,
        p_reason: "Launch moved to May",
      }
    )
    expect(cancelled.requestsCancelled).toBe(2)
    read = (await list(v.w.manager)).shotLists.find(
      (l) => l.id === listMade.id
    )!
    expect(read.state).toBe("cancelled")
    expect((await find(v.w.manager, a.id)).closedReason).toBe(
      "Launch moved to May"
    )
  })
})

describe("people a request may name", () => {
  it("lists the venue's active staff and managers only", async () => {
    const read = await list(v.w.manager)
    const ids = new Set(read.people.map((p) => p.id))
    expect(ids.has(v.w.staffA.id)).toBe(true)
    expect(ids.has(v.w.manager.id)).toBe(true)
    expect(ids.has(other.w.staffA.id)).toBe(false)
    expect(ids.has(inactive.id)).toBe(false)
  })
})
