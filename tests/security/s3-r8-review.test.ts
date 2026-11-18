// S3-R8 (20261118126000): the Review repair pass, round 2.
//   K1 gap  label_help_queue applies the Review queue's uploader rule
//           (private.menu_photo_reviewable_uploader): no manager's own photo
//           outside a single-reviewer venue and no leaver's photo, so the
//           list, the Review queue's Needs label rows and Overview's count
//           are one set.
//   W2      at a venue with no ready menu the Review queue still returns the
//           Needs label rows Overview counts (the app now lists them).
//   W1      a Needs label video can't fill a dish: assign_menu_item_photo
//           refuses it (the app no longer offers Pick a dish for it).
// Real signed-in identities through PostgREST; psql ages rows and flips the
// single-reviewer setting.
import { beforeAll, describe, expect, it } from "vitest"

import { createIdentity, type TestIdentity } from "../support/identities"
import { fails, ok, psql } from "./coverage-fixtures"
import { service, world, type World } from "./knowledge-fixtures"
import {
  item,
  menu,
  publishMenu,
  readDocument,
  reserveReady,
  section,
} from "./menus-fixtures"

type Who = { client: TestIdentity["client"] }

/** Ages an upload by `days` (triggers off: created_at is guarded). */
function age(asset: string, days: number) {
  psql(
    `set session_replication_role = replica; update public.media_assets set created_at = now() - interval '${days} days' where id = '${asset}'`
  )
}

/** An upload nobody labelled for 8 days: Needs label by the 7-day rule. */
async function unmatched(
  who: TestIdentity,
  media: "image" | "video" = "image"
) {
  const asset = (await reserveReady(service, who, media)).id
  age(asset, 8)
  return asset
}

const helpIds = async (who: Who, venue: string) => {
  const out = (await ok(
    who.client.rpc("label_help_queue", { p_venue_id: venue, p_limit: 200 })
  )) as { total: number; items: Array<{ assetId: string }> }
  expect(out.total).toBe(out.items.length)
  return out.items.map((i) => i.assetId).sort()
}

const queueIds = async (who: Who, venue: string, status = "unlabelled") => {
  const rows = (await ok(
    who.client.rpc("manager_menu_photo_queue", {
      p_venue_id: venue,
      p_status: status,
      p_limit: 101,
    })
  )) as Array<{ kind: string; asset_id: string }>
  return rows
    .filter((r) => r.kind === "unlabelled")
    .map((r) => r.asset_id)
    .sort()
}

const overviewCount = async (who: Who, venue: string) =>
  (
    (await ok(
      who.client.rpc("manager_venue_summary", { p_venue_id: venue })
    )) as { unlabelledPhotos: number }
  ).unlabelledPhotos

describe("K1 gap: label_help_queue lists whose photos Review lists", () => {
  let w: World
  let staffPhoto: string
  let ownPhoto: string
  let leaverPhoto: string

  beforeAll(async () => {
    w = await world("s3r8-help")
    staffPhoto = await unmatched(w.staffA)
    ownPhoto = await unmatched(w.manager)
    const leaver = await createIdentity(service, {
      label: "s3r8-help-leaver",
      role: "staff",
      venueId: w.venue,
    })
    leaverPhoto = await unmatched(leaver)
    await ok(
      service.from("profiles").update({ active: false }).eq("id", leaver.id)
    )
  }, 120_000)

  it("leaves out the manager's own photo and a leaver's photo, like Review and Overview", async () => {
    const help = await helpIds(w.manager, w.venue)
    expect(help).toContain(staffPhoto)
    expect(help).not.toContain(ownPhoto)
    expect(help).not.toContain(leaverPhoto)
    expect(help).toEqual(await queueIds(w.manager, w.venue))
    expect(await overviewCount(w.manager, w.venue)).toBe(help.length)
  })

  it("keeps every photo for an admin, as the admin's Review does", async () => {
    const help = await helpIds(w.admin, w.venue)
    for (const id of [staffPhoto, ownPhoto, leaverPhoto])
      expect(help).toContain(id)
    expect(help).toEqual(await queueIds(w.admin, w.venue))
  })

  it("lists the manager's own photo at their single-reviewer venue (K6)", async () => {
    psql(
      `update public.venues set single_reviewer = true where id = '${w.venue}'`
    )
    try {
      const help = await helpIds(w.manager, w.venue)
      expect(help).toContain(ownPhoto)
      expect(help).not.toContain(leaverPhoto)
      expect(help).toEqual(await queueIds(w.manager, w.venue))
      expect(await overviewCount(w.manager, w.venue)).toBe(help.length)
    } finally {
      psql(
        `update public.venues set single_reviewer = false where id = '${w.venue}'`
      )
    }
  })
})

describe("W2: Needs label at a venue with no ready menu", () => {
  let w: World
  let photo: string
  let video: string

  beforeAll(async () => {
    w = await world("s3r8-nomenu")
    photo = await unmatched(w.staffA)
    video = await unmatched(w.staffB, "video")
  }, 120_000)

  it("the queue lists what Overview counts, with no active menu", async () => {
    const [overview] = (await ok(
      w.manager.client.rpc("manager_menu_photo_overview", {
        p_venue_id: w.venue,
      })
    )) as Array<{ menu_state: string }>
    expect(overview!.menu_state).toBe("no_menu")
    const count = await overviewCount(w.manager, w.venue)
    expect(count).toBe(2)
    // The list view reads status unlabelled; Review in a thumb reads pending.
    expect(await queueIds(w.manager, w.venue)).toEqual([photo, video].sort())
    expect(await queueIds(w.manager, w.venue, "pending")).toEqual(
      [photo, video].sort()
    )
  })

  it("Not used works without a menu, and the photo leaves every list", async () => {
    await ok(
      w.manager.client.rpc("review_set_aside", {
        p_asset_id: photo,
        p_action: "not_used",
        p_reason: "Not a dish",
      })
    )
    expect(await queueIds(w.manager, w.venue)).toEqual([video])
    expect(await helpIds(w.manager, w.venue)).toEqual([video])
    expect(await overviewCount(w.manager, w.venue)).toBe(1)
  })
})

describe("W1: a Needs label video can't fill a dish", () => {
  it("is refused by assign_menu_item_photo, so the screen offers Not used only", async () => {
    const w = await world("s3r8-video")
    const version = await publishMenu(
      w.admin,
      w.venue,
      menu("TEST s3-r8 video", [
        section("mains", "Mains", [item("mains--pie", "Pie")]),
      ])
    )
    const pie = (await readDocument(service, version)).byKey["mains--pie"]!
    const video = await unmatched(w.staffA, "video")
    expect(await queueIds(w.manager, w.venue)).toContain(video)
    await fails(
      w.manager.client.rpc("assign_menu_item_photo", {
        p_asset_id: video,
        p_item_id: pie.itemId,
        p_variant_id: null as unknown as string,
        p_corrects_item_id: null as unknown as string,
        p_corrects_variant_id: null as unknown as string,
        p_reason: null as unknown as string,
        p_expected_revision: 1,
      }),
      "evidence_not_eligible"
    )
  }, 120_000)
})
