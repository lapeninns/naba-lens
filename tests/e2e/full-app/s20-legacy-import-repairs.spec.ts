import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { readFileSync, writeFileSync } from "node:fs"
import { basename, dirname, join } from "node:path"

import { expect, test } from "@playwright/test"

import { provisionManagerWorld } from "../helpers/manager-world"
import { syntheticJpeg } from "../helpers/media"
import { psql, requireIsolatedStack } from "../helpers/stack"
import {
  as,
  closeAll,
  evidence,
  expectNoSidewaysScroll,
  SIZES,
} from "./helpers"

/**
 * S5-R3 (S5 review Y5 and Y6; FA-54): two legacy import lines that used to
 * reach no review queue now wait in the manager's Review.
 *
 * Y5: a legacy label naming a facility the venue has not got on its working
 * list ("Outdoor seating") is not staged on it; the photo waits in Needs
 * label as "Imported, no slot matched" with its legacy label as the note.
 *
 * Y6: a line whose reservation failed and was tombstoned by the 24-hour
 * cleanup (the row cleanup leaves behind) is imported by running the same
 * manifest again, and a further run changes nothing.
 */

test.describe.configure({ mode: "serial" })
test.skip(({ browserName }) => browserName !== "chromium", "Chromium only")
test.beforeAll(() => requireIsolatedStack())
test.setTimeout(300_000)
test.afterEach(({ browser }) => closeAll(browser))

const sha256 = (data: string | Buffer) =>
  createHash("sha256").update(data).digest("hex")

/** scripts/import/legacy-import.ts importAssetId (attempt 0). That module
 *  pulls server-only code, so the formula is restated here. */
function firstAttemptId(batchId: string, line: number): string {
  const h = sha256(`nabalens-legacy-import:${batchId}:${line}`).slice(0, 32)
  const variant = ((parseInt(h[16]!, 16) & 0x3) | 0x8).toString(16)
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-${variant}${h.slice(17, 20)}-${h.slice(20, 32)}`
}

test("S5-R3 legacy import: an off-list facility and a retried line wait in Review (phone and desktop)", async ({
  browser,
}) => {
  const w = await provisionManagerWorld()
  // The venue has an active Outdoor seating check that is not on a working
  // list (no list was opened for it).
  for (const [name, args] of [
    ["amenity_enable_venue", { p_venue_id: w.venueA.id }],
    [
      "amenity_add_checks",
      { p_venue_id: w.venueA.id, p_keys: ["outdoor_seating"] },
    ],
  ] as const) {
    const { error } = await w.adminDb.rpc(name as never, args as never)
    expect(error, name).toBeNull()
  }
  expect(
    psql(
      `select (c.status = 'active' and not private.knowledge_in_scope(c.venue_id, c.template_key))::text
         from public.venue_amenity_checks c
        where c.venue_id = '${w.venueA.id}' and c.template_key = 'outdoor_seating'`
    )
  ).toBe("true")

  const terrace = await syntheticJpeg(`legacy-terrace-${w.tag}.jpg`)
  const retried = await syntheticJpeg(`legacy-retried-${w.tag}.jpg`)
  const folder = dirname(terrace.path)
  const manifest = join(folder, `legacy-r3-${w.tag}.csv`)
  const label = `Shared drive R3 ${w.tag}`
  writeFileSync(
    manifest,
    [
      "file,venue,legacy_label",
      `${basename(terrace.path)},${w.venueA.id},Outdoor seating`,
      `${basename(retried.path)},${w.venueA.id},Old box ${w.tag}`,
    ].join("\n")
  )

  // An earlier run of this manifest failed line 3 after its reservation, and
  // the hourly cleanup tombstoned that reservation a day later: the batch
  // and the dead row it leaves behind.
  const batch = psql(
    `insert into public.media_import_batches (manifest_sha256, label, created_by)
     values ('${sha256(readFileSync(manifest, "utf8"))}', '${label}', '${w.admin.id}')
     returning id`
  ).split("\n")[0]!
  const dead = firstAttemptId(batch, 3)
  psql(
    `insert into public.media_assets (id, uploader_id, venue_id, original_path, original_filename,
       media_type, size_bytes, purpose, uploader_role, provenance, import_batch_id)
     values ('${dead}', '${w.admin.id}', '${w.venueA.id}', '${w.admin.id}/${dead}/original.jpg',
       '${basename(retried.path)}', 'image', 1000, 'general', 'admin', 'legacy_import', '${batch}');
     update public.media_assets set deleted_at = now() - interval '1 hour' where id = '${dead}'`
  )

  /** The real CLI; its output (never keys) is the assertion message. */
  const run = (...extra: string[]) => {
    const result = spawnSync(
      "pnpm",
      [
        "-s",
        "import:legacy",
        "--folder",
        folder,
        "--manifest",
        manifest,
        "--admin",
        w.admin.email,
        "--label",
        label,
        ...extra,
      ],
      { encoding: "utf8", env: process.env }
    )
    const output = `${result.stdout}${result.stderr}`
    expect(result.status, output).toBe(0)
    return output
  }
  expect(run("--apply")).toContain("imported 2")
  expect(run("--apply")).toContain("unchanged 2")

  const ids = psql(
    `select string_agg(i.asset_id::text, ',' order by i.line_no) from public.media_import_items i
      where i.batch_id = '${batch}'`
  ).split(",")
  expect(ids).toHaveLength(2)
  const [terraceId, retriedId] = ids as [string, string]
  expect(retriedId).not.toBe(dead)
  expect(
    psql(
      `select coalesce(staged_kind, 'none') from public.media_import_items where asset_id = '${terraceId}'`
    )
  ).toBe("none")

  for (const [size, options] of SIZES) {
    const manager = await as(browser, w.mgrA, options)
    await manager.goto("/manager/review")
    await expect(manager.getByRole("heading", { level: 1 })).toBeVisible()
    for (const [id, note] of [
      [terraceId, "Legacy label: Outdoor seating"],
      [retriedId, `Legacy label: Old box ${w.tag}`],
    ] as const) {
      const card = manager
        .getByRole("listitem")
        .filter({ has: manager.locator(`a[href*="${id}"]`) })
        .last()
      await expect(card).toContainText("Imported, no slot matched", {
        timeout: 30_000,
      })
      await expect(card).toContainText(note)
    }
    await expectNoSidewaysScroll(
      manager,
      `Review with repaired imports (${size})`
    )
    await evidence(manager, `s5-r3-review-imports-${size}`)
    await manager.context().close()
  }
})
