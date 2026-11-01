// getMenuVersion and getActiveMenuItems read a venue's archived item ids a page
// of 1000 at a time, the pages after the first concurrently. The ids must come
// back exactly as plain sequential paging in `id` order returns them, for
// venues that end inside a page, on a page boundary, at the end of the first
// wave of concurrent pages, and past it.
import { beforeAll, describe, expect, it } from "vitest"

import { getActiveMenuItems, getMenuVersion } from "../../lib/server/menus"
import { actorFor } from "../slice/media-actor"
import {
  createIdentity,
  createVenue,
  serviceClient,
  type TestIdentity,
} from "../support/identities"
import { item, menu, publishMenu, section } from "./menus-fixtures"

const service = serviceClient()
let admin: TestIdentity

type Case = { archived: number; venue: string; version: string }
const cases: Case[] = [
  { archived: 0, venue: "", version: "" },
  { archived: 999, venue: "", version: "" },
  { archived: 1000, venue: "", version: "" },
  { archived: 3500, venue: "", version: "" },
  { archived: 5000, venue: "", version: "" },
  { archived: 6200, venue: "", version: "" },
]

/** Plain sequential paging in `id` order, as the admin. */
async function sequential(venueId: string): Promise<string[]> {
  const ids: string[] = []
  for (let from = 0; ; from += 1000) {
    const page = await admin.client
      .from("menu_items")
      .select("id")
      .eq("venue_id", venueId)
      .not("archived_at", "is", null)
      .order("id")
      .range(from, from + 999)
    if (page.error) throw page.error
    ids.push(...page.data.map((r) => r.id))
    if (page.data.length < 1000) return ids
  }
}

beforeAll(async () => {
  admin = await createIdentity(service, {
    label: "arch-page-admin",
    role: "admin",
  })
  for (const c of cases) {
    c.venue = (await createVenue(service, `arch-page-${c.archived}`)).id
    c.version = await publishMenu(
      admin,
      c.venue,
      menu("TEST archived paging", [
        section("mains", "Mains", [item("mains--a1", "A1")]),
      ])
    )
    for (let done = 0; done < c.archived; done += 1000) {
      const rows = Array.from(
        { length: Math.min(1000, c.archived - done) },
        () => ({ venue_id: c.venue, archived_at: new Date().toISOString() })
      )
      const { error } = await service.from("menu_items").insert(rows)
      if (error) throw error
    }
  }
}, 120_000)

describe("archived item ids of a venue", () => {
  for (const { archived } of cases) {
    it(`${archived} archived items: identical to sequential paging`, async () => {
      const c = cases.find((x) => x.archived === archived)!
      const expected = await sequential(c.venue)
      expect(expected).toHaveLength(archived)

      const actor = await actorFor(admin)
      const view = await getMenuVersion(actor, c.version)
      if (!view.ok) throw new Error("getMenuVersion failed")
      expect(view.version.archivedItemIds).toEqual(expected)
      expect(new Set(view.version.archivedItemIds).size).toBe(archived)

      const active = await getActiveMenuItems(actor, c.venue)
      if (!active.ok) throw new Error("getActiveMenuItems failed")
      expect(active.archivedItemIds).toEqual(expected)
    }, 60_000)
  }
})
