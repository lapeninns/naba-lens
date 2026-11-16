// listOurMenuItems with a mocked caller-scoped client: myWaiting comes from
// my_menu_waiting_items, and a failure of that read (the function missing
// before its migration, or a transient error) never takes the list down.
import { afterEach, describe, expect, it, vi } from "vitest"

import { listOurMenuItems } from "@/lib/server/coverage"
import type { MediaActor } from "@/lib/server/media/types"

const VENUE = "11111111-1111-4111-8111-111111111111"
const USER = "44444444-4444-4444-8444-444444444444"
const KORMA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
const DAL = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
const SECTION = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"

type Waiting = () => {
  data?: unknown
  error?: { message?: string; code?: string; details?: string | null }
}

const itemRow = (itemId: string, name: string, position: number) => ({
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
})

function staffWith(
  waiting: Waiting,
  states: Waiting = () => ({ data: [] }),
  rows = [itemRow(KORMA, "Korma", 0), itemRow(DAL, "Dal", 1)]
) {
  const rpc = vi.fn(async (fn: string, ...args: [object?]) => {
    void args
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
    if (fn === "menu_item_photo_items") return { data: rows, error: null }
    if (fn === "menu_item_review_states") {
      const out = states()
      return { data: out.data ?? null, error: out.error ?? null }
    }
    if (fn === "my_menu_waiting_items") {
      const out = waiting()
      return { data: out.data ?? null, error: out.error ?? null }
    }
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

const silence = () => vi.spyOn(console, "error").mockImplementation(() => {})

afterEach(() => vi.restoreAllMocks())

describe("Our menu: myWaiting", () => {
  it("sets the caller's own waiting count on every item, 0 when none", async () => {
    const { actor, rpc } = staffWith(() => ({
      data: [{ item_id: KORMA, waiting: 2 }],
    }))
    const out = await listOurMenuItems(actor, {})
    expect(out).toMatchObject({ ok: true })
    if (!out.ok) return
    expect(out.items.map((i) => [i.name, i.myWaiting])).toEqual([
      ["Korma", 2],
      ["Dal", 0],
    ])
    expect(
      rpc.mock.calls.find(([fn]) => fn === "my_menu_waiting_items")?.[1]
    ).toEqual({ p_venue_id: VENUE, p_item_ids: [KORMA, DAL] })
  })

  it.each([
    [
      "the function is missing (before its migration)",
      {
        code: "PGRST202",
        message:
          "Could not find the function public.my_menu_waiting_items(p_item_ids, p_venue_id) in the schema cache",
      },
    ],
    [
      "a transient error",
      {
        code: "57014",
        message: "canceling statement due to statement timeout",
      },
    ],
  ])("still returns the list without myWaiting when %s", async (_, error) => {
    const log = silence()
    const { actor } = staffWith(() => ({ error }))
    const out = await listOurMenuItems(actor, {})
    expect(out).toMatchObject({ ok: true, nextCursor: null })
    if (!out.ok) return
    expect(out.items.map((i) => i.name)).toEqual(["Korma", "Dal"])
    for (const item of out.items) expect(item).not.toHaveProperty("myWaiting")
    expect(log).toHaveBeenCalledTimes(1)
  })
})

describe("Our menu: review state per dish (decision 11)", () => {
  it("marks a still-needed dish Waiting for review or Being checked", async () => {
    const recheck = {
      ...itemRow(DAL, "Dal", 1),
      needs_recheck_count: 1,
    }
    const covered = {
      ...itemRow(SECTION, "Naan", 2),
      covered: true,
      accepted_count: 1,
    }
    const { actor, rpc } = staffWith(
      () => ({ data: [] }),
      () => ({
        data: [
          { item_id: KORMA, waiting: true, rechecking: false },
          { item_id: SECTION, waiting: true, rechecking: false },
        ],
      }),
      [itemRow(KORMA, "Korma", 0), recheck, covered]
    )
    const out = await listOurMenuItems(actor, {})
    expect(out).toMatchObject({ ok: true })
    if (!out.ok) return
    expect(out.items.map((i) => [i.name, i.reviewState])).toEqual([
      ["Korma", "waiting"],
      ["Dal", "being_checked"],
      // A dish with an accepted photo is not still needed.
      ["Naan", null],
    ])
    expect(
      rpc.mock.calls.find(([fn]) => fn === "menu_item_review_states")?.[1]
    ).toEqual({ p_venue_id: VENUE, p_item_ids: [KORMA, DAL, SECTION] })
  })

  it("still returns the list without reviewState when that read fails", async () => {
    const log = silence()
    const { actor } = staffWith(
      () => ({ data: [] }),
      () => ({ error: { code: "PGRST202", message: "missing" } })
    )
    const out = await listOurMenuItems(actor, {})
    expect(out).toMatchObject({ ok: true })
    if (!out.ok) return
    for (const item of out.items) expect(item).not.toHaveProperty("reviewState")
    expect(out.items.map((i) => i.myWaiting)).toEqual([0, 0])
    expect(log).toHaveBeenCalledTimes(1)
  })
})

describe("Our menu: limit", () => {
  it("reads one more row than the limit and pages after it", async () => {
    const { actor, rpc } = staffWith(() => ({ data: [] }))
    const out = await listOurMenuItems(actor, { limit: 1 })
    expect(out).toMatchObject({ ok: true })
    if (!out.ok) return
    expect(out.items.map((i) => i.name)).toEqual(["Korma"])
    expect(out.nextCursor).not.toBeNull()
    expect(
      rpc.mock.calls.find(([fn]) => fn === "menu_item_photo_items")?.[1]
    ).toMatchObject({ p_limit: 2 })
  })

  it("defaults to a page of 50", async () => {
    const { actor, rpc } = staffWith(() => ({ data: [] }))
    await listOurMenuItems(actor, {})
    expect(
      rpc.mock.calls.find(([fn]) => fn === "menu_item_photo_items")?.[1]
    ).toMatchObject({ p_limit: 51 })
  })

  it.each([0, 51, 1.5, "4", -1])(
    "refuses %s before any read",
    async (limit) => {
      const { actor, rpc } = staffWith(() => ({ data: [] }))
      const out = await listOurMenuItems(actor, { limit })
      expect(out).toMatchObject({ ok: false, code: "invalid_input" })
      expect(rpc).not.toHaveBeenCalled()
    }
  )
})
