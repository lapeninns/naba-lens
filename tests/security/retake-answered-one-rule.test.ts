// Full App v1, S3-R10 repair (S3-repair-review W7): one rule for whether a
// retake is answered. Migration 20261118128000 adds
// private.retake_answer(...), read by my_retake_notes (Home and Album's
// notes) and by my_uploads retakeAnswered (Me and the slot page).
//
// Each case asks for a retake on photo P, then sends photo Q of the same
// slot after it was asked, and checks that Me and Home agree:
//
//   video      Q is a video: open on both (Me said answered before)
//   asked      Q itself is asked again: open on both (Me said answered)
//   not used   Q set aside as Not used: open on both (both said answered,
//              while Album counted Q as not waiting)
//   waiting    Q waits for review: answered on both (Home: retaken)
//   accepted   Q accepted: answered on both (Home: cleared)
//   place      the same rule for a place photo: Q asked again is open, a
//              newer Q waiting answers it
//
// Real signed-in identities through PostgREST; the service role and psql
// only build fixtures and read back.
import { beforeAll, describe, expect, it } from "vitest"

import type { TestIdentity } from "../support/identities"
import { ok, psql } from "./coverage-fixtures"
import {
  admin as knowledgeAdmin,
  call,
  json,
  service,
  world,
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
} from "./menus-fixtures"

type Slot = {
  kind: string
  slotId: string
  outcome: string
  retakeAnswered: boolean
}
type Uploads = { items: { assetId: string; slots: Slot[] }[] }
type Note = { kind: string; note_id: string; asset_id: string; status: string }

const KEYS = ["video", "asked", "unused", "waiting", "accepted"] as const
type Key = (typeof KEYS)[number]

let w: World
let version: string
let dish: Record<Key, string>
let garden: string
let staff: TestIdentity

const head = (itemId: string) =>
  Number(
    psql(
      `select coalesce((select revision from public.menu_item_photo_heads where item_id = '${itemId}'), 1)`
    )
  )

async function dishPhoto(
  itemId: string,
  mediaType: "image" | "video" = "image"
) {
  const asset = await reserveReady(service, staff, mediaType)
  await saveOk(staff, {
    asset: asset.id,
    revision: 0,
    items: [{ itemId, variantId: null }],
    catalogue: version,
  })
  return asset.id
}

const review = (
  asset: string,
  itemId: string,
  decision: "accepted" | "better_photo_requested"
) =>
  ok(
    call(w.manager, "review_menu_item_photo", {
      p_asset_id: asset,
      p_item_id: itemId,
      p_variant_id: null,
      p_decision: decision,
      p_expected_revision: head(itemId),
      ...(decision === "accepted"
        ? { p_make_primary: false }
        : { p_reason: "TEST too dark" }),
    }) as never
  )

async function areaPhoto(subject: string) {
  const asset = (await reserveReady(service, staff)).id
  await ok(
    staff.client.rpc("set_media_area_label", {
      p_asset_id: asset,
      p_subject_id: subject,
    })
  )
  return asset
}

const areaLabel = (asset: string) =>
  psql(
    `select id from public.media_area_labels where asset_id = '${asset}' and removed_at is null`
  )

const decideArea = (asset: string, action: string) =>
  ok(
    call(w.manager, "decide_area_photo", {
      p_label_id: areaLabel(asset),
      p_action: action,
      ...(action === "accepted" ? {} : { p_reason: "TEST wrong corner" }),
    }) as never
  )

/** Pins Q as sent after the retake on P was asked (same transaction clock). */
const sentAfter = (q: string, p: string) =>
  psql(
    `set session_replication_role = replica;
     update public.media_assets set created_at = (
       select max(m.decided_at) + interval '1 second' from public.menu_item_photos m where m.asset_id = '${p}')
     where id = '${q}'`
  )

/** What Me says about P's retake on this slot. */
async function meAnswered(asset: string, kind: string, slot: string) {
  const read = await json<Uploads>(staff, "my_uploads", {
    p_asset_id: asset,
  })
  const s = read.items[0]!.slots.find(
    (x) => x.kind === kind && x.slotId === slot
  )!
  expect(s.outcome).toBe("retake_requested")
  return s.retakeAnswered
}

/** What Home says about P's menu retake note. */
async function homeStatus(asset: string) {
  const notes = (await ok(staff.client.rpc("my_retake_notes"))) as Note[]
  return notes.find((n) => n.kind === "menu" && n.asset_id === asset)!.status
}

beforeAll(async () => {
  await knowledgeAdmin()
  w = await world("s3-r10-retake")
  staff = w.staffA
  version = await publishMenu(
    w.admin,
    w.venue,
    menu("TEST retake rule", [
      section(
        "mains",
        "Mains",
        KEYS.map((k) => item(`mains--${k}`, `Dish ${k}`))
      ),
    ])
  )
  const items = (await readDocument(service, version)).byKey
  dish = Object.fromEntries(
    KEYS.map((k) => [k, items[`mains--${k}`]!.itemId])
  ) as Record<Key, string>
  garden = psql(
    `insert into public.knowledge_subjects (venue_id, kind, label, created_by)
     values ('${w.venue}', 'area', 'Garden', '${w.admin.id}') returning id`
  )
})

/** P of the dish, with a retake asked, and Q sent after it. */
async function retakeThenSend(
  key: Key,
  mediaType: "image" | "video" = "image"
) {
  const p = await dishPhoto(dish[key])
  await review(p, dish[key], "better_photo_requested")
  const q = await dishPhoto(dish[key], mediaType)
  sentAfter(q, p)
  return { p, q }
}

describe("W7: Me and Home read one answered rule (dish)", () => {
  it("a video sent after it does not answer a photo retake", async () => {
    const { p } = await retakeThenSend("video", "video")
    expect(await homeStatus(p)).toBe("open")
    expect(await meAnswered(p, "dish", dish.video)).toBe(false)
  })

  it("a replacement the manager asked again for leaves it open", async () => {
    const { p, q } = await retakeThenSend("asked")
    expect(await meAnswered(p, "dish", dish.asked)).toBe(true)
    await review(q, dish.asked, "better_photo_requested")
    expect(await homeStatus(p)).toBe("open")
    expect(await meAnswered(p, "dish", dish.asked)).toBe(false)
  })

  it("a replacement set aside as Not used leaves it open", async () => {
    const { p, q } = await retakeThenSend("unused")
    expect(await homeStatus(p)).toBe("retaken")
    await ok(
      w.manager.client.rpc("review_set_aside", {
        p_asset_id: q,
        p_action: "not_used",
        p_reason: "TEST not this one",
      })
    )
    expect(await homeStatus(p)).toBe("open")
    expect(await meAnswered(p, "dish", dish.unused)).toBe(false)
  })

  it("a replacement waiting for review answers it on both", async () => {
    const { p } = await retakeThenSend("waiting")
    expect(await homeStatus(p)).toBe("retaken")
    expect(await meAnswered(p, "dish", dish.waiting)).toBe(true)
  })

  it("an accepted replacement clears it on both", async () => {
    const { p, q } = await retakeThenSend("accepted")
    await review(q, dish.accepted, "accepted")
    expect(await homeStatus(p)).toBe("cleared")
    expect(await meAnswered(p, "dish", dish.accepted)).toBe(true)
  })
})

describe("W7: the same rule for a place photo", () => {
  it("is open while the replacement is asked again, answered while one waits", async () => {
    const p = await areaPhoto(garden)
    await decideArea(p, "needs_another_photo")
    const pin = (q: string) =>
      psql(
        `set session_replication_role = replica;
         update public.media_assets set created_at = (
           select max(d.decided_at) + interval '1 second' from public.area_photo_decisions d where d.asset_id = '${p}')
         where id = '${q}'`
      )
    const q = await areaPhoto(garden)
    pin(q)
    expect(await meAnswered(p, "area", garden)).toBe(true)
    await decideArea(q, "needs_another_photo")
    expect(await meAnswered(p, "area", garden)).toBe(false)
    const r = await areaPhoto(garden)
    pin(r)
    expect(await meAnswered(p, "area", garden)).toBe(true)
  })
})
