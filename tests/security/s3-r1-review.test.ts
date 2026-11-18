// S3-R1 (20261118120000..120400): review and decision repairs.
//   V3   place and amenity decisions lock the asset row, so a withdrawal and
//        an acceptance of one photo never pass each other.
//   V15  a set-aside photo is never accepted for a dish.
//   V16  the queue carries the latest disposition, so a batch Not used of a
//        restored photo is made against what the screen saw.
//   V17  Restore puts the photo's place and amenity rows back in the queue.
//   K1   one unlabelled rule for Review, label_help_queue, the manager and
//        admin Overview counts and the Library filter.
//   K6   a single-reviewer venue (FA-9).
//   K11  the Review media type filter.
// Real signed-in identities through PostgREST; psql builds fixtures, ages
// rows and holds the second session of each race.
import { spawn } from "node:child_process"

import { beforeAll, describe, expect, it } from "vitest"

import { type TestIdentity } from "../support/identities"
import { fails, ok, psql } from "./coverage-fixtures"
import {
  admin as knowledgeAdmin,
  service,
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

type Who = { client: TestIdentity["client"] }

type Venue = {
  w: World
  version: string
  items: Record<string, CatalogueRow>
}

async function venue(label: string): Promise<Venue> {
  const w = await world(label)
  const version = await publishMenu(
    w.admin,
    w.venue,
    menu("TEST s3-r1 review", [
      section("mains", "Mains", [
        item("mains--pie", "Pie"),
        item("mains--soup", "Soup"),
      ]),
    ])
  )
  const items = (await readDocument(service, version)).byKey
  return { w, version, items }
}

async function dishPhoto(
  v: Venue,
  who: TestIdentity,
  itemKey: string | null,
  types: string[] = ["dish"],
  mediaType: "image" | "video" = "image"
) {
  const asset = await reserveReady(service, who, mediaType)
  await saveOk(who, {
    asset: asset.id,
    revision: 0,
    types,
    ...(itemKey
      ? {
          items: [{ itemId: v.items[itemKey]!.itemId, variantId: null }],
          catalogue: v.version,
        }
      : {}),
  })
  return asset.id
}

const head = (itemId: string) =>
  Number(
    psql(
      `select coalesce((select revision from public.menu_item_photo_heads where item_id = '${itemId}'), 1)`
    )
  )

const queue = (who: Who, venueId: string, args: Record<string, unknown> = {}) =>
  who.client.rpc("manager_menu_photo_queue", {
    p_venue_id: venueId,
    p_limit: 101,
    ...args,
  })

const setAside = (
  who: Who,
  asset: string,
  action: "not_used" | "duplicate" | "restored",
  opts: { reason?: string; expected?: number | null } = {}
) =>
  who.client.rpc("review_set_aside", {
    p_asset_id: asset,
    p_action: action,
    ...(opts.reason ? { p_reason: opts.reason } : {}),
    ...(opts.expected != null
      ? { p_expected_disposition_id: opts.expected }
      : {}),
  })

function place(v: Venue, label: string) {
  return psql(
    `insert into public.knowledge_subjects (venue_id, kind, label, created_by)
     values ('${v.w.venue}', 'area', '${label}', '${v.w.admin.id}') returning id`
  )
}

async function areaPhoto(v: Venue, who: TestIdentity, subject: string) {
  const asset = (await reserveReady(service, who)).id
  const [row] = (await ok(
    who.client.rpc("set_media_area_label", {
      p_asset_id: asset,
      p_subject_id: subject,
    })
  )) as Array<{ label_id: string }>
  return { asset, label: row!.label_id }
}

/** Ages an upload by `days` (triggers off: created_at is guarded). */
function age(asset: string, days: number) {
  psql(
    `set session_replication_role = replica; update public.media_assets set created_at = now() - interval '${days} days' where id = '${asset}'`
  )
}

/**
 * Runs `sql` as `userId` in a second session that holds its transaction open
 * for `holdMs` before committing. Resolves with the session's stderr.
 */
function holdAs(
  userId: string | null,
  sql: string,
  holdMs = 1500
): Promise<string> {
  const url = process.env.NABALENS_TEST_DB_URL!
  const script = [
    "begin;",
    ...(userId
      ? [
          "set local role authenticated;",
          `select set_config('request.jwt.claims', '{"sub":"${userId}","role":"authenticated","aal":"aal2"}', true) is null;`,
        ]
      : []),
    sql,
    `select pg_sleep(${holdMs / 1000});`,
    "commit;",
  ].join("\n")
  const child = spawn("psql", [url, "-X", "-qAt", "-v", "ON_ERROR_STOP=1"], {
    stdio: ["pipe", "ignore", "pipe"],
  })
  let stderr = ""
  child.stderr.on("data", (d) => (stderr += String(d)))
  child.stdin.end(script)
  return new Promise((resolve) => child.on("exit", () => resolve(stderr)))
}

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms))

let a: Venue

beforeAll(async () => {
  await knowledgeAdmin()
  a = await venue("s3r1-a")
}, 120_000)

describe("V15: a set-aside photo is never accepted for a dish", () => {
  it("refuses an approval made from a stale queue, with the disposition", async () => {
    const pie = a.items["mains--pie"]!.itemId
    const photo = await dishPhoto(a, a.w.staffA, "mains--pie")
    const revision = head(pie)
    // Manager A marks it Not used.
    await ok(setAside(a.w.manager, photo, "not_used", { reason: "Blurry" }))
    // Manager B's older screen still holds the dish head it saw.
    expect(head(pie)).toBe(revision)
    const refused = await fails(
      a.w.admin.client.rpc("set_menu_item_photo_level", {
        p_asset_id: photo,
        p_item_id: pie,
        p_variant_id: null as unknown as string,
        p_level: "public",
        p_expected_revision: revision,
      }),
      "review_conflict",
      "40001"
    )
    expect(JSON.parse(refused.details ?? "{}").action).toBe("not_used")
    await fails(
      a.w.admin.client.rpc("review_menu_item_photo", {
        p_asset_id: photo,
        p_item_id: pie,
        p_variant_id: null as unknown as string,
        p_decision: "accepted",
        p_expected_revision: revision,
        p_make_primary: false,
      }),
      "review_conflict",
      "40001"
    )
    expect(
      psql(
        `select count(*) from public.menu_item_photos where asset_id = '${photo}'`
      )
    ).toBe("0")
  })

  it("refuses a place acceptance of a set-aside photo too", async () => {
    const p = await areaPhoto(a, a.w.staffB, place(a, "V15 Garden"))
    await ok(setAside(a.w.manager, p.asset, "not_used", { reason: "Dark" }))
    await fails(
      a.w.manager.client.rpc("decide_area_photo_level", {
        p_label_id: p.label,
        p_action: "accepted",
      }),
      "review_conflict",
      "40001"
    )
  })
})

describe("V3: acceptance and withdrawal of one photo", () => {
  it("a withdrawal waits for a place acceptance, then keeps the photo", async () => {
    const p = await areaPhoto(a, a.w.staffA, place(a, "V3 Bar"))
    const accepting = holdAs(
      a.w.manager.id,
      `select state from public.decide_area_photo_level('${p.label}', 'accepted');`
    )
    await pause(400)
    const started = Date.now()
    const { error } = await a.w.staffA.client.rpc("delete_media_asset", {
      p_asset_id: p.asset,
    })
    const waited = Date.now() - started
    expect(await accepting).toBe("")
    expect(waited).toBeGreaterThan(700)
    expect(error?.message).toBe("media_asset_retained")
    expect(
      psql(
        `select deleted_at is null from public.media_assets where id = '${p.asset}'`
      )
    ).toBe("t")
  })

  it("an acceptance waits for a withdrawal, then finds no photo", async () => {
    const p = await areaPhoto(a, a.w.staffB, place(a, "V3 Snug"))
    const withdrawing = holdAs(
      a.w.staffB.id,
      `select public.delete_media_asset('${p.asset}');`
    )
    await pause(400)
    await fails(
      a.w.manager.client.rpc("review_decide_area_photo", {
        p_label_id: p.label,
        p_action: "accepted",
      }),
      "area_photo_not_found",
      "P0002"
    )
    expect(await withdrawing).toBe("")
    expect(
      psql(
        `select count(*) from public.area_photo_decisions where label_id = '${p.label}'`
      )
    ).toBe("0")
  })

  it("an amenity acceptance waits for a withdrawal, then finds no photo", async () => {
    const parking = await yes(a.w.staffA, a.w, "onsite_parking")
    const asset = psql(
      `select sa.asset_id from public.amenity_submission_assets sa
       where sa.submission_id = '${parking.submissionId}' limit 1`
    )
    // An amenity answer's evidence is kept from its uploader, so the removal
    // is made directly (the same row lock delete_media_asset takes).
    const withdrawing = holdAs(
      null,
      `select 1 from public.media_assets where id = '${asset}' for update;
       update public.media_assets set deleted_at = now() where id = '${asset}';`
    )
    await pause(400)
    await fails(
      a.w.manager.client.rpc("review_decide_amenity_photo", {
        p_check_id: a.w.checks.onsite_parking!,
        p_asset_id: asset,
        p_action: "accepted",
      }),
      "amenity_photo_not_found",
      "P0002"
    )
    expect(await withdrawing).toBe("")
    expect(
      psql(
        `select count(*) from public.amenity_photo_decisions where asset_id = '${asset}'`
      )
    ).toBe("0")
  })
})

describe("V16: batch Not used of a restored photo", () => {
  it("lists the latest disposition, and a set aside against it succeeds", async () => {
    const photo = await dishPhoto(a, a.w.staffA, "mains--soup")
    const first = (await ok(
      setAside(a.w.manager, photo, "not_used", { reason: "Blurry" })
    )) as { dispositionId: number }
    const back = (await ok(
      setAside(a.w.manager, photo, "restored", {
        expected: first.dispositionId,
      })
    )) as { dispositionId: number }
    const rows = await ok(queue(a.w.manager, a.w.venue))
    const card = rows.find((r) => r.asset_id === photo)!
    expect(card.disposition_id).toBe(back.dispositionId)
    await fails(
      setAside(a.w.manager, photo, "not_used", { reason: "Again" }),
      "review_conflict",
      "40001"
    )
    await ok(
      setAside(a.w.manager, photo, "not_used", {
        reason: "Again",
        expected: card.disposition_id,
      })
    )
  })
})

describe("V17: Restore puts place and amenity rows back in the queue", () => {
  it("reopens the place label the set aside closed", async () => {
    const subject = place(a, "V17 Terrace")
    const p = await areaPhoto(a, a.w.staffA, subject)
    const out = (await ok(
      setAside(a.w.manager, p.asset, "not_used", { reason: "Dark" })
    )) as { dispositionId: number }
    const queued = async () =>
      (
        (await ok(
          a.w.manager.client.rpc("area_photo_queue", {
            p_venue_id: a.w.venue,
            p_status: "pending",
            p_limit: 101,
          })
        )) as Array<{ asset_id: string; label_id: string }>
      ).filter((r) => r.asset_id === p.asset)
    expect(await queued()).toEqual([])
    await ok(
      setAside(a.w.manager, p.asset, "restored", {
        expected: out.dispositionId,
      })
    )
    const again = await queued()
    expect(again).toHaveLength(1)
    // The same place, labeller and time; the closed label keeps its history.
    expect(
      psql(
        `select subject_id || '|' || (added_by = '${a.w.staffA.id}') from public.media_area_labels
         where id = '${again[0]!.label_id}'`
      )
    ).toBe(`${subject}|true`)
    expect(
      psql(
        `select action from public.area_photo_decisions where label_id = '${p.label}'`
      )
    ).toBe("not_used")
    // It can be accepted now.
    await ok(
      a.w.manager.client.rpc("review_decide_area_photo", {
        p_label_id: again[0]!.label_id,
        p_action: "accepted",
      })
    )
  })

  it("reopens the amenity row the set aside closed, and leaves a later decision", async () => {
    const toilets = await yes(a.w.staffB, a.w, "guest_toilets")
    const asset = psql(
      `select sa.asset_id from public.amenity_submission_assets sa
       where sa.submission_id = '${toilets.submissionId}' limit 1`
    )
    const out = (await ok(
      setAside(a.w.manager, asset, "not_used", { reason: "Wrong place" })
    )) as { dispositionId: number }
    const state = () =>
      psql(
        `select action from public.amenity_photo_decisions where asset_id = '${asset}' order by id desc limit 1`
      )
    expect(state()).toBe("not_used")
    await ok(
      setAside(a.w.manager, asset, "restored", {
        expected: out.dispositionId,
      })
    )
    expect(state()).toBe("pending")
    const pending = (await ok(
      a.w.manager.client.rpc("amenity_photo_queue", {
        p_venue_id: a.w.venue,
        p_status: "pending",
        p_limit: 101,
      })
    )) as Array<{ asset_id: string }>
    expect(pending.some((r) => r.asset_id === asset)).toBe(true)
  })
})

describe("K1: one unlabelled rule", () => {
  let b: Venue
  let notSure: string
  let oldUnmatched: string
  let fresh: string
  let foodNoDish: string
  let notForSlot: string
  let notSureVideo: string

  beforeAll(async () => {
    b = await venue("s3r1-k1")
    notSure = (await reserveReady(service, b.w.staffA)).id
    await ok(
      b.w.staffA.client.rpc("request_label_help", { p_asset_id: notSure })
    )
    oldUnmatched = (await reserveReady(service, b.w.staffA)).id
    age(oldUnmatched, 8)
    fresh = (await reserveReady(service, b.w.staffB)).id
    foodNoDish = await dishPhoto(b, b.w.staffB, null, ["drinks"])
    notForSlot = await dishPhoto(b, b.w.staffB, null, ["team"])
    age(notForSlot, 9)
    notSureVideo = (await reserveReady(service, b.w.staffB, "video")).id
    await ok(
      b.w.staffB.client.rpc("request_label_help", { p_asset_id: notSureVideo })
    )
  }, 120_000)

  const expected = () => [notSure, oldUnmatched, foodNoDish, notSureVideo]
  const others = () => [fresh, notForSlot]

  it("puts I'm not sure and 7-day Match later photos in Review as Needs label", async () => {
    const rows = await ok(queue(b.w.manager, b.w.venue))
    const unlabelled = rows.filter((r) => r.kind === "unlabelled")
    const ids = unlabelled.map((r) => r.asset_id)
    for (const id of expected()) expect(ids, id).toContain(id)
    for (const id of others()) expect(ids, id).not.toContain(id)
    const reason = (id: string) =>
      unlabelled.find((r) => r.asset_id === id)!.unlabelled_reason
    expect(reason(notSure)).toBe("not_sure")
    expect(reason(oldUnmatched)).toBe("unmatched")
    expect(reason(foodNoDish)).toBe("no_dish")
  })

  it("filters Review by media type (K11)", async () => {
    const videos = await ok(
      queue(b.w.manager, b.w.venue, { p_media_type: "video" })
    )
    expect(videos.map((r) => r.asset_id)).toEqual([notSureVideo])
    expect(videos[0]!.media_type).toBe("video")
    const photos = await ok(
      queue(b.w.manager, b.w.venue, { p_media_type: "image" })
    )
    expect(photos.map((r) => r.asset_id)).not.toContain(notSureVideo)
    await fails(
      queue(b.w.manager, b.w.venue, { p_media_type: "audio" }),
      "invalid_media_type",
      "22023"
    )
  })

  it("gives every count and list the same set", async () => {
    const help = (await ok(
      b.w.manager.client.rpc("label_help_queue", {
        p_venue_id: b.w.venue,
        p_limit: 200,
      })
    )) as { total: number; items: Array<{ assetId: string }> }
    expect(help.items.map((i) => i.assetId).sort()).toEqual(
      [...expected()].sort()
    )
    const summary = (await ok(
      b.w.manager.client.rpc("manager_venue_summary", {
        p_venue_id: b.w.venue,
      })
    )) as { unlabelledPhotos: number }
    expect(summary.unlabelledPhotos).toBe(expected().length)
    const overview = (await ok(
      b.w.admin.client.rpc("admin_group_overview", {
        p_venue_ids: [b.w.venue],
      })
    )) as { rows: Array<{ venueId: string; unlabelled: number }> }
    expect(overview.rows.find((r) => r.venueId === b.w.venue)!.unlabelled).toBe(
      expected().length
    )
    const library = await ok(
      b.w.admin.client.rpc("library_page", {
        p_venue: b.w.venue,
        p_label_state: "unlabelled",
      })
    )
    expect((library as Array<{ id: string }>).map((r) => r.id).sort()).toEqual(
      [...expected()].sort()
    )
    // The library's own path (another filter set, so the dynamic query).
    const libraryImages = await ok(
      b.w.admin.client.rpc("library_page", {
        p_venue: b.w.venue,
        p_label_state: "unlabelled",
        p_content_type: "drinks",
      })
    )
    expect((libraryImages as Array<{ id: string }>).map((r) => r.id)).toEqual([
      foodNoDish,
    ])
  })

  it("lets the manager open and label an I'm not sure photo", async () => {
    const opened = await ok(
      b.w.manager.client.rpc("menu_item_photo_asset", { p_asset_id: notSure })
    )
    expect((opened as unknown[]).length).toBe(1)
    const pie = b.items["mains--pie"]!.itemId
    await ok(
      b.w.manager.client.rpc("assign_menu_item_photo", {
        p_asset_id: notSure,
        p_item_id: pie,
        p_variant_id: null as unknown as string,
        p_corrects_item_id: null as unknown as string,
        p_corrects_variant_id: null as unknown as string,
        p_reason: null as unknown as string,
        p_expected_revision: head(pie),
      })
    )
    const rows = await ok(queue(b.w.manager, b.w.venue))
    expect(
      rows.some((r) => r.asset_id === notSure && r.kind === "unlabelled")
    ).toBe(false)
  })

  it("leaves a set-aside photo out", async () => {
    await ok(
      setAside(b.w.manager, oldUnmatched, "not_used", { reason: "Blurry" })
    )
    const summary = (await ok(
      b.w.manager.client.rpc("manager_venue_summary", {
        p_venue_id: b.w.venue,
      })
    )) as { unlabelledPhotos: number }
    expect(summary.unlabelledPhotos).toBe(2) // foodNoDish, notSureVideo
  })
})

describe("K6: single-reviewer venue (FA-9)", () => {
  let c: Venue
  let own: string
  let ownPlace: { asset: string; label: string }

  beforeAll(async () => {
    c = await venue("s3r1-k6")
    own = await dishPhoto(c, c.w.manager, "mains--pie")
    // Managers label places only through review; the label is made here.
    const asset = (await reserveReady(service, c.w.manager)).id
    const label = psql(
      `insert into public.media_area_labels (asset_id, venue_id, subject_id, subject_kind, subject_label, added_by)
       values ('${asset}', '${c.w.venue}', '${place(c, "K6 Lounge")}', 'area', 'K6 Lounge', '${c.w.manager.id}')
       returning id`
    )
    ownPlace = { asset, label }
  }, 120_000)

  const settings = (who: Who) =>
    who.client.rpc("admin_venue_review_settings", { p_venue_id: c.w.venue })

  it("keeps the block by default", async () => {
    const pie = c.items["mains--pie"]!.itemId
    await fails(
      c.w.manager.client.rpc("set_menu_item_photo_level", {
        p_asset_id: own,
        p_item_id: pie,
        p_variant_id: null as unknown as string,
        p_level: "public",
        p_expected_revision: head(pie),
      }),
      "self_review_not_allowed",
      "42501"
    )
    await fails(
      c.w.manager.client.rpc("decide_area_photo_level", {
        p_label_id: ownPlace.label,
        p_action: "accepted",
      }),
      "self_review_not_allowed",
      "42501"
    )
  })

  it("is an admin's setting, with a reason and the revision read", async () => {
    const { error: managerRead } = await settings(c.w.manager)
    expect(managerRead?.code).toBe("42501")
    const before = (await ok(settings(c.w.admin))) as {
      singleReviewer: boolean
      revision: number
    }
    expect(before.singleReviewer).toBe(false)
    const { error: notAdmin } = await c.w.manager.client.rpc(
      "admin_venue_set_single_reviewer",
      {
        p_venue_id: c.w.venue,
        p_enabled: true,
        p_reason: "One manager",
        p_revision: before.revision,
      }
    )
    expect(notAdmin).not.toBeNull()
    await fails(
      c.w.admin.client.rpc("admin_venue_set_single_reviewer", {
        p_venue_id: c.w.venue,
        p_enabled: true,
        p_reason: "",
        p_revision: before.revision,
      }),
      "reason_required",
      "22023"
    )
    await fails(
      c.w.admin.client.rpc("admin_venue_set_single_reviewer", {
        p_venue_id: c.w.venue,
        p_enabled: true,
        p_reason: "One manager",
        p_revision: before.revision - 1,
      }),
      "venue_conflict",
      "40001"
    )
    const on = (await ok(
      c.w.admin.client.rpc("admin_venue_set_single_reviewer", {
        p_venue_id: c.w.venue,
        p_enabled: true,
        p_reason: "One manager",
        p_revision: before.revision,
      })
    )) as { singleReviewer: boolean; changed: boolean }
    expect(on).toMatchObject({ singleReviewer: true, changed: true })
    expect(
      psql(
        `select count(*) from public.activity_events
         where venue_id = '${c.w.venue}' and action = 'venue_single_reviewer_changed'`
      )
    ).toBe("1")
  })

  it("then lets the manager decide on their own photo, listed for spot checks", async () => {
    const rows = await ok(queue(c.w.manager, c.w.venue))
    const card = rows.find((r) => r.asset_id === own)!
    expect(card.is_self).toBe(true)
    expect(card.self_review_allowed).toBe(true)
    const pie = c.items["mains--pie"]!.itemId
    await ok(
      c.w.manager.client.rpc("set_menu_item_photo_level", {
        p_asset_id: own,
        p_item_id: pie,
        p_variant_id: null as unknown as string,
        p_level: "public",
        p_expected_revision: head(pie),
      })
    )
    await ok(
      c.w.manager.client.rpc("decide_area_photo_level", {
        p_label_id: ownPlace.label,
        p_action: "accepted",
      })
    )
    const detail = (await ok(
      c.w.manager.client.rpc("review_photo_detail", { p_asset_id: own })
    )) as { selfBlocked: boolean; selfReviewAllowed: boolean }
    expect(detail).toMatchObject({
      selfBlocked: false,
      selfReviewAllowed: true,
    })
    const list = (await ok(settings(c.w.admin))) as {
      selfDecisions: Array<{ source: string; assetId: string; byId: string }>
    }
    const sources = list.selfDecisions
      .filter((d) => d.byId === c.w.manager.id)
      .map((d) => `${d.source}:${d.assetId}`)
    expect(sources).toContain(`dish:${own}`)
    expect(sources).toContain(`place:${ownPlace.asset}`)
  })

  it("never lets a staff member decide on anything", async () => {
    const theirs = await areaPhoto(c, c.w.staffA, place(c, "K6 Yard"))
    await fails(
      c.w.staffA.client.rpc("decide_area_photo_level", {
        p_label_id: theirs.label,
        p_action: "accepted",
      }),
      "area_photo_not_found",
      "P0002"
    )
  })
})
