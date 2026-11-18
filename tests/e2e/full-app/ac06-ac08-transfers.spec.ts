import { execFileSync } from "node:child_process"
import { statSync } from "node:fs"

import { expect, test, type Page, type Request } from "@playwright/test"

import {
  albumAdd,
  assetNamed,
  assetsNamed,
  dishesOn,
  keep,
  matchBySearch,
  matchSummary,
  openAlbum,
  SIZES,
  sql,
  startMatch,
  uploadStateOf,
} from "../helpers/full-app"
import { provisionManagerWorld } from "../helpers/manager-world"
import { syntheticJpeg } from "../helpers/media"
import { psql } from "../helpers/stack"
import { uploadSheet } from "../helpers/ui"
import { signedInPage } from "../helpers/world"

/**
 * Transfers through Album's Add photos and Match (spec §5.4, §5.6, §12):
 * AC06 an oversized photo is left out with its reason while the valid one
 *      goes on;
 * AC07 one transfer fails after another succeeded: only the failed photo is
 *      retried, and the sent one stays sent;
 * AC08 the answer to finalise is lost after the server finished: Retry
 *      returns the same asset, never a second one.
 */

test.skip(({ browserName }) => browserName !== "chromium", "Chromium only")

const fixtures = JSON.parse(
  execFileSync(process.execPath, ["tests/fixtures/uploads/generate.mjs"], {
    encoding: "utf8",
  })
) as { files: Record<string, string> }

const SIGNED_PUT = /\/storage\/v1\/object\/upload\/sign\//

/** The finaliseUpload Server Action: its asset and idempotency key. */
const isFinaliseAction = (r: Request) =>
  r.method() === "POST" &&
  !!r.headers()["next-action"] &&
  (r.postData() ?? "").includes('"assetId"') &&
  (r.postData() ?? "").includes('"idempotencyKey"')

/** Opens Add photos while work needs attention: the queue, with Retry. */
async function retryFromQueue(page: Page, fileName: string) {
  await albumAdd(page).click()
  const sheet = uploadSheet(page)
  await expect(sheet).toBeVisible()
  await sheet.getByRole("button", { name: `Retry ${fileName}` }).click()
  return sheet
}

const labelRows = (assetId: string) =>
  Number(
    psql(
      `select count(*) from public.media_label_items where asset_id = ${sql(assetId)}::uuid`
    )
  )

test("AC06 an oversized photo is left out with its remedy; the valid photo continues (phone)", async ({
  browser,
}, info) => {
  test.setTimeout(180_000)
  const w = await provisionManagerWorld()
  const oversized = fixtures.files["oversized_jpg"]!
  expect(statSync(oversized).size).toBeGreaterThan(25 * 1024 * 1024)
  const valid = await syntheticJpeg(`ac06-valid-${w.tag}.jpg`)

  const page = await signedInPage(browser, w.staffA1, SIZES.phone)
  await openAlbum(page)
  const { match } = await startMatch(page, [valid.path, oversized])
  // Only the valid photo is to match; the other is named with its reason.
  await expect(match).toContainText(
    "1 photo was left in your gallery. Photos can be up to 25 MB."
  )
  await expect(match.getByRole("heading", { level: 2 }).first()).toHaveText(
    /^(Photo 1 of 1|Match your photos)$/
  )
  await matchBySearch(match, "soup", "Soup")
  await expect(matchSummary(page)).toBeVisible()
  await expect(page.locator('[data-slot="match-summary-venue"]')).toHaveText(
    `1 photo for ${w.venueA.name}`
  )
  await keep(page, info, "ac06-summary")
  const id = await assetNamed(valid.name)
  await expect.poll(() => uploadStateOf(id), { timeout: 60_000 }).toBe("ready")
  await expect.poll(() => dishesOn(id), { timeout: 60_000 }).toBe("Soup")
  expect(assetsNamed("oversized.jpg")).toBe(0)
  await page.context().close()
})

for (const size of ["phone", "desktop"] as const) {
  test(`AC07 one failed transfer is retried alone; the sent photo stays sent (${size})`, async ({
    browser,
  }, info) => {
    test.setTimeout(180_000)
    const w = await provisionManagerWorld()
    const sent = await syntheticJpeg(`ac07-${size}-sent-${w.tag}.jpg`)
    const dropped = await syntheticJpeg(`ac07-${size}-dropped-${w.tag}.jpg`)

    const page = await signedInPage(browser, w.staffA1, SIZES[size])
    // The first transfer of the second photo's bytes fails mid-way; every
    // later one (the retry) goes through.
    test.setTimeout(300_000)
    // Every transfer of the second photo fails until the test lets it
    // through (the queue may retry on its own first).
    let failed = 0
    let block = true
    await page.route(SIGNED_PUT, async (route) => {
      // The reserved asset of the second photo: its storage path is in the URL.
      const droppedId =
        psql(`select coalesce((select id::text from public.media_assets
        where original_filename = ${sql(dropped.name)} limit 1), '')`)
      if (block && droppedId && route.request().url().includes(droppedId)) {
        failed += 1
        return route.abort("connectionreset")
      }
      return route.continue()
    })
    await openAlbum(page)
    const { match } = await startMatch(page, [sent.path, dropped.path])
    await matchBySearch(match, "soup", "Soup")
    await matchBySearch(match, "pie", "Pie")
    await expect(matchSummary(page)).toBeVisible()
    await expect(
      page.getByRole("alert").filter({ hasText: "didn't send" })
    ).toHaveText("1 photo didn't send. Open Add photos to send it again.", {
      // The queue first retries on its own, backing off.
      timeout: 120_000,
    })
    expect(failed).toBeGreaterThanOrEqual(1)
    await keep(page, info, `ac07-${size}-summary`)

    const sentId = await assetNamed(sent.name)
    await expect
      .poll(() => uploadStateOf(sentId), { timeout: 60_000 })
      .toBe("ready")
    await expect.poll(() => dishesOn(sentId)).toBe("Soup")

    // Close Match; Add photos shows the queue with Retry for that one only.
    await page.keyboard.press("Escape")
    await expect(match).toBeHidden()
    block = false
    const sheet = await retryFromQueue(page, dropped.name)
    await expect(
      sheet.getByRole("button", { name: `Retry ${sent.name}` })
    ).toHaveCount(0)
    const droppedId = await assetNamed(dropped.name)
    await expect
      .poll(() => uploadStateOf(droppedId), { timeout: 60_000 })
      .toBe("ready")
    await expect
      .poll(() => dishesOn(droppedId), { timeout: 60_000 })
      .toBe("Pie")
    // Nothing doubled, nothing undone.
    expect(assetsNamed(sent.name)).toBe(1)
    expect(assetsNamed(dropped.name)).toBe(1)
    expect(uploadStateOf(sentId)).toBe("ready")
    expect(labelRows(sentId)).toBe(1)
    await page.context().close()
  })
}

test("AC08 a lost answer after finalisation: Retry returns the same asset (phone)", async ({
  browser,
}, info) => {
  test.setTimeout(180_000)
  const w = await provisionManagerWorld()
  const photo = await syntheticJpeg(`ac08-${w.tag}.jpg`)
  const page = await signedInPage(browser, w.staffA1, SIZES.phone)

  // The server runs the first finalise to the end; its answer never arrives.
  const finalised: string[] = []
  let lost = 0
  await page.route("**/*", async (route) => {
    const request = route.request()
    if (!isFinaliseAction(request)) return route.fallback()
    finalised.push(
      /"assetId":"([0-9a-f-]{36})"/.exec(request.postData() ?? "")?.[1] ?? ""
    )
    if (lost === 0) {
      lost += 1
      await route.fetch().catch(() => null)
      return route.abort("connectionreset")
    }
    return route.continue()
  })
  await openAlbum(page)
  const { match } = await startMatch(page, [photo.path])
  await matchBySearch(match, "lager", "Lager")
  await expect(matchSummary(page)).toBeVisible()
  const id = await assetNamed(photo.name)
  // The server did finish it: the photo is ready.
  await expect.poll(() => uploadStateOf(id), { timeout: 60_000 }).toBe("ready")
  await expect.poll(() => lost).toBe(1)
  // No false "Sent" for the lost answer: the end asks to send it again.
  await expect(
    page.getByRole("alert").filter({ hasText: /send|finish/ })
  ).toBeVisible()
  await keep(page, info, "ac08-summary")

  await page.keyboard.press("Escape")
  await expect(match).toBeHidden()
  const sheet = await retryFromQueue(page, photo.name)
  await expect(sheet.getByRole("status")).toContainText(/1 saved/, {
    timeout: 60_000,
  })
  // Every finalise named the same asset, and there is still only one.
  expect(new Set(finalised)).toEqual(new Set([id]))
  expect(finalised.length).toBeGreaterThanOrEqual(2)
  expect(assetsNamed(photo.name)).toBe(1)
  await expect.poll(() => dishesOn(id), { timeout: 60_000 }).toBe("Lager")
  expect(labelRows(id)).toBe(1)
  await page.context().close()
})
