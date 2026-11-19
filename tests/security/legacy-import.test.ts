// S5-IMPORT (FA-54; 20261118135000_legacy_import.sql and
// 20261118135100_legacy_import_reads.sql): the legacy importer
// (scripts/import/legacy-import.ts) run against the local stack. Dry run
// writes nothing; --apply imports as awaiting review with provenance, the
// manifest or metadata capture time (else unknown), staged labels for an
// exact dish, place or amenity match and a note otherwise; exact duplicates
// are skipped and recorded with their own attribution; a rerun changes
// nothing; the Library filters by batch. The import functions are service
// role only and the batch tables admin-read only. Real signed-in identities
// read the results; the service role runs the importer, as the script does.
import { createHash, randomUUID } from "node:crypto"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { runLegacyImport } from "../../scripts/import/legacy-import"
import { syntheticJpeg } from "../slice/media-actor"
import { createIdentity, type TestIdentity } from "../support/identities"
import { insertAsset, ok, psql } from "./coverage-fixtures"
import { call, service, world, type World } from "./knowledge-fixtures"
import { item, menu, publishMenu, section } from "./menus-fixtures"

const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex")

type AssetRow = {
  id: string
  uploader_id: string
  provenance: string
  import_batch_id: string | null
  upload_state: string
  content_sha256: string | null
  captured_at: string | null
  captured_at_source: string
  thumbnail_path: string | null
}

let w: World
let folder: string
let manifest: string
let place: string
let dish: string
let existing: string
let aalOneAdmin: TestIdentity
let otherManager: TestIdentity
const bytes: Record<string, Uint8Array> = {}

const run = (apply: boolean, text = manifest) =>
  runLegacyImport({
    service,
    folder,
    manifest: text,
    label: "TEST legacy batch",
    adminEmail: w.admin.email,
    apply,
  })

const assetsOfBatch = async (batch: string) =>
  (await ok(
    service
      .from("media_assets")
      .select(
        "id, uploader_id, provenance, import_batch_id, upload_state, content_sha256, captured_at, captured_at_source, thumbnail_path"
      )
      .eq("import_batch_id", batch)
      .is("deleted_at", null)
  )) as AssetRow[]

const byHash = (rows: AssetRow[], file: string) =>
  rows.find((r) => r.content_sha256 === sha(bytes[file]!))!

beforeAll(async () => {
  w = await world(`legacy-${randomUUID().slice(0, 8)}`)
  const slug = (
    (await ok(
      service.from("venues").select("slug").eq("id", w.venue).single()
    )) as { slug: string }
  ).slug

  // A current dish, place and amenity at the venue.
  await publishMenu(
    w.admin,
    w.venue,
    menu("TEST legacy menu", [
      section("mains", "Mains", [
        item("mains--fish", "Fish and chips", { aliases: ["Cod & chips"] }),
        item("mains--pie", "Steak pie"),
      ]),
    ])
  )
  dish = psql(
    `select distinct e.item_id from public.menu_entries e where e.venue_id = '${w.venue}' and e.source_key = 'mains--fish'`
  )
  place = psql(
    `insert into public.knowledge_subjects (venue_id, kind, label, created_by)
     values ('${w.venue}', 'area', 'Beer garden', '${w.admin.id}') returning id`
  )

  for (const name of ["dish", "place", "amenity", "mystery", "existing"]) {
    bytes[name] = await syntheticJpeg(320, 240)
  }
  // A photo already in the app at this venue with the same bytes as one file.
  const prior = await insertAsset(service, {
    uploader: w.staffB.id,
    venue: w.venue,
  })
  existing = prior.id
  psql(
    `update public.media_assets set content_sha256 = '${sha(bytes.existing!)}' where id = '${existing}'`
  )

  folder = await mkdtemp(join(tmpdir(), "nabalens-legacy-"))
  await writeFile(join(folder, "dish.jpg"), bytes.dish!)
  await writeFile(join(folder, "copy-of-dish.jpg"), bytes.dish!)
  await writeFile(join(folder, "place.jpg"), bytes.place!)
  await writeFile(join(folder, "amenity.jpg"), bytes.amenity!)
  await writeFile(join(folder, "mystery.jpg"), bytes.mystery!)
  await writeFile(join(folder, "existing.jpg"), bytes.existing!)
  await writeFile(join(folder, "notes.txt"), "not a photo")

  manifest = [
    "file,venue,contributor_email,capture_date,legacy_label,legacy_folder",
    `dish.jpg,${slug},${w.staffA.email},2019-06-01,Fish & Chips,Approved`,
    `place.jpg,${w.venue},${w.staffB.email},,beer garden,Approved`,
    `amenity.jpg,${slug},,,Guest toilets,`,
    `mystery.jpg,${slug},,,Old menu shot,Approved`,
    `copy-of-dish.jpg,${slug},${w.staffB.email},,Fish & Chips,Old`,
    `existing.jpg,${slug},,,,`,
    `notes.txt,${slug},,,,`,
    `dish.jpg,no-such-venue,,,,`,
  ].join("\n")

  // An admin without the second factor, and a manager of another venue.
  aalOneAdmin = await createIdentity(service, {
    label: "legacy-aal1",
    role: "staff",
    venueId: w.venue,
  })
  await ok(
    service
      .from("profiles")
      .update({ role: "admin", venue_id: null })
      .eq("id", aalOneAdmin.id)
  )
  otherManager = (await world(`legacy-other-${randomUUID().slice(0, 8)}`))
    .manager
}, 180_000)

afterAll(async () => {
  if (folder) await rm(folder, { recursive: true, force: true })
})

describe("legacy import", () => {
  let batch: string

  it("uses the manifest row's venue timezone for offsetless EXIF", async () => {
    const local = await world("legacy-capture-time-zone")
    await ok(
      service
        .from("venues")
        .update({ timezone: "America/New_York" })
        .eq("id", local.venue)
    )
    const file = "local-camera-time.jpg"
    await writeFile(
      join(folder, file),
      await syntheticJpeg(320, 240, "2026:07:10 12:00:00")
    )
    const report = await run(true, `file,venue\n${file},${local.venue}`)
    expect(report.counts, JSON.stringify(report.rows)).toMatchObject({
      imported: 1,
      failed: 0,
    })
    expect(report.rows[0]).toMatchObject({
      capturedAt: "2026-07-10T16:00:00.000Z",
      capturedSource: "metadata",
    })
    expect((await assetsOfBatch(report.batchId!))[0]).toMatchObject({
      captured_at: "2026-07-10T16:00:00+00:00",
      captured_at_source: "metadata",
    })
  })

  it("dry run reports and writes nothing", async () => {
    const report = await run(false)
    expect(report.batchId).toBeNull()
    expect(report.counts).toMatchObject({
      would_import: 4,
      would_skip_duplicate: 2,
      failed: 2,
      imported: 0,
      duplicate: 0,
    })
    const line = (n: number) => report.rows.find((r) => r.line === n)!
    expect(line(2).capturedSource).toBe("supplied")
    expect(line(2).labelMatch).toBe(`dish:${dish}`)
    expect(line(3).labelMatch).toBe(`place:${place}`)
    expect(line(4).labelMatch).toBe(`amenity:${w.checks.guest_toilets}`)
    expect(line(5).labelMatch).toMatch(/kept as note/)
    expect(line(6).duplicateOf).toBe("line 2")
    expect(line(7).duplicateOf).toBe(existing)
    expect(line(8).detail).toBe("not a supported photo or video")
    expect(line(9).detail).toBe("venue not found")
    expect(
      psql(
        `select count(*) from public.media_import_batches where manifest_sha256 = '${report.manifestSha256}'`
      )
    ).toBe("0")
    expect(
      psql(
        `select count(*) from public.media_assets where venue_id = '${w.venue}' and provenance = 'legacy_import'`
      )
    ).toBe("0")
  })

  it("apply imports awaiting review, skips duplicates, keeps unknown dates", async () => {
    const report = await run(true)
    expect(report.counts, JSON.stringify(report.rows)).toMatchObject({
      imported: 4,
      duplicate: 2,
      failed: 2,
    })
    batch = report.batchId!
    const assets = await assetsOfBatch(batch)
    expect(assets).toHaveLength(4)
    for (const a of assets) {
      expect(a.provenance).toBe("legacy_import")
      expect(a.upload_state).toBe("ready")
      expect(a.thumbnail_path).not.toBeNull()
    }

    const dishAsset = byHash(assets, "dish")
    // The contributor (active staff) holds it; capture date from the manifest.
    expect(dishAsset.uploader_id).toBe(w.staffA.id)
    expect(dishAsset.captured_at_source).toBe("supplied")
    expect(new Date(dishAsset.captured_at!).toISOString()).toBe(
      "2019-06-01T11:00:00.000Z"
    )
    // The contributor holds this place photo too. It has no capture date.
    const placeAsset = byHash(assets, "place")
    expect(placeAsset.uploader_id).toBe(w.staffB.id)
    expect(placeAsset.captured_at).toBeNull()
    expect(placeAsset.captured_at_source).toBe("unknown")

    // Staged labels: dish label item, place label, amenity on the item.
    expect(
      psql(
        `select item_id from public.media_label_items where asset_id = '${dishAsset.id}'`
      )
    ).toBe(dish)
    expect(
      psql(
        `select subject_id from public.media_area_labels where asset_id = '${placeAsset.id}' and removed_at is null`
      )
    ).toBe(place)
    const amenityAsset = byHash(assets, "amenity")
    expect(
      psql(
        `select staged_kind || ':' || staged_id from public.media_import_items where asset_id = '${amenityAsset.id}'`
      )
    ).toBe(`amenity:${w.checks.guest_toilets}`)
    // No match: unlabelled, the legacy label kept as the note.
    const mysteryAsset = byHash(assets, "mystery")
    expect(mysteryAsset.uploader_id).toBe(w.admin.id)
    expect(
      psql(
        `select coalesce(has_labels::text, 'none') || '|' || note from public.media_labels where asset_id = '${mysteryAsset.id}'`
      )
    ).toBe("false|Imported. Legacy label: Old menu shot")

    // Never accepted, whatever the legacy folder said.
    const ids = assets.map((a) => `'${a.id}'`).join(",")
    expect(
      psql(
        `select (select count(*) from public.menu_item_photos where asset_id in (${ids}))
          + (select count(*) from public.area_photo_decisions where asset_id in (${ids}))
          + (select count(*) from public.amenity_photo_decisions where asset_id in (${ids}))`
      )
    ).toBe("0")

    // Duplicates: recorded against the earlier asset, with their own
    // contributor (both attributions kept); no new asset for them.
    expect(
      psql(
        `select outcome || '|' || asset_id || '|' || coalesce(contributor_id::text, '') || '|' || legacy_folder
         from public.media_import_items where batch_id = '${batch}' and line_no = 6`
      )
    ).toBe(`duplicate|${dishAsset.id}|${w.staffB.id}|Old`)
    expect(
      psql(
        `select outcome || '|' || asset_id from public.media_import_items where batch_id = '${batch}' and line_no = 7`
      )
    ).toBe(`duplicate|${existing}`)
  })

  it("imports wait in the manager's review queues", async () => {
    const assets = await assetsOfBatch(batch)
    const queue = async (fn: string, args: object) =>
      (
        (await ok(call(w.manager, fn, args) as never)) as { asset_id: string }[]
      ).map((r) => r.asset_id)
    expect(
      await queue("manager_menu_photo_queue", {
        p_venue_id: w.venue,
        p_status: "pending",
      })
    ).toContain(byHash(assets, "dish").id)
    const placeAsset = byHash(assets, "place")
    const places = await ok(
      w.manager.client.rpc("area_photo_queue", {
        p_venue_id: w.venue,
        p_status: "pending",
      })
    )
    const pendingPlace = places.find((r) => r.asset_id === placeAsset.id)
    expect(pendingPlace).toMatchObject({
      asset_id: placeAsset.id,
      state: "pending",
    })
    const [placeDecision] = await ok(
      w.manager.client.rpc("decide_area_photo_level", {
        p_label_id: pendingPlace!.label_id,
        p_action: "accepted",
        p_level: "public",
      })
    )
    expect(placeDecision).toMatchObject({ state: "accepted" })
    expect(
      psql(
        `select created_by from public.media_import_batches where id = '${batch}'`
      )
    ).toBe(w.admin.id)
    expect(
      await queue("amenity_photo_queue", { p_venue_id: w.venue })
    ).toContain(byHash(assets, "amenity").id)
    // Unlabelled at once (no 7-day Match later wait for an import), with
    // its own reason.
    const unlabelled = (await ok(
      call(w.manager, "manager_menu_photo_queue", {
        p_venue_id: w.venue,
        p_status: "unlabelled",
      }) as never
    )) as { asset_id: string; unlabelled_reason: string }[]
    expect(
      unlabelled.find((r) => r.asset_id === byHash(assets, "mystery").id)
        ?.unlabelled_reason
    ).toBe("imported")
  })

  it("re-applying the same manifest changes nothing", async () => {
    const before = psql(
      `select count(*) || '|' || (select count(*) from public.media_import_items where batch_id = '${batch}')
       from public.media_assets where venue_id = '${w.venue}'`
    )
    const report = await run(true)
    expect(report.batchId).toBe(batch)
    expect(report.counts).toMatchObject({
      unchanged: 6,
      failed: 2,
      imported: 0,
      duplicate: 0,
    })
    expect(
      psql(
        `select count(*) || '|' || (select count(*) from public.media_import_items where batch_id = '${batch}')
         from public.media_assets where venue_id = '${w.venue}'`
      )
    ).toBe(before)
    // And a dry run of it now has nothing to do.
    const dry = await run(false)
    expect(dry.counts.would_import).toBe(0)
    expect(dry.counts.unchanged).toBe(6)
  })

  it("the Library filters by import batch (admin)", async () => {
    const assets = await assetsOfBatch(batch)
    const page = (await ok(
      call(w.admin, "library_page", { p_import: batch, p_limit: 25 }) as never
    )) as { id: string }[]
    expect(page.map((r) => r.id).sort()).toEqual(assets.map((a) => a.id).sort())
    const lists = (await ok(
      call(w.admin, "library_filter_lists", {}) as never
    )) as { imports: { id: string; name: string; imported: number }[] }
    expect(lists.imports).toContainEqual(
      expect.objectContaining({
        id: batch,
        name: "TEST legacy batch",
        imported: 4,
      })
    )
  })

  it("import functions are service role only; batches are admin-read only", async () => {
    for (const who of [w.staffA, w.manager, w.admin]) {
      const { error } = await call(who, "legacy_import_begin", {
        p_admin: w.admin.id,
        p_manifest_sha256: "a".repeat(64),
        p_label: "TEST",
      })
      expect(error?.code).toBe("42501")
      const ctx = await call(who, "legacy_import_context", {
        p_admin_email: w.admin.email,
      })
      expect(ctx.error?.code).toBe("42501")
    }
    for (const who of [w.staffA, w.manager, otherManager, aalOneAdmin]) {
      const items = (await ok(
        who.client.from("media_import_items").select("id").eq("batch_id", batch)
      )) as unknown[]
      expect(items).toEqual([])
      const batches = (await ok(
        who.client.from("media_import_batches").select("id").eq("id", batch)
      )) as unknown[]
      expect(batches).toEqual([])
      const page = await call(who, "library_page", { p_import: batch })
      expect((page.data as unknown[] | null) ?? []).toEqual([])
    }
    const items = (await ok(
      w.admin.client
        .from("media_import_items")
        .select("id")
        .eq("batch_id", batch)
    )) as unknown[]
    expect(items).toHaveLength(6)
    // Nobody signed in can write the tables directly.
    const { error } = await w.admin.client
      .from("media_import_batches")
      .update({ label: "changed" })
      .eq("id", batch)
      .select("id")
    // Update privilege is revoked from authenticated (42501).
    expect(error?.code).toBe("42501")
    expect(
      psql(
        `select label from public.media_import_batches where id = '${batch}'`
      )
    ).toBe("TEST legacy batch")
  })

  it("an import needs an active admin, and provenance never changes", async () => {
    await expect(
      runLegacyImport({
        service,
        folder,
        manifest: `${manifest}\n`,
        label: "TEST",
        adminEmail: w.staffA.email,
        apply: true,
      })
    ).rejects.toThrow(/active admin/)
    const assets = await assetsOfBatch(batch)
    const { error } = await service
      .from("media_assets")
      .update({ provenance: "upload", import_batch_id: null })
      .eq("id", assets[0]!.id)
    expect(error?.message).toBe("media_provenance_fixed")
  })
})
