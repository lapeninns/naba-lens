// S5-R3 (S5 review Y5 and Y6; 20261118138000_legacy_import_amenity_scope.sql
// and 20261118138100_legacy_import_retry.sql), run against the local stack.
//
// Y5: an import labelled with an amenity that is off the venue's working list
// is not staged on it (the script does not offer it and
// legacy_import_complete refuses it) and waits in Needs label; an import
// staged on an in-scope amenity moves to Needs label when the question leaves
// the working list or its check is archived, and back when it returns.
//
// Y6: a line that failed after its reservation is imported by a rerun of the
// same manifest after the 24-hour cleanup tombstoned that reservation (at the
// line's next attempt id); a live leftover reservation is reused; a rerun
// after that changes nothing; the tombstoned row is refused by
// legacy_import_reserve.
import { createHash, randomUUID } from "node:crypto"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { mediaObjectKeys, STORAGE_BUCKETS } from "../../lib/config/storage"
import { runMediaCleanup } from "../../lib/server/lifecycle/cleanup"
import {
  importAssetId,
  runLegacyImport,
} from "../../scripts/import/legacy-import"
import { syntheticJpeg } from "../slice/media-actor"
import { ok, psql } from "./coverage-fixtures"
import { call, json, service, world, type World } from "./knowledge-fixtures"

const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex")

let w: World
let slug: string
let folder: string
const bytes: Record<string, Uint8Array> = {}

const run = (manifest: string, apply = true) =>
  runLegacyImport({
    service,
    folder,
    manifest,
    label: "TEST legacy repairs",
    adminEmail: w.admin.email,
    apply,
  })

const assetOf = (file: string) =>
  psql(
    `select id from public.media_assets where venue_id = '${w.venue}' and content_sha256 = '${sha(bytes[file]!)}'
       and provenance = 'legacy_import' and deleted_at is null and upload_state = 'ready'`
  )

const queue = async (status: "unlabelled") =>
  (await ok(
    call(w.manager, "manager_menu_photo_queue", {
      p_venue_id: w.venue,
      p_status: status,
    }) as never
  )) as { asset_id: string; unlabelled_reason: string }[]

const amenityQueue = async () =>
  (
    (await ok(
      call(w.manager, "amenity_photo_queue", { p_venue_id: w.venue }) as never
    )) as { asset_id: string }[]
  ).map((r) => r.asset_id)

const setWorkingList = (key: string, enabled: boolean) =>
  json(w.admin, "knowledge_set_working_list", {
    p_venue_id: w.venue,
    p_keys: [key],
    p_enabled: enabled,
    p_reason: "TEST S5-R3",
  })

beforeAll(async () => {
  // outdoor_seating has a check at the venue but is off its working list.
  w = await world(`legacy-r3-${randomUUID().slice(0, 8)}`, {
    extra: ["outdoor_seating"],
  })
  slug = (
    (await ok(
      service.from("venues").select("slug").eq("id", w.venue).single()
    )) as { slug: string }
  ).slug
  for (const name of ["offlist", "toilets", "retry", "leftover", "direct"])
    bytes[name] = await syntheticJpeg(320, 240)
  folder = await mkdtemp(join(tmpdir(), "nabalens-legacy-r3-"))
  for (const name of Object.keys(bytes))
    await writeFile(join(folder, `${name}.jpg`), bytes[name]!)
}, 180_000)

afterAll(async () => {
  if (folder) await rm(folder, { recursive: true, force: true })
})

describe("Y5: amenity-staged imports always reach a review queue", () => {
  let toilets: string

  it("an off-list amenity is not offered; the photo waits in Needs label", async () => {
    expect(
      psql(
        `select private.knowledge_in_scope('${w.venue}', 'outdoor_seating')::text`
      )
    ).toBe("false")
    const manifest = [
      "file,venue,legacy_label",
      `offlist.jpg,${slug},Outdoor seating`,
      `toilets.jpg,${slug},Guest toilets`,
    ].join("\n")

    const dry = await run(manifest, false)
    const line = (n: number) => dry.rows.find((r) => r.line === n)!
    expect(line(2).labelMatch).toMatch(/no current subject; kept as note/)
    expect(line(3).labelMatch).toBe(`amenity:${w.checks.guest_toilets}`)

    const report = await run(manifest)
    expect(report.counts, JSON.stringify(report.rows)).toMatchObject({
      imported: 2,
      failed: 0,
    })
    const offlist = assetOf("offlist")
    toilets = assetOf("toilets")
    expect(
      psql(
        `select coalesce(staged_kind, 'none') from public.media_import_items where asset_id = '${offlist}'`
      )
    ).toBe("none")
    expect(
      psql(`select note from public.media_labels where asset_id = '${offlist}'`)
    ).toBe("Imported. Legacy label: Outdoor seating")
    const unlabelled = await queue("unlabelled")
    expect(
      unlabelled.find((r) => r.asset_id === offlist)?.unlabelled_reason
    ).toBe("imported")
    // The in-scope amenity: in the amenity queue, not in Needs label.
    expect(await amenityQueue()).toContain(toilets)
    expect(unlabelled.map((r) => r.asset_id)).not.toContain(toilets)
  })

  it("legacy_import_complete refuses to stage an off-list amenity", async () => {
    const batch = (await ok(
      service.rpc("legacy_import_begin", {
        p_admin: w.admin.id,
        p_manifest_sha256: sha(new TextEncoder().encode(randomUUID())),
        p_label: "TEST direct",
      })
    )) as string
    const assetId = importAssetId(batch, 2)
    await ok(
      service.rpc("legacy_import_reserve", {
        p_batch_id: batch,
        p_asset_id: assetId,
        p_uploader: w.admin.id,
        p_venue_id: w.venue,
        p_media_type: "image",
        p_extension: "jpg",
        p_original_filename: "direct.jpg",
        p_size_bytes: bytes.direct!.byteLength,
      })
    )
    const done = (await ok(
      service.rpc("legacy_import_complete", {
        p_admin: w.admin.id,
        p_asset_id: assetId,
        p_line_no: 2,
        p_file_path: "direct.jpg",
        p_validated_mime_type: "image/jpeg",
        p_size_bytes: bytes.direct!.byteLength,
        p_content_sha256: sha(bytes.direct!),
        p_captured_source: "unknown",
        p_width: 320,
        p_height: 240,
        p_legacy_label: "Outdoor seating",
        p_staged_kind: "amenity",
        p_staged_id: w.checks.outdoor_seating,
      })
    )) as { outcome: string; staged_kind: string | null }[]
    expect(done[0]).toMatchObject({ outcome: "imported", staged_kind: null })
    expect(
      (await queue("unlabelled")).find((r) => r.asset_id === assetId)
        ?.unlabelled_reason
    ).toBe("imported")
    expect(await amenityQueue()).not.toContain(assetId)
  })

  it("leaving the working list moves a staged import to Needs label, and back", async () => {
    await setWorkingList("guest_toilets", false)
    expect(await amenityQueue()).not.toContain(toilets)
    expect(
      (await queue("unlabelled")).find((r) => r.asset_id === toilets)
        ?.unlabelled_reason
    ).toBe("imported")

    await setWorkingList("guest_toilets", true)
    expect(await amenityQueue()).toContain(toilets)
    expect((await queue("unlabelled")).map((r) => r.asset_id)).not.toContain(
      toilets
    )
  })

  it("an archived check releases the import to Needs label", async () => {
    psql(
      `update public.venue_amenity_checks set status = 'archived' where id = '${w.checks.guest_toilets}'`
    )
    try {
      expect(await amenityQueue()).not.toContain(toilets)
      expect(
        (await queue("unlabelled")).find((r) => r.asset_id === toilets)
          ?.unlabelled_reason
      ).toBe("imported")
    } finally {
      psql(
        `update public.venue_amenity_checks set status = 'active' where id = '${w.checks.guest_toilets}'`
      )
    }
  })

  it("other venues' managers and staff do not see the import", async () => {
    const other = await world(`legacy-r3-o-${randomUUID().slice(0, 8)}`)
    const { data, error } = await call(other.manager, "amenity_photo_queue", {
      p_venue_id: w.venue,
    })
    expect(error?.code ?? "").not.toBe("")
    expect(data ?? []).toEqual([])
    const staff = await call(w.staffA, "manager_menu_photo_queue", {
      p_venue_id: w.venue,
      p_status: "unlabelled",
    })
    expect(staff.error?.code ?? "").not.toBe("")
  })
})

describe("Y6: a failed line is retried after cleanup tombstoned it", () => {
  let batch: string
  let manifest: string
  const retryLine = 2
  const leftoverLine = 3

  /** The state importOne leaves when step 3 fails after the reservation. */
  async function failAfterReserve(line: number, file: string, holder: string) {
    const assetId = importAssetId(batch, line)
    const keys = mediaObjectKeys(holder, assetId, "jpg")
    const stored = await service.storage
      .from(STORAGE_BUCKETS.media)
      .upload(keys.original, bytes[file]!, {
        contentType: "image/jpeg",
        upsert: false,
      })
    expect(stored.error).toBeNull()
    await ok(
      service.rpc("legacy_import_reserve", {
        p_batch_id: batch,
        p_asset_id: assetId,
        p_uploader: holder,
        p_venue_id: w.venue,
        p_media_type: "image",
        p_extension: "jpg",
        p_original_filename: `${file}.jpg`,
        p_size_bytes: bytes[file]!.byteLength,
      })
    )
    return assetId
  }

  beforeAll(async () => {
    manifest = [
      "file,venue,contributor_email,legacy_label",
      `retry.jpg,${slug},${w.staffA.email},Mystery`,
      `leftover.jpg,${slug},,Mystery`,
    ].join("\n")
    batch = (await ok(
      service.rpc("legacy_import_begin", {
        p_admin: w.admin.id,
        p_manifest_sha256: sha(new TextEncoder().encode(manifest)),
        p_label: "TEST legacy repairs",
      })
    )) as string
  })

  it("cleanup tombstones the failed line; the rerun imports it at its next attempt", async () => {
    // Line 2 (held by an active staff contributor) and line 3 (held by the
    // importing admin) both failed after their reservation.
    const dead = await failAfterReserve(retryLine, "retry", w.staffA.id)
    const live = await failAfterReserve(leftoverLine, "leftover", w.admin.id)

    // Line 2's reservation is more than 24 hours old: the hourly cleanup
    // tombstones it and removes its original.
    psql(
      `set session_replication_role = replica;
       update public.media_assets set updated_at = now() - interval '25 hours' where id = '${dead}';
       update storage.objects set created_at = now() - interval '25 hours', updated_at = now() - interval '25 hours'
         where bucket_id = 'media' and name like '%/${dead}/%';`
    )
    const cleanup = await runMediaCleanup(service)
    expect(cleanup.status).toBe("completed")
    expect(
      psql(
        `select (deleted_at is not null)::text || '|' || upload_state from public.media_assets where id = '${dead}'`
      )
    ).toBe("true|uploading")
    expect(
      psql(
        `select count(*) from storage.objects where bucket_id = 'media' and name like '%/${dead}/%'`
      )
    ).toBe("0")
    // The live leftover is untouched.
    expect(
      psql(
        `select (deleted_at is null)::text from public.media_assets where id = '${live}'`
      )
    ).toBe("true")

    // A tombstoned reservation is closed: reserve refuses it.
    const closed = await service.rpc("legacy_import_reserve", {
      p_batch_id: batch,
      p_asset_id: dead,
      p_uploader: w.staffA.id,
      p_venue_id: w.venue,
      p_media_type: "image",
      p_extension: "jpg",
      p_original_filename: "retry.jpg",
      p_size_bytes: bytes.retry!.byteLength,
    })
    expect(closed.error?.message).toBe("import_reservation_closed")

    const report = await run(manifest)
    expect(report.batchId).toBe(batch)
    expect(report.counts, JSON.stringify(report.rows)).toMatchObject({
      imported: 2,
      failed: 0,
    })
    const row = (n: number) => report.rows.find((r) => r.line === n)!
    // Line 2 at attempt 1, held by its contributor; line 3 reused attempt 0.
    expect(row(retryLine).assetId).toBe(importAssetId(batch, retryLine, 1))
    expect(row(leftoverLine).assetId).toBe(live)
    expect(
      psql(
        `select uploader_id || '|' || upload_state || '|' || (deleted_at is null)::text
           from public.media_assets where id = '${row(retryLine).assetId}'`
      )
    ).toBe(`${w.staffA.id}|ready|true`)
    expect(
      psql(
        `select line_no || ':' || asset_id from public.media_import_items
          where batch_id = '${batch}' order by line_no`
      ).split("\n")
    ).toEqual([
      `${retryLine}:${row(retryLine).assetId}`,
      `${leftoverLine}:${live}`,
    ])
    // Both wait for review (unlabelled imports, no slot matched).
    const unlabelled = (await queue("unlabelled")).map((r) => r.asset_id)
    expect(unlabelled).toContain(row(retryLine).assetId)
    expect(unlabelled).toContain(live)
    // The dead row stays tombstoned and is never shown.
    expect(
      psql(
        `select (deleted_at is not null)::text from public.media_assets where id = '${dead}'`
      )
    ).toBe("true")
  })

  it("re-running the manifest afterwards changes nothing", async () => {
    const before = psql(
      `select count(*) || '|' || (select count(*) from public.media_import_items where batch_id = '${batch}')
         from public.media_assets where venue_id = '${w.venue}'`
    )
    const report = await run(manifest)
    expect(report.counts).toMatchObject({
      unchanged: 2,
      imported: 0,
      failed: 0,
    })
    expect(
      psql(
        `select count(*) || '|' || (select count(*) from public.media_import_items where batch_id = '${batch}')
           from public.media_assets where venue_id = '${w.venue}'`
      )
    ).toBe(before)
  })

  it("reserve stays service role only", async () => {
    for (const who of [w.staffA, w.manager, w.admin]) {
      const { error } = await call(who, "legacy_import_reserve", {
        p_batch_id: batch,
        p_asset_id: randomUUID(),
        p_uploader: who.id,
        p_venue_id: w.venue,
        p_media_type: "image",
        p_extension: "jpg",
        p_original_filename: "x.jpg",
        p_size_bytes: 10,
      })
      expect(error?.code).toBe("42501")
    }
  })
})
