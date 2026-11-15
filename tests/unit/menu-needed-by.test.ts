// G-7 "needed by" on a dish, server side with mocked caller-scoped clients:
// both item lists map the date (never an overdue state) and page through the
// wider cursor; set and clear validate input and map the database refusals.
import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

const { listOurMenuItems } = await import("@/lib/server/coverage")
const {
  clearMenuItemNeededBy,
  listManagerMenuItems,
  neededByBounds,
  setMenuItemNeededBy,
} = await import("@/lib/server/menu-photos")
import type { MediaActor } from "@/lib/server/media/types"
import type { ManagerPhotoCtx } from "@/lib/server/menu-photos"

const VENUE = "11111111-1111-4111-8111-111111111111"
const USER = "44444444-4444-4444-8444-444444444444"
const KORMA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
const DAL = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
const SECTION = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"

type Rpc = (
  fn: string,
  args: Record<string, unknown>
) => Promise<{ data: unknown; error: unknown }>

const row = (
  itemId: string,
  name: string,
  position: number,
  neededBy: string | null = null,
  passed = false
) => ({
  item_id: itemId,
  section_id: SECTION,
  section_name: "Curries",
  section_kind: "food",
  section_position: 0,
  entry_position: position,
  name,
  description: null,
  variants: [],
  covered: false,
  accepted_count: 0,
  needs_recheck_count: 0,
  primary_photo_id: null,
  primary_asset_id: null,
  primary_has_thumbnail: false,
  primary_has_preview: false,
  primary_width: null,
  primary_height: null,
  item_revision: 1,
  candidate_count: null,
  oldest_candidate_at: null,
  status: "needs_photo",
  has_pending_replacement: false,
  needs_recheck: false,
  own_waiting: 0,
  others_waiting: 0,
  needed_by: neededBy,
  needed_by_passed: passed,
})

/** 51 rows: the first page of 50 has a next cursor. */
const page = () => [
  row(DAL, "Dal", 1, "2026-11-10", true),
  row(KORMA, "Korma", 0, "2026-11-20"),
  ...Array.from({ length: 49 }, (_, i) =>
    row(
      `dddddddd-dddd-4ddd-8ddd-${String(i).padStart(12, "0")}`,
      `Dish ${i}`,
      i + 2
    )
  ),
]

function staffActor(items: () => unknown[]) {
  const rpc = vi.fn<Rpc>(async (fn) => {
    if (fn === "coverage_access_scope")
      return {
        data: [
          {
            user_id: USER,
            active: true,
            is_admin: false,
            role: "staff",
            venue_id: VENUE,
            venue_active: true,
            department: "foh",
            manager_venue_id: null,
          },
        ],
        error: null,
      }
    if (fn === "menu_item_photo_items") return { data: items(), error: null }
    if (fn === "my_menu_waiting_items") return { data: [], error: null }
    throw new Error(`unexpected rpc ${fn}`)
  })
  const actor = {
    profile: { id: USER, active: true, role: "staff" },
    db: { rpc },
    service: {},
    storage: {},
  } as unknown as MediaActor
  return { actor, rpc }
}

function managerCtx(rpc: Rpc): ManagerPhotoCtx {
  return {
    actor: {
      profile: { id: USER, active: true, role: "manager" },
      db: { rpc: vi.fn(rpc) },
    } as unknown as MediaActor,
    venueId: VENUE,
    role: "manager",
  }
}

const callsOf = (ctx: ManagerPhotoCtx) =>
  (ctx.actor.db.rpc as unknown as ReturnType<typeof vi.fn>).mock.calls

afterEach(() => vi.restoreAllMocks())

describe("Our menu items with a needed-by date", () => {
  it("maps the date, words a passed one as passed, and has no overdue state", async () => {
    const { actor } = staffActor(page)
    const out = await listOurMenuItems(actor, { gapsOnly: true })
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(out.items.slice(0, 3).map((i) => [i.name, i.neededBy])).toEqual([
      ["Dal", { date: "2026-11-10", passed: true }],
      ["Korma", { date: "2026-11-20", passed: false }],
      ["Dish 0", null],
    ])
    expect(JSON.stringify(out.items)).not.toMatch(/overdue/i)
  })

  it("pages after a dish with a date by passing that date back", async () => {
    const first = page().slice(0, 2)
    const rest = page().slice(2)
    // The second page starts after Korma (2026-11-20).
    const { actor, rpc } = staffActor(() => [...first, ...rest])
    const one = await listOurMenuItems(actor, {})
    if (!one.ok) throw new Error("first page failed")
    expect(one.nextCursor).toBeTruthy()
    // A cursor whose last row had a date sends p_after_needed_by.
    const dated = Buffer.from(
      JSON.stringify(["2026-11-20", 0, 0, KORMA])
    ).toString("base64url")
    await listOurMenuItems(actor, { cursor: dated })
    const args = rpc.mock.calls.filter(([fn]) => fn === "menu_item_photo_items")
    expect(args[1]![1]).toMatchObject({
      p_after_needed_by: "2026-11-20",
      p_after_section_position: 0,
      p_after_entry_position: 0,
      p_after_item_id: KORMA,
    })
    // A dish without a date (and a cursor from before G-7) sends none.
    const legacy = Buffer.from(JSON.stringify([0, 3, DAL])).toString(
      "base64url"
    )
    await listOurMenuItems(actor, { cursor: legacy })
    const last = rpc.mock.calls.filter(
      ([fn]) => fn === "menu_item_photo_items"
    )[2]![1]
    expect(last).not.toHaveProperty("p_after_needed_by")
    expect(last).toMatchObject({ p_after_item_id: DAL })
  })

  it("refuses a cursor with a date that is not a calendar date", async () => {
    const { actor } = staffActor(page)
    const bad = Buffer.from(
      JSON.stringify(["2026-11-99", 0, 0, KORMA])
    ).toString("base64url")
    const out = await listOurMenuItems(actor, { cursor: bad })
    expect(out).toMatchObject({ ok: false, code: "invalid_input" })
  })
})

describe("Manager Menu items with a needed-by date", () => {
  it("maps the date and puts it in the next cursor", async () => {
    const ctx = managerCtx(async () => ({ data: page(), error: null }))
    const out = await listManagerMenuItems(ctx, {})
    if (!out.ok) throw new Error("list failed")
    expect(out.items[0]!.neededBy).toEqual({
      date: "2026-11-10",
      passed: true,
    })
    expect(out.items[2]!.neededBy).toBeNull()
    await listManagerMenuItems(ctx, { cursor: out.nextCursor })
    const second = callsOf(ctx)[1]![1]
    // The 50th row has no date: no p_after_needed_by.
    expect(second).not.toHaveProperty("p_after_needed_by")
    const dated = await listManagerMenuItems(ctx, {
      cursor: Buffer.from(JSON.stringify(["2026-11-20", 0, 0, KORMA])).toString(
        "base64url"
      ),
    })
    expect(dated.ok).toBe(true)
    expect(callsOf(ctx)[2]![1]).toMatchObject({
      p_after_needed_by: "2026-11-20",
      p_after_item_id: KORMA,
    })
  })
})

describe("setting and clearing needed by", () => {
  it("sends the item, date and the context's venue", async () => {
    const ctx = managerCtx(async () => ({
      data: [{ item_id: DAL, needed_by: "2026-11-20" }],
      error: null,
    }))
    const out = await setMenuItemNeededBy(ctx, {
      itemId: DAL,
      neededBy: "2026-11-20",
      venueId: "ignored",
    })
    expect(out).toEqual({
      ok: true,
      neededBy: { date: "2026-11-20", passed: false },
    })
    expect(callsOf(ctx)[0]).toEqual([
      "set_menu_item_needed_by",
      { p_item_id: DAL, p_needed_by: "2026-11-20", p_venue_id: VENUE },
    ])
  })

  it("refuses bad input before the database", async () => {
    const ctx = managerCtx(async () => {
      throw new Error("no call expected")
    })
    for (const input of [null, {}, { itemId: "x", neededBy: "2026-11-20" }])
      expect(await setMenuItemNeededBy(ctx, input)).toMatchObject({
        ok: false,
        code: "invalid_input",
      })
    for (const neededBy of ["", "20/11/2026", "2026-02-30", 20261120])
      expect(
        await setMenuItemNeededBy(ctx, { itemId: DAL, neededBy })
      ).toMatchObject({
        ok: false,
        code: "invalid_input",
        fieldErrors: { neededBy: expect.any(String) },
      })
    expect(await clearMenuItemNeededBy(ctx, { itemId: 1 })).toMatchObject({
      ok: false,
      code: "invalid_input",
    })
  })

  it.each([
    ["invalid_needed_by", "22023", { code: "invalid_input" }],
    [
      "menu_item_has_photo",
      "55000",
      { code: "state_conflict", needsRefresh: true },
    ],
    ["menu_item_unavailable", "55000", { code: "state_conflict" }],
    ["menu_item_not_found", "P0002", { code: "not_found" }],
    ["not_venue_manager", "42501", { code: "not_permitted" }],
  ])("maps %s", async (message, code, expected) => {
    const ctx = managerCtx(async () => ({
      data: null,
      error: { message, code },
    }))
    expect(
      await setMenuItemNeededBy(ctx, { itemId: DAL, neededBy: "2026-11-20" })
    ).toMatchObject({ ok: false, ...expected })
  })

  it("clears, and clearing twice is not an error", async () => {
    const ctx = managerCtx(async () => ({
      data: [{ item_id: DAL, cleared: false }],
      error: null,
    }))
    expect(await clearMenuItemNeededBy(ctx, { itemId: DAL })).toEqual({
      ok: true,
      cleared: false,
    })
    expect(callsOf(ctx)[0]).toEqual([
      "clear_menu_item_needed_by",
      { p_item_id: DAL, p_venue_id: VENUE },
    ])
  })

  it("bounds the date field to London today and a year ahead", () => {
    // 23:30 UTC on 31 Mar 2026 is already 1 Apr in London (BST).
    expect(neededByBounds(new Date("2026-03-31T23:30:00Z"))).toEqual({
      today: "2026-04-01",
      maxDate: "2027-04-02",
    })
  })
})
