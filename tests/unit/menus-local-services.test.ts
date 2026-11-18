// S1-MENUS server layer (lib/server/menus/local.ts, index.ts, errors.ts):
// inputs are validated before any database call, results are read into
// typed shapes, database codes become plain messages, and CSV identity
// columns are checked against the chosen venue and its current items.
import { describe, expect, it, vi } from "vitest"

import { menuRpcFailure } from "@/lib/server/menus/errors"
import { csvVenueIssues, pinItemIds } from "@/lib/server/menus"
import {
  createChangeRequest,
  createSpecial,
  getOfferingStates,
  listVenueMenuVersions,
  setItemAvailability,
  setItemDisplayName,
  setVenueScope,
} from "@/lib/server/menus/local"
import type { MediaActor } from "@/lib/server/media/types"
import type { MenuDocument } from "@/lib/menus/types"

const ITEM = "00000000-0000-4000-8000-0000000000a1"
const VENUE = "00000000-0000-4000-8000-0000000000b1"

function actor(
  responses: Record<string, { data?: unknown; error?: unknown }> = {}
) {
  const rpc = vi.fn(async (fn: string) => {
    const r = responses[fn] ?? { data: null }
    return { data: r.data ?? null, error: r.error ?? null }
  })
  return {
    rpc,
    actor: {
      profile: { id: "p", role: "manager", active: true },
      db: { rpc },
    } as unknown as MediaActor,
  }
}

describe("input validation before the database", () => {
  it("refuses a sold-out without a reason, or with a bad date", async () => {
    const { actor: a, rpc } = actor()
    expect(
      await setItemAvailability(a, { itemId: ITEM, available: false })
    ).toMatchObject({ ok: false, status: 400 })
    expect(
      await setItemAvailability(a, {
        itemId: ITEM,
        available: false,
        reason: "Sold out",
        until: "2026-02-30",
      })
    ).toMatchObject({ ok: false, status: 400 })
    expect(
      await setItemAvailability(a, { itemId: "nope", available: true })
    ).toMatchObject({ ok: false, status: 404 })
    expect(rpc).not.toHaveBeenCalled()
  })

  it("needs a reason for a local name but not to clear it", async () => {
    const { actor: a, rpc } = actor({
      menu_item_display_name_set: {
        data: { changed: true, displayName: null },
      },
    })
    expect(
      await setItemDisplayName(a, { itemId: ITEM, name: "Mango lassi" })
    ).toMatchObject({ ok: false, status: 400 })
    expect(
      await setItemDisplayName(a, { itemId: ITEM, name: "", reason: null })
    ).toEqual({ ok: true, changed: true, displayName: null })
    expect(rpc).toHaveBeenCalledWith("menu_item_display_name_set", {
      p_item_id: ITEM,
      p_name: null,
      p_reason: null,
    })
  })

  it("checks a special's name, kind and dates", async () => {
    const { actor: a, rpc } = actor()
    const base = {
      venueId: VENUE,
      name: "Game pie",
      kind: "food",
      startsOn: "2026-11-20",
      endsOn: "2026-11-27",
    }
    for (const bad of [
      { ...base, name: " " },
      { ...base, kind: "dessert" },
      { ...base, endsOn: "2026-11-19" },
      { ...base, startsOn: "20/11/2026" },
    ])
      expect(await createSpecial(a, bad)).toMatchObject({
        ok: false,
        status: 400,
      })
    expect(rpc).not.toHaveBeenCalled()
  })

  it("needs a dish for anything but adding one", async () => {
    const { actor: a } = actor()
    expect(
      await createChangeRequest(a, {
        venueId: VENUE,
        kind: "rename",
        detail: "x",
      })
    ).toMatchObject({ ok: false, status: 400 })
  })

  it("needs a reason and a revision to change scope", async () => {
    const { actor: a } = actor()
    expect(
      await setVenueScope(a, {
        venueId: VENUE,
        key: "accommodation",
        applicable: true,
        reason: "",
        revision: 0,
      })
    ).toMatchObject({ ok: false, status: 400 })
    expect(
      await setVenueScope(a, {
        venueId: VENUE,
        key: "bedrooms",
        applicable: true,
        reason: "x",
        revision: 0,
      })
    ).toMatchObject({ ok: false, status: 400 })
  })
})

describe("reads", () => {
  it("promotes due schedules before listing versions", async () => {
    const { actor: a, rpc } = actor({
      menu_activate_due: { data: 1 },
      menu_versions_for_venue: {
        data: {
          items: [
            {
              versionId: "v1",
              title: "Winter",
              state: "scheduled",
              scheduledFor: "2026-12-01T09:00:00Z",
              itemCount: 20,
              upcomingCount: 3,
              retiringCount: 1,
              sourceKind: "csv",
            },
            { versionId: "v0", title: "Bad", state: "draft" },
          ],
        },
      },
    })
    const result = await listVenueMenuVersions(a, { venueId: VENUE })
    expect(rpc.mock.calls.map((c) => c[0])).toEqual([
      "menu_activate_due",
      "menu_versions_for_venue",
    ])
    expect(result).toMatchObject({
      ok: true,
      versions: [
        {
          versionId: "v1",
          state: "scheduled",
          upcomingCount: 3,
          sourceKind: "csv",
        },
      ],
    })
  })

  it("keys offering states by item", async () => {
    const { actor: a } = actor({
      menu_offering_states: {
        data: {
          items: [
            {
              itemId: ITEM,
              available: false,
              unavailableUntil: null,
              unavailableReason: "Sold out",
              displayName: null,
              presentationRevision: 2,
            },
          ],
        },
      },
    })
    expect(await getOfferingStates(a, VENUE)).toEqual({
      ok: true,
      states: {
        [ITEM]: {
          itemId: ITEM,
          available: false,
          unavailableUntil: null,
          unavailableReason: "Sold out",
          displayName: null,
          presentationRevision: 2,
        },
      },
    })
  })
})

describe("database codes", () => {
  it.each([
    [
      {
        message: "menu_retirements_unconfirmed",
        details: '{"retirements": 2}',
      },
      409,
      "This draft retires 2 items from the current menu. Confirm the retirements and try again.",
    ],
    [{ message: "menu_schedule_exists" }, 409, /already scheduled/],
    [{ message: "menu_schedule_in_past", code: "22023" }, 400, /few minutes/],
    [{ message: "reason_required", code: "22023" }, 400, "Give a reason."],
    [
      { message: "not_venue_manager", code: "42501" },
      403,
      "You can only change menus at your own venue.",
    ],
    [{ message: "not_active_user" }, 403, "Your account is not active."],
    [
      { message: "menu_special_conflict", code: "40001" },
      409,
      /changed elsewhere/,
    ],
  ])("maps %o", (error, status, message) => {
    const out = menuRpcFailure(error, "test")
    expect(out.status).toBe(status)
    if (typeof message === "string") expect(out.message).toBe(message)
    else expect(out.message).toMatch(message)
  })
})

describe("CSV identity columns", () => {
  it("accepts the venue's id or name only", () => {
    const venue = { id: VENUE, name: "The Railway" }
    expect(csvVenueIssues(["the railway", VENUE], venue)).toEqual([])
    expect(csvVenueIssues(["The Bell"], venue)).toEqual([
      {
        severity: "error",
        path: "venue",
        message: "“The Bell” is not The Railway",
      },
    ])
  })

  it("pins a known item_id and refuses one that is not on the current menu", () => {
    const item = (itemId: string | null, sourceKey: string, name: string) => ({
      itemId,
      sourceKey,
      name,
      description: null,
      aliases: [],
      sourceMeta: {},
      variants: [],
      review: null,
    })
    const base: MenuDocument = {
      title: "Base",
      sections: [
        {
          slug: "mains",
          name: "Mains",
          kind: "food",
          items: [item(ITEM, "mains--old-pie", "Pie")],
        },
      ],
    }
    const next: MenuDocument = {
      title: "Next",
      sections: [
        {
          slug: "mains",
          name: "Mains",
          kind: "food",
          items: [
            item(null, "mains--steak-pie", "Steak pie"),
            item(null, "mains--soup", "Soup"),
          ],
        },
      ],
    }
    const pinned = pinItemIds(next, base, {
      venues: [],
      menuName: null,
      activeFrom: null,
      activeTo: null,
      itemIds: { "mains--steak-pie": { itemId: ITEM, row: 2 } },
    })
    expect(pinned.issues).toEqual([])
    expect(pinned.document.sections[0]!.items[0]!.itemId).toBe(ITEM)

    const foreign = pinItemIds(next, base, {
      venues: [],
      menuName: null,
      activeFrom: null,
      activeTo: null,
      itemIds: {
        "mains--soup": {
          itemId: "00000000-0000-4000-8000-0000000000ff",
          row: 3,
        },
      },
    })
    expect(foreign.issues).toEqual([
      {
        severity: "error",
        path: "row 3",
        message: "item_id is not an item on this venue's current menu",
      },
    ])
  })
})
