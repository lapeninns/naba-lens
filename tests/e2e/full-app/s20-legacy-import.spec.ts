import { spawnSync } from "node:child_process"
import { copyFileSync, writeFileSync } from "node:fs"
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
 * S20-legacy-import (spec §20, FA-54, AC21): the owner runs
 * `pnpm import:legacy` (the real CLI, against this isolated stack). An admin
 * finds the batch in the Library under Imported; the venue manager sees the
 * imports waiting in Review: one labelled with its dish (its legacy label
 * named exactly one), one as Needs label "Imported, no slot matched" with
 * its legacy label as the note. The second copy of a file is skipped.
 */

test.describe.configure({ mode: "serial" })
test.skip(({ browserName }) => browserName !== "chromium", "Chromium only")
test.beforeAll(() => requireIsolatedStack())
test.setTimeout(300_000)
test.afterEach(({ browser }) => closeAll(browser))

test("S20 legacy import: the Library's Imported filter and the manager's Review (phone and desktop)", async ({
  browser,
}) => {
  const w = await provisionManagerWorld()
  const soup = await syntheticJpeg(`legacy-soup-${w.tag}.jpg`)
  const shelf = await syntheticJpeg(`legacy-shelf-${w.tag}.jpg`)
  const folder = dirname(soup.path)
  // A byte-identical copy under another name: skipped as a duplicate.
  const copy = `copy-of-soup-${w.tag}.jpg`
  copyFileSync(soup.path, join(folder, copy))
  const manifest = join(folder, `legacy-${w.tag}.csv`)
  const label = `Shared drive ${w.tag}`
  writeFileSync(
    manifest,
    [
      "file,venue,capture_date,legacy_label,legacy_folder",
      `${basename(soup.path)},${w.venueA.id},2019-06-01,soup,Approved`,
      `${basename(shelf.path)},${w.venueA.id},,Back shelf ${w.tag},Approved`,
      `${copy},${w.venueA.id},,,Copies`,
    ].join("\n")
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
  expect(run()).toContain("would import 2, would skip as duplicates 1")
  expect(run("--apply")).toContain("imported 2, duplicates skipped 1")
  expect(run("--apply")).toContain("unchanged 3")

  const batch = psql(
    `select id from public.media_import_batches where label = '${label}'`
  )
  const ids = psql(
    `select string_agg(id::text, ',' order by original_filename) from public.media_assets
     where import_batch_id = '${batch}' and upload_state = 'ready'`
  ).split(",")
  expect(ids).toHaveLength(2)
  const [shelfId, soupId] = ids as [string, string]

  for (const [size, options] of SIZES) {
    // The admin's Library, filtered to the batch.
    const admin = await as(browser, w.admin, options)
    await admin.goto(`/admin?import=${batch}`)
    await expect(admin.getByRole("heading", { level: 1 })).toBeVisible()
    await expect(admin.getByTestId("library-more-filters")).toContainText(
      `${label} · 2 imported`
    )
    await expect(
      admin.getByRole("button", { name: new RegExp(`^Photo, legacy-`) })
    ).toHaveCount(2)
    await expectNoSidewaysScroll(admin, `Library Imported filter (${size})`)
    await evidence(admin, `s20-library-imported-${size}`)
    await admin.context().close()

    // The manager's Review: the shelf photo waits as Needs label.
    const manager = await as(browser, w.mgrA, options)
    await manager.goto("/manager/review")
    await expect(manager.getByRole("heading", { level: 1 })).toBeVisible()
    const card = manager
      .getByRole("listitem")
      .filter({ has: manager.locator(`a[href*="${shelfId}"]`) })
      .last()
    await expect(card).toContainText("Imported, no slot matched", {
      timeout: 30_000,
    })
    await expect(card).toContainText(`Legacy label: Back shelf ${w.tag}`)
    // The soup photo waits under its dish.
    await manager.goto("/manager/review?view=list")
    await expect(manager.locator(`a[href*="${soupId}"]`).first()).toBeVisible({
      timeout: 30_000,
    })
    await expectNoSidewaysScroll(manager, `Review with imports (${size})`)
    await evidence(manager, `s20-review-imports-${size}`)
    await manager.context().close()
  }

  // Never accepted, whatever the legacy folder said; the capture date kept.
  expect(
    psql(
      `select count(*) from public.menu_item_photos where asset_id in ('${soupId}', '${shelfId}')`
    )
  ).toBe("0")
  expect(
    psql(
      `select captured_at_source || ',' || (select captured_at_source from public.media_assets where id = '${shelfId}')
       from public.media_assets where id = '${soupId}'`
    )
  ).toBe("supplied,unknown")
})
