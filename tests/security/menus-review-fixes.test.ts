// Regressions for the v0.3 final review (docs/reviews/menus-final-review.md):
// I-1 a resolved suggestion is never silently lost by a later save, I-3 the
// labelling catalogue is complete beyond PostgREST's 1000-row page, and I-5 a
// variant dropped from the active menu stays filterable while labels use it.
import { spawn } from "node:child_process"

import { beforeAll, describe, expect, it } from "vitest"

import { getLabellingCatalogue } from "../../lib/server/labels"
import { libraryLabelFilterOptions } from "../../lib/server/media/library-labels"
import { actorFor } from "../slice/media-actor"
import {
  createIdentity,
  createVenue,
  serviceClient,
  type TestIdentity,
} from "../support/identities"
import {
  item,
  menu,
  publishMenu,
  readDocument,
  reserveReady,
  saveOk,
  section,
} from "./menus-fixtures"

const service = serviceClient()
let venue: string
let admin: TestIdentity
let staff: TestIdentity

beforeAll(async () => {
  venue = (await createVenue(service, "review-fixes")).id
  admin = await createIdentity(service, { label: "rf-admin", role: "admin" })
  staff = await createIdentity(service, {
    label: "rf-staff",
    role: "staff",
    venueId: venue,
  })
})

describe("I-1: suggestion changes after an admin resolved the suggestion", () => {
  it("creates a new open suggestion instead of reporting a lost edit", async () => {
    const asset = await reserveReady(service, staff)
    const first = await saveOk(staff, {
      asset: asset.id,
      revision: 0,
      types: ["dish"],
      missing: "TEST Mystery curry",
    })
    const { data: open } = await service
      .from("menu_item_suggestions")
      .select("id")
      .eq("asset_id", asset.id)
      .eq("status", "open")
      .single()
    const { error } = await admin.client.rpc("resolve_menu_item_suggestion", {
      p_suggestion_id: open!.id,
      p_status: "dismissed",
    })
    expect(error).toBeNull()

    await saveOk(staff, {
      asset: asset.id,
      revision: first.revision,
      types: ["dish"],
      missing: "TEST Mystery curry, renamed",
    })
    const { data: rows } = await service
      .from("menu_item_suggestions")
      .select("suggested_name, status")
      .eq("asset_id", asset.id)
      .order("created_at")
    expect(rows).toEqual([
      { suggested_name: "TEST Mystery curry", status: "dismissed" },
      { suggested_name: "TEST Mystery curry, renamed", status: "open" },
    ])
    const { data: events } = await service
      .from("media_label_events")
      .select("after")
      .eq("asset_id", asset.id)
      .order("id")
    expect(
      (events!.at(-1)!.after as { missingItem: string | null }).missingItem
    ).toBe("TEST Mystery curry, renamed")
  })
})

/**
 * Holds the resolve side of the race in a separate database session: takes
 * the venue menu lock exclusively (as resolve_menu_item_suggestion does),
 * dismisses the suggestion, waits, then commits. Local stack only.
 */
function resolveConcurrently(venueId: string, suggestionId: string) {
  const url = process.env.NABALENS_TEST_DB_URL
  if (!url || !/^postgresql:\/\/[^@]+@(127\.0\.0\.1|localhost):/.test(url)) {
    throw new Error("Run through `pnpm test:security <workdir>` (local DB).")
  }
  if (![venueId, suggestionId].every((v) => /^[0-9a-f-]{36}$/.test(v))) {
    throw new Error("bad fixture")
  }
  const sql = [
    "begin;",
    `select pg_advisory_xact_lock(hashtextextended('nabalens_menu:${venueId}', 0));`,
    `update public.menu_item_suggestions set status = 'dismissed', resolved_at = now() where id = '${suggestionId}';`,
    "select pg_sleep(1.5);",
    "commit;",
  ].join("\n")
  const child = spawn("psql", [url, "-v", "ON_ERROR_STOP=1", "-qAt"], {
    stdio: ["pipe", "ignore", "pipe"],
  })
  let stderr = ""
  child.stderr.on("data", (d) => (stderr += String(d)))
  child.stdin.end(sql)
  return new Promise<void>((resolve, reject) =>
    child.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`psql failed: ${stderr}`))
    )
  )
}

describe("I-1: a save racing a concurrent resolve", () => {
  it("waits for the resolve, then keeps the edit as a new open suggestion", async () => {
    const asset = await reserveReady(service, staff)
    const first = await saveOk(staff, {
      asset: asset.id,
      revision: 0,
      missing: "TEST Race curry",
    })
    const { data: open } = await service
      .from("menu_item_suggestions")
      .select("id")
      .eq("asset_id", asset.id)
      .eq("status", "open")
      .single()

    const resolving = resolveConcurrently(venue, open!.id)
    // Let the other session take the lock and dismiss (uncommitted) first.
    await new Promise((r) => setTimeout(r, 400))
    const started = Date.now()
    const saved = await saveOk(staff, {
      asset: asset.id,
      revision: first.revision,
      missing: "TEST Race curry, edited",
    })
    const waited = Date.now() - started
    await resolving

    // The save blocked on the venue lock until the resolve committed ...
    expect(waited).toBeGreaterThan(700)
    expect(saved.revision).toBe(first.revision + 1)
    // ... and then saw the dismissal, so the edit became a new suggestion
    // rather than an update that silently matched nothing.
    const { data: rows } = await service
      .from("menu_item_suggestions")
      .select("suggested_name, status")
      .eq("asset_id", asset.id)
      .order("created_at")
    expect(rows).toEqual([
      { suggested_name: "TEST Race curry", status: "dismissed" },
      { suggested_name: "TEST Race curry, edited", status: "open" },
    ])
    const { data: events } = await service
      .from("media_label_events")
      .select("before, after")
      .eq("asset_id", asset.id)
      .order("id")
    const last = events!.at(-1)!
    expect((last.before as { missingItem: string | null }).missingItem).toBe(
      null
    )
    expect((last.after as { missingItem: string | null }).missingItem).toBe(
      "TEST Race curry, edited"
    )
  }, 30_000)
})

describe("I-3: labelling catalogue beyond 1000 items in one section", () => {
  it("returns every item", async () => {
    const big = await createVenue(service, "review-fixes-big")
    const items = Array.from({ length: 1005 }, (_, i) =>
      item(`big--item-${i}`, `TEST Item ${String(i).padStart(4, "0")}`)
    )
    await publishMenu(
      admin,
      big.id,
      menu("TEST big menu", [section("big", "Big", items)])
    )
    const result = await getLabellingCatalogue(await actorFor(admin), big.id)
    expect(result.ok).toBe(true)
    if (!result.ok || result.catalogue.status !== "active") throw new Error()
    expect(result.catalogue.sections).toHaveLength(1)
    const names = result.catalogue.sections[0].items.map((i) => i.name)
    expect(names).toHaveLength(1005)
    expect(names[0]).toBe("TEST Item 0000")
    expect(names.at(-1)).toBe("TEST Item 1004")
  }, 120_000)
})

describe("I-5: historical variants stay in the filter options", () => {
  it("lists a labelled variant the active menu no longer has", async () => {
    const v1 = await publishMenu(
      admin,
      venue,
      menu("TEST v1", [
        section("curries", "Curries", [
          item("curries--curry", "TEST Curry", {
            variants: ["Chicken", "Lamb"],
          }),
        ]),
      ])
    )
    const doc = await readDocument(service, v1)
    const curry = doc.byKey["curries--curry"]
    const lamb = curry.variants.find((v) => v.name === "Lamb")!
    const asset = await reserveReady(service, staff)
    await saveOk(staff, {
      asset: asset.id,
      revision: 0,
      items: [{ itemId: curry.itemId, variantId: lamb.variantId }],
      catalogue: v1,
    })

    // v2 keeps the item but drops Lamb.
    await publishMenu(
      admin,
      venue,
      menu("TEST v2", [
        section("curries", "Curries", [
          item("curries--curry", "TEST Curry", {
            itemId: curry.itemId,
            variants: [curry.variants.find((v) => v.name === "Chicken")!],
          }),
        ]),
      ]),
      v1
    )
    const options = await libraryLabelFilterOptions(
      await actorFor(admin),
      venue
    )
    const option = options.items.find((i) => i.id === curry.itemId)!
    expect(option.variants.map((v) => v.id)).toContain(lamb.variantId)
    expect(option.variants.find((v) => v.id === lamb.variantId)!.name).toMatch(
      /^Lamb \(not on active menu\)$/
    )
  })
})
