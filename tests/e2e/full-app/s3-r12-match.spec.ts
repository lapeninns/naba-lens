import { expect, test, type Locator } from "@playwright/test"

import {
  addPhotos,
  assetNamed,
  assetsNamed,
  dishesOn,
  keep,
  labelNow,
  openAlbum,
  saveLabel,
  SIZES,
  slotChoice,
  sql,
  tickPhotos,
  uploadStateOf,
  waitPosted,
} from "../helpers/full-app"
import { provisionManagerWorld } from "../helpers/manager-world"
import { syntheticJpeg } from "../helpers/media"
import { psql } from "../helpers/stack"
import { signedInPage } from "../helpers/world"

/**
 * S3-R12 (round 2 review X4, X6; spec §5.2 step 5, §5.4, AC05, AC07), for
 * posting first (D21, DESIGN.md §6.1):
 * X4 three photos of one dish in one batch, with another dish between them,
 *    are labelled on Label photos with no typing: the dish just labelled
 *    stays under Recent (marked, never hidden), and the next two photos,
 *    ticked together, take it in one tap;
 * X6 each photo's state is on the add sheet: Uploading with its percent
 *    while the bytes are on their way, and Retry on a row that didn't send,
 *    which sends that same photo once.
 */

test.skip(({ browserName }) => browserName !== "chromium", "Chromium only")

const SIGNED_PUT = /\/storage\/v1\/object\/upload\/sign\//

/** The Recent list of the shown photo's picker. */
const recentChoice = (match: Locator, name: string) =>
  match
    .getByRole("list", { name: "Recent" })
    .getByRole("button", { name: new RegExp(`^${name}\\b`) })

for (const size of ["phone", "desktop"] as const) {
  test(`X4 three photos of one dish, another between, labelled with no typing (${size})`, async ({
    browser,
  }, info) => {
    test.setTimeout(180_000)
    const w = await provisionManagerWorld()
    const files = await Promise.all(
      ["soup-1", "pie", "soup-2", "soup-3"].map((n) =>
        syntheticJpeg(`r12-${size}-${n}-${w.tag}.jpg`)
      )
    )
    const page = await signedInPage(browser, w.staffA1, SIZES[size])
    await openAlbum(page)
    await addPhotos(
      page,
      files.map((f) => f.path)
    )
    await waitPosted(page, 4)
    const ids = await Promise.all(files.map((f) => assetNamed(f.name)))
    const screen = await labelNow(page)
    // No step below types: every label is a tap (suggestion or Recent).

    // Photo 1: Soup from the suggestions; photo 2: Pie.
    await tickPhotos(screen, [ids[0]!])
    await slotChoice(screen, "Soup").click()
    await saveLabel(screen, 1, "Soup")
    await tickPhotos(screen, [ids[1]!])
    await slotChoice(screen, "Pie").click()
    await saveLabel(screen, 1, "Pie")

    // Photos 3 and 4, ticked together: Soup is under Recent, marked, one
    // tap away (X4).
    await tickPhotos(screen, [ids[2]!, ids[3]!])
    const soup = recentChoice(screen, "Soup")
    await expect(soup).toContainText(
      "Matched just now · another photo is welcome"
    )
    await soup.click()
    await saveLabel(screen, 2, "Soup")
    await keep(page, info, `r12-x4-${size}-labelled`)

    await expect
      .poll(() => Promise.all(ids.map(uploadStateOf)), { timeout: 60_000 })
      .toEqual(ids.map(() => "ready"))
    await expect
      .poll(() => ids.map((id) => dishesOn(id)).join(","), { timeout: 60_000 })
      .toBe("Soup,Pie,Soup,Soup")
    for (const f of files) expect(assetsNamed(f.name)).toBe(1)
    await page.context().close()
  })
}

test("X6 each photo's progress on the add sheet, and Retry on its row (phone)", async ({
  browser,
}, info) => {
  test.setTimeout(240_000)
  const w = await provisionManagerWorld()
  const slow = await syntheticJpeg(`r12-x6-slow-${w.tag}.jpg`)
  const dropped = await syntheticJpeg(`r12-x6-dropped-${w.tag}.jpg`)
  const page = await signedInPage(browser, w.staffA1, SIZES.phone)

  const idOf = (name: string) =>
    psql(`select coalesce((select id::text from public.media_assets
      where original_filename = ${sql(name)} limit 1), '')`)
  // The first photo's bytes are held until the test lets them go; the
  // second photo's transfer fails until the test lets it through.
  let hold = true
  let block = true
  let failed = 0
  await page.route(SIGNED_PUT, async (route) => {
    const url = route.request().url()
    const slowId = idOf(slow.name)
    const droppedId = idOf(dropped.name)
    if (slowId && url.includes(slowId)) {
      while (hold) await new Promise((r) => setTimeout(r, 200))
      return route.continue()
    }
    if (block && droppedId && url.includes(droppedId)) {
      failed += 1
      return route.abort("connectionreset")
    }
    return route.continue()
  })

  await openAlbum(page)
  const { sheet } = await addPhotos(page, [slow.path, dropped.path])
  const rowOf = (name: string) =>
    sheet.getByRole("list", { name: "Files" }).getByRole("listitem").filter({
      hasText: name,
    })

  // Uploading, with its percent and a bar a screen reader reads (X6).
  const slowRow = rowOf(slow.name)
  await expect(slowRow).toContainText(/Uploading · \d+%/, { timeout: 60_000 })
  await expect(
    slowRow.getByRole("progressbar", { name: slow.name })
  ).toBeVisible()

  // The other photo didn't send: Retry is on its own row.
  const droppedRow = rowOf(dropped.name)
  await expect(droppedRow).toContainText("Needs attention", {
    // The queue first retries on its own, backing off.
    timeout: 120_000,
  })
  expect(failed).toBeGreaterThanOrEqual(1)
  await expect(
    slowRow.getByRole("button", { name: `Retry ${slow.name}` })
  ).toHaveCount(0)
  await keep(page, info, "r12-x6-sheet")

  hold = false
  block = false
  await droppedRow
    .getByRole("button", { name: `Retry ${dropped.name}` })
    .click()
  await waitPosted(page, 2)
  await expect(droppedRow).toContainText("Posted")
  await expect(slowRow).toContainText("Posted")

  // Then each gets its own label.
  const slowId = await assetNamed(slow.name)
  const droppedId = await assetNamed(dropped.name)
  const screen = await labelNow(page)
  await tickPhotos(screen, [slowId])
  await slotChoice(screen, "Soup").click()
  await saveLabel(screen, 1, "Soup")
  await tickPhotos(screen, [droppedId])
  await slotChoice(screen, "Pie").click()
  await saveLabel(screen, 1, "Pie")

  // Each photo is one asset with its own dish: the retry sent nothing twice.
  await expect.poll(() => dishesOn(slowId), { timeout: 60_000 }).toBe("Soup")
  await expect.poll(() => dishesOn(droppedId), { timeout: 60_000 }).toBe("Pie")
  expect(assetsNamed(slow.name)).toBe(1)
  expect(assetsNamed(dropped.name)).toBe(1)
  await page.context().close()
})
