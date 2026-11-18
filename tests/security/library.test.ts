// S2-LIBRARY (spec §8 A4, §11, §16; AC13, AC21, AC32, AC35):
//   20261118116000  withdraw/restore, venue correction, controlled tags,
//                   collections, asset detail and library_page's A4 filters
// Every new function is called as staff at the venue, the venue's manager,
// another venue's manager, an admin, an admin without the second step, an
// inactive account and anon. Real signed-in identities through PostgREST;
// psql and the service role only build fixtures and read state back.
import { createHash, randomUUID } from "node:crypto"

import { beforeAll, describe, expect, it } from "vitest"

import {
  anonClient,
  createIdentity,
  createVenue,
  serviceClient,
  type TestIdentity,
} from "../support/identities"
import { makeManager, psql } from "./coverage-fixtures"
import { reserve, reserveReady } from "./menus-fixtures"

const service = serviceClient()

let venueA: string
let venueB: string
let admin: TestIdentity
let adminAal1: TestIdentity
let manager: TestIdentity
let managerB: TestIdentity
let staff: TestIdentity
let inactive: TestIdentity

type Rpc = { data: unknown; error: { message: string; code?: string } | null }
const rpc = (
  who: TestIdentity | null,
  fn: string,
  args: Record<string, unknown> = {}
) =>
  (who?.client ?? anonClient()).rpc(
    fn as never,
    args as never
  ) as unknown as Promise<Rpc>

async function ok<T = Record<string, unknown>>(call: Promise<Rpc>) {
  const { data, error } = await call
  expect(error).toBeNull()
  return data as T
}

async function refused(call: Promise<Rpc>, message?: string) {
  const { data, error } = await call
  expect(error).not.toBeNull()
  expect(data ?? null).toBeNull()
  if (message) expect(error?.message).toBe(message)
}

const ready = async (who: TestIdentity) => (await reserveReady(service, who)).id

/** A ready photo with real dimensions (ready assets are immutable). */
async function readySized(who: TestIdentity, width: number, height: number) {
  const { id } = await reserve(who)
  for (const patch of [
    { upload_state: "processing" as const },
    {
      upload_state: "ready" as const,
      validated_mime_type: "image/jpeg",
      size_bytes: 4,
      width,
      height,
    },
  ]) {
    const { error } = await service
      .from("media_assets")
      .update(patch)
      .eq("id", id)
    if (error) throw error
  }
  return id
}

const unique = (name: string) => `${name} ${Date.now().toString(36)}`

/** Every caller who is not an active aal2 admin. */
const outsiders = () => [staff, manager, managerB, inactive, adminAal1]

const page = async (who: TestIdentity, args: Record<string, unknown>) => {
  const { data, error } = await rpc(who, "library_page", {
    p_limit: 25,
    p_candidate_cap: 0,
    ...args,
  })
  expect(error).toBeNull()
  return ((data as { id: string }[]) ?? []).map((r) => r.id)
}

/**
 * Labels the asset with a new place at its venue as its uploader would, and
 * records a public acceptance by `deciderId`. Returns the place (slot) id.
 */
function acceptPlacePhoto(assetId: string, deciderId: string): string {
  return psql(
    `with a as (
       select id, venue_id, uploader_id from public.media_assets where id = '${assetId}'
     ), s as (
       insert into public.knowledge_subjects (venue_id, kind, label, created_by)
       select a.venue_id, 'area', 'Library ' || left(md5(random()::text), 8), '${deciderId}'
       from a returning id, venue_id, label
     ), l as (
       insert into public.media_area_labels (asset_id, venue_id, subject_id, subject_kind, subject_label, added_by)
       select a.id, s.venue_id, s.id, 'area', s.label, a.uploader_id
       from s, a returning id, venue_id, asset_id, subject_id
     ), d as (
       insert into public.area_photo_decisions (label_id, venue_id, asset_id, action, decided_by)
       select l.id, l.venue_id, l.asset_id, 'accepted', '${deciderId}' from l
       returning label_id
     )
     select l.subject_id from l join d on d.label_id = l.id`
  )
}

beforeAll(async () => {
  venueA = (await createVenue(service, "library-a")).id
  venueB = (await createVenue(service, "library-b")).id
  admin = await createIdentity(service, {
    label: "library-admin",
    role: "admin",
  })
  adminAal1 = await createIdentity(service, {
    label: "library-admin-aal1",
    role: "staff",
    venueId: venueA,
  })
  const promoted = await service
    .from("profiles")
    .update({ role: "admin", venue_id: null })
    .eq("id", adminAal1.id)
  if (promoted.error) throw promoted.error
  const person = (label: string, venueId: string) =>
    createIdentity(service, { label, role: "staff", venueId })
  manager = await person("library-mgr", venueA)
  managerB = await person("library-mgr-b", venueB)
  await makeManager(admin, manager, venueA)
  await makeManager(admin, managerB, venueB)
  staff = await person("library-staff", venueA)
  inactive = await createIdentity(service, {
    label: "library-inactive",
    role: "staff",
    venueId: venueA,
    active: false,
  })
})

describe("access: admins only", () => {
  it("refuses every new function to anon, staff, managers, inactive accounts and an aal1 admin", async () => {
    const asset = await ready(staff)
    const calls: [string, Record<string, unknown>][] = [
      ["library_tags", {}],
      ["library_tag_save", { p_tag_id: null, p_name: "Nope" }],
      [
        "library_asset_tag",
        {
          p_asset_ids: [asset],
          p_tag_id: "00000000-0000-0000-0000-000000000000",
          p_add: true,
        },
      ],
      ["library_collections", {}],
      ["library_collection_save", { p_collection_id: null, p_name: "Nope" }],
      [
        "library_collection_set_items",
        {
          p_collection_id: "00000000-0000-0000-0000-000000000000",
          p_asset_ids: [asset],
          p_add: true,
        },
      ],
      ["library_filter_lists", {}],
      ["library_asset_detail", { p_asset_id: asset }],
      ["library_withdraw_asset", { p_asset_id: asset, p_reason: "Not ours" }],
      ["library_restore_asset", { p_asset_id: asset, p_reason: "Back again" }],
      [
        "admin_correct_asset_venue",
        { p_asset_id: asset, p_venue_id: venueB, p_reason: "Wrong pub" },
      ],
    ]
    for (const [fn, args] of calls) {
      await refused(rpc(null, fn, args))
      for (const who of outsiders()) {
        await refused(rpc(who, fn, args), "not_permitted")
      }
    }
    // Nothing was written by any refused call.
    expect(
      psql(
        `select count(*) from public.media_asset_withdrawals where asset_id = '${asset}'`
      )
    ).toBe("0")
  })

  it("gives non-admins nothing through the library_page record filters", async () => {
    const asset = await ready(staff)
    const collection = await ok<{ id: string }>(
      rpc(admin, "library_collection_save", {
        p_collection_id: null,
        p_name: "Access check",
      })
    )
    await ok(
      rpc(admin, "library_collection_set_items", {
        p_collection_id: collection.id,
        p_asset_ids: [asset],
        p_add: true,
      })
    )
    expect(await page(admin, { p_collection: collection.id })).toEqual([asset])
    // Staff and managers read the library through RLS; the record filter
    // answers no ids for them.
    expect(await page(staff, { p_collection: collection.id })).toEqual([])
    expect(await page(manager, { p_collection: collection.id })).toEqual([])
    expect(await page(managerB, { p_review: "unreviewed" })).not.toContain(
      asset
    )
  })
})

describe("controlled tags", () => {
  it("creates, applies, retires and removes tags with history", async () => {
    const asset = await ready(staff)
    const name = unique("Christmas")
    const tag = await ok<{ id: string; revision: number }>(
      rpc(admin, "library_tag_save", {
        p_tag_id: null,
        p_name: ` ${name.replace(" ", "  ")} `,
      })
    )
    await refused(
      rpc(admin, "library_tag_save", {
        p_tag_id: null,
        p_name: name.toLowerCase(),
      }),
      "tag_name_taken"
    )
    await refused(
      rpc(admin, "library_tag_save", { p_tag_id: null, p_name: "" }),
      "tag_name_invalid"
    )
    const added = await ok<{ changed: number }>(
      rpc(admin, "library_asset_tag", {
        p_asset_ids: [asset],
        p_tag_id: tag.id,
        p_add: true,
      })
    )
    expect(added.changed).toBe(1)
    // Adding again changes nothing.
    expect(
      (
        await ok<{ changed: number }>(
          rpc(admin, "library_asset_tag", {
            p_asset_ids: [asset],
            p_tag_id: tag.id,
            p_add: true,
          })
        )
      ).changed
    ).toBe(0)
    expect(await page(admin, { p_tag: tag.id })).toEqual([asset])

    const tags = await ok<{ id: string; name: string; assetCount: number }[]>(
      rpc(admin, "library_tags")
    )
    expect(tags.find((t) => t.id === tag.id)).toMatchObject({
      name,
      assetCount: 1,
    })

    // A stale revision is a conflict; a retired tag cannot be added.
    await refused(
      rpc(admin, "library_tag_save", {
        p_tag_id: tag.id,
        p_name: name,
        p_active: false,
        p_expected_revision: tag.revision + 5,
      }),
      "tag_conflict"
    )
    await ok(
      rpc(admin, "library_tag_save", {
        p_tag_id: tag.id,
        p_name: name,
        p_active: false,
        p_expected_revision: tag.revision,
      })
    )
    const other = await ready(staff)
    await refused(
      rpc(admin, "library_asset_tag", {
        p_asset_ids: [other],
        p_tag_id: tag.id,
        p_add: true,
      }),
      "tag_retired"
    )
    // Removing still works on a retired tag.
    await ok(
      rpc(admin, "library_asset_tag", {
        p_asset_ids: [asset],
        p_tag_id: tag.id,
        p_add: false,
      })
    )
    expect(await page(admin, { p_tag: tag.id })).toEqual([])
    expect(
      psql(
        `select string_agg(action, ',' order by id) from public.library_tag_events where tag_id = '${tag.id}'`
      )
    ).toBe("created,added,retired,removed")
  })
})

describe("collections", () => {
  it("references assets; removing one keeps the original", async () => {
    const a1 = await ready(staff)
    const a2 = await ready(staff)
    const c = await ok<{ id: string; revision: number }>(
      rpc(admin, "library_collection_save", {
        p_collection_id: null,
        p_name: "Christmas menu",
        p_purpose: "Website and social, December",
      })
    )
    await ok(
      rpc(admin, "library_collection_set_items", {
        p_collection_id: c.id,
        p_asset_ids: [a1, a2],
        p_add: true,
      })
    )
    expect((await page(admin, { p_collection: c.id })).sort()).toEqual(
      [a1, a2].sort()
    )
    await ok(
      rpc(admin, "library_collection_set_items", {
        p_collection_id: c.id,
        p_asset_ids: [a1],
        p_add: false,
      })
    )
    expect(await page(admin, { p_collection: c.id })).toEqual([a2])
    // The original is untouched.
    expect(
      psql(
        `select (deleted_at is null)::text from public.media_assets where id = '${a1}'`
      )
    ).toBe("true")
    const list = await ok<
      { id: string; assetCount: number; venues: { venueId: string }[] }[]
    >(rpc(admin, "library_collections"))
    expect(list.find((x) => x.id === c.id)).toMatchObject({
      assetCount: 1,
      venues: [expect.objectContaining({ venueId: venueA })],
    })
    // Archived: hidden by default, refuses additions.
    await ok(
      rpc(admin, "library_collection_save", {
        p_collection_id: c.id,
        p_name: "Christmas menu",
        p_archived: true,
      })
    )
    expect(
      (await ok<{ id: string }[]>(rpc(admin, "library_collections"))).some(
        (x) => x.id === c.id
      )
    ).toBe(false)
    await refused(
      rpc(admin, "library_collection_set_items", {
        p_collection_id: c.id,
        p_asset_ids: [a1],
        p_add: true,
      }),
      "collection_archived"
    )
  })
})

describe("withdraw and restore", () => {
  it("stops export and primary selection, then restores them", async () => {
    const asset = await ready(staff)
    const subject = acceptPlacePhoto(asset, manager.id)
    const inExport = async () => {
      const data = await ok<{ items: { assetId: string }[] }>(
        rpc(manager, "export_candidates", {
          p_venue_id: venueA,
          p_mode: "public",
        })
      )
      return data.items.some((i) => i.assetId === asset)
    }
    expect(await inExport()).toBe(true)

    await refused(
      rpc(admin, "library_withdraw_asset", {
        p_asset_id: asset,
        p_reason: "x",
      }),
      "reason_required"
    )
    const w = await ok<{ changed: boolean }>(
      rpc(admin, "library_withdraw_asset", {
        p_asset_id: asset,
        p_reason: "Shows a guest's face",
      })
    )
    expect(w.changed).toBe(true)
    expect(await inExport()).toBe(false)
    expect(
      psql(`select private.library_is_withdrawn('${asset}')::text`)
    ).toBe("true")
    // Not in the default (active) library; in the withdrawn filter.
    expect(await page(admin, { p_venue: venueA })).not.toContain(asset)
    expect(
      await page(admin, { p_venue: venueA, p_withdrawn: "withdrawn" })
    ).toContain(asset)
    expect(
      await page(admin, { p_venue: venueA, p_withdrawn: "all" })
    ).toContain(asset)
    // Cannot become a primary photo.
    await refused(
      rpc(admin, "set_slot_primary_photo", {
        p_slot_kind: "area",
        p_slot_id: subject,
        p_asset_id: asset,
      }),
      "asset_withdrawn"
    )

    const r = await ok<{ changed: boolean }>(
      rpc(admin, "library_restore_asset", {
        p_asset_id: asset,
        p_reason: "Cropped copy agreed",
      })
    )
    expect(r.changed).toBe(true)
    expect(await inExport()).toBe(true)
    await ok(
      rpc(admin, "set_slot_primary_photo", {
        p_slot_kind: "area",
        p_slot_id: subject,
        p_asset_id: asset,
      })
    )
    expect(
      psql(
        `select string_agg(action, ',' order by id) from public.media_asset_withdrawal_events where asset_id = '${asset}'`
      )
    ).toBe("withdrawn,restored")
    expect(
      psql(
        `select count(*) from public.activity_events where object_id = '${asset}' and action like 'library\\_%'`
      )
    ).toBe("2")
  })
})

describe("library_page fast paths", () => {
  it("keeps a withdrawn photo out of the labelled/unlabelled set page", async () => {
    const asset = await ready(staff)
    await ok(
      rpc(admin, "library_withdraw_asset", {
        p_asset_id: asset,
        p_reason: "Not for use",
      })
    )
    const unlabelled = (extra: Record<string, unknown>) =>
      page(admin, {
        p_venue: venueA,
        p_label_state: "unlabelled",
        p_candidate_cap: 3000,
        ...extra,
      })
    expect(await unlabelled({})).not.toContain(asset)
    expect(await unlabelled({ p_withdrawn: "all" })).toContain(asset)
    expect(await unlabelled({ p_withdrawn: "withdrawn" })).toContain(asset)
  })
})

describe("venue correction (spec §11)", () => {
  it("keeps the original declaration, records the correction and suspends use", async () => {
    const asset = await ready(staff)
    acceptPlacePhoto(asset, manager.id)
    await refused(
      rpc(admin, "admin_correct_asset_venue", {
        p_asset_id: asset,
        p_venue_id: venueA,
        p_reason: "Same venue",
      }),
      "venue_unchanged"
    )
    await refused(
      rpc(admin, "admin_correct_asset_venue", {
        p_asset_id: asset,
        p_venue_id: venueB,
        p_reason: "",
      }),
      "reason_required"
    )
    const c = await ok<{ declaredVenueId: string; correctedVenueId: string }>(
      rpc(admin, "admin_correct_asset_venue", {
        p_asset_id: asset,
        p_venue_id: venueB,
        p_reason: "Taken at the other pub",
      })
    )
    expect(c).toMatchObject({
      declaredVenueId: venueA,
      correctedVenueId: venueB,
    })
    expect(
      psql(`select venue_id from public.media_assets where id = '${asset}'`)
    ).toBe(venueA)
    expect(
      psql(`select private.library_is_withdrawn('${asset}')::text`)
    ).toBe("true")
    // The same correction again is refused.
    await refused(
      rpc(admin, "admin_correct_asset_venue", {
        p_asset_id: asset,
        p_venue_id: venueB,
        p_reason: "Again",
      }),
      "venue_unchanged"
    )
    const detail = await ok<{
      corrections: { correctedVenueId: string }[]
      withdrawal: { reason: string } | null
    }>(rpc(admin, "library_asset_detail", { p_asset_id: asset }))
    expect(detail.corrections[0]?.correctedVenueId).toBe(venueB)
    expect(detail.withdrawal?.reason).toMatch(/^Venue corrected: /)
  })
})

describe("asset detail and filters", () => {
  it("shows provenance, slots with primary, eligibility and duplicates", async () => {
    const asset = await readySized(staff, 1600, 1200)
    const subject = acceptPlacePhoto(asset, manager.id)
    const detail = await ok<{
      asset: { id: string; venueId: string; uploaderId: string }
      review: string
      exportEligible: boolean
      slots: {
        kind: string
        slotId: string
        state: string
        isPrimary: boolean
      }[]
      exports: { packages: unknown[] } | null
      duplicates: unknown[]
    }>(rpc(admin, "library_asset_detail", { p_asset_id: asset }))
    expect(detail.asset).toMatchObject({
      id: asset,
      venueId: venueA,
      uploaderId: staff.id,
    })
    expect(detail.review).toBe("public")
    expect(detail.exportEligible).toBe(true)
    expect(detail.slots).toEqual([
      expect.objectContaining({
        kind: "area",
        slotId: subject,
        state: "public",
        isPrimary: true,
      }),
    ])
    expect(detail.exports?.packages).toEqual([])
    expect(detail.duplicates).toEqual([])

    expect(
      await page(admin, { p_venue: venueA, p_review: "public" })
    ).toContain(asset)
    expect(
      await page(admin, { p_venue: venueA, p_review: "unreviewed" })
    ).not.toContain(asset)
    expect(
      await page(admin, { p_venue: venueA, p_orientation: "landscape" })
    ).toContain(asset)
    expect(
      await page(admin, { p_venue: venueA, p_orientation: "portrait" })
    ).not.toContain(asset)
  })

  it("finds the same file across venues and filters by capture date", async () => {
    const a = await ready(staff)
    const b = await ready(managerB)
    const hash = createHash("sha256").update(randomUUID()).digest("hex")
    psql(
      `update public.media_assets set content_sha256 = '${hash}', captured_at = '2026-06-01T12:00:00Z', captured_at_source = 'metadata' where id in ('${a}', '${b}')`
    )
    const detail = await ok<{
      duplicates: { assetId: string; relation: string }[]
    }>(rpc(admin, "library_asset_detail", { p_asset_id: a }))
    expect(detail.duplicates).toEqual([
      expect.objectContaining({ assetId: b, relation: "same_file" }),
    ])
    expect(
      await page(admin, {
        p_venue: venueA,
        p_captured_from: "2026-06-01T00:00:00Z",
        p_captured_to: "2026-06-02T00:00:00Z",
      })
    ).toEqual([a])
    expect(
      await page(admin, {
        p_venue: venueA,
        p_captured_from: "2026-07-01T00:00:00Z",
      })
    ).toEqual([])
  })

  it("refuses an unknown asset", async () => {
    await refused(
      rpc(admin, "library_asset_detail", {
        p_asset_id: "00000000-0000-0000-0000-000000000000",
      }),
      "media_asset_not_found"
    )
  })
})
