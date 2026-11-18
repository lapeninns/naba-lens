import { expect, test, type Locator } from "@playwright/test"

import {
  assetNamed,
  assetsNamed,
  dishesOn,
  keep,
  matchSummary,
  openAlbum,
  SIZES,
  slotChoice,
  sql,
  startMatch,
  uploadStateOf,
} from "../helpers/full-app"
import { provisionManagerWorld } from "../helpers/manager-world"
import { syntheticJpeg } from "../helpers/media"
import { psql } from "../helpers/stack"
import { signedInPage } from "../helpers/world"

/**
 * S3-R12 (round 2 review X4, X6; spec §5.2 step 5, §5.4, AC05, AC07):
 * X4 three photos of one dish in one batch, with another dish between them,
 *    are labelled with no typing: the dish matched on photo 1 stays under
 *    Recent (marked, never hidden), and a group of the next photo takes it
 *    too;
 * X6 each photo's state is on Match's end: Sending with its percent while
 *    the bytes are on their way, and Retry on a row that didn't send, which
 *    sends that same photo once.
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
    const { match } = await startMatch(
      page,
      files.map((f) => f.path)
    )
    // No step below types: every label is a tap (suggestion, Recent, group).
    const title = match.getByRole("heading", { level: 2 }).first()

    // Photo 1: Soup from the suggestions; photo 2: Pie.
    await expect(title).toHaveText("Photo 1 of 4")
    await slotChoice(match, "Soup").click()
    await expect(title).toHaveText("Photo 2 of 4")
    await slotChoice(match, "Pie").click()

    // Photo 3: Soup is under Recent, marked, one tap away (X4). Group
    // photo 4 with it, then one tap labels both.
    await expect(title).toHaveText("Photo 3 of 4")
    const soup = recentChoice(match, "Soup")
    await expect(soup).toContainText(
      "Matched just now · another photo is welcome"
    )
    await match
      .locator('[data-slot="match-group"]')
      .getByRole("button", { name: "Photo 4 too" })
      .click()
    await soup.click()

    const summary = matchSummary(page)
    await expect(summary).toBeVisible()
    await expect(summary).toContainText("2 slots filled")
    await expect(
      page.locator('[data-slot="match-summary-chips"]')
    ).toContainText("Soup × 3")
    await keep(page, info, `r12-x4-${size}-summary`)

    const ids = await Promise.all(files.map((f) => assetNamed(f.name)))
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

test("X6 each photo's progress on Match's end, and Retry on its row (phone)", async ({
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
  const { match } = await startMatch(page, [slow.path, dropped.path])
  await slotChoice(match, "Soup").click()
  await slotChoice(match, "Pie").click()
  const summary = matchSummary(page)
  await expect(summary).toBeVisible()

  // Sending, with its percent and a bar a screen reader reads (X6).
  const soupRow = summary.locator("li").filter({ hasText: "Soup" })
  await expect(soupRow).toHaveAttribute("data-state", "sending")
  await expect(soupRow.locator('[data-slot="match-row-state"]')).toHaveText(
    /Sending \d+%/,
    { timeout: 60_000 }
  )
  await expect(
    soupRow.getByRole("progressbar", { name: "Soup" })
  ).toHaveAttribute("aria-valuetext", /^Sending \d+%$/)

  // The other photo didn't send: Retry is on its own row.
  await expect(
    page.getByRole("alert").filter({ hasText: "didn't send" })
  ).toHaveText("1 photo didn't send. Choose Retry; it won't be sent twice.", {
    // The queue first retries on its own, backing off.
    timeout: 120_000,
  })
  expect(failed).toBeGreaterThanOrEqual(1)
  const pieRow = summary.locator("li").filter({ hasText: "Pie" })
  await expect(pieRow).toHaveAttribute("data-state", "failed")
  await keep(page, info, "r12-x6-summary")

  hold = false
  block = false
  await pieRow.getByRole("button", { name: "Retry Pie" }).click()
  await expect(pieRow).toHaveAttribute("data-state", "waiting", {
    timeout: 60_000,
  })
  await expect(soupRow).toHaveAttribute("data-state", "waiting", {
    timeout: 60_000,
  })
  await expect(
    page.getByRole("alert").filter({ hasText: "didn't send" })
  ).toHaveCount(0)

  // Each photo is one asset with its own dish: the retry sent nothing twice.
  const slowId = await assetNamed(slow.name)
  const droppedId = await assetNamed(dropped.name)
  await expect.poll(() => dishesOn(slowId), { timeout: 60_000 }).toBe("Soup")
  await expect.poll(() => dishesOn(droppedId), { timeout: 60_000 }).toBe("Pie")
  expect(assetsNamed(slow.name)).toBe(1)
  expect(assetsNamed(dropped.name)).toBe(1)
  await page.context().close()
})
