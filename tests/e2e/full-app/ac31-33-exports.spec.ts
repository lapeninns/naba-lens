import { expect, test, type Locator, type Page } from "@playwright/test"

import { provisionManagerWorld } from "../helpers/manager-world"
import { psql, requireIsolatedStack } from "../helpers/stack"
import {
  acceptAsManager,
  as,
  closeAll,
  DESKTOP,
  evidence,
  note,
  PHONE,
  SIZES,
  sql,
  exportablePhoto,
} from "./helpers"

/**
 * AC31 to AC33 (spec §14, §22; FA-40): manual export. Exported means
 * downloaded and never Published; a photo withdrawn after it was packaged
 * blocks the package until it is rebuilt; integrated withdrawal is deferred
 * (FA-40), so AC33 pins today's manual follow-up: internal eligibility stops
 * and a published photo shows as Withdrawal pending.
 *
 * Starting state (an accepted dish photo with stored original bytes) is
 * fixture setup in the manager's own session; every step the criterion is
 * about runs through the pages.
 */

test.describe.configure({ mode: "serial" })
test.beforeAll(() => requireIsolatedStack())
test.setTimeout(240_000)
test.afterEach(({ browser }) => closeAll(browser))

const chip = (page: Page | Locator, state: string) =>
  page.locator(`[data-slot="status-chip"][data-state="${state}"]`)

async function acceptedDish(
  w: Awaited<ReturnType<typeof provisionManagerWorld>>,
  item: "soup" | "pie" | "lager",
  colour: string
) {
  const asset = await exportablePhoto(
    w.staffA1,
    w.venueA,
    [w.itemsA[item]],
    colour
  )
  await acceptAsManager(w.mgrA, asset, w.itemsA[item])
  return asset
}

/**
 * Builds a package on /…/new from the subjects named, returns its id. A
 * manager opens the builder from Exports; an admin's builder starts with a
 * venue chosen (`?venue=`, the Venue pill's link).
 */
async function makePackage(
  page: Page,
  base: string,
  subjects: string[],
  venueId?: string
) {
  if (venueId) {
    await page.goto(`${base}/new?venue=${venueId}`)
  } else {
    await page.goto(base)
    await page.getByRole("link", { name: "Make an export package" }).click()
    await expect(page).toHaveURL(new RegExp(`${base}/new`))
  }
  for (const subject of subjects) {
    await page
      .getByRole("listitem")
      .filter({ has: page.getByText(subject, { exact: true }) })
      .getByRole("checkbox", { name: "Include" })
      .check()
  }
  const n = subjects.length
  await page
    .getByRole("button", {
      name: `Make package · ${n === 1 ? "1 photo" : `${n} photos`}`,
    })
    .click()
  await expect(page).toHaveURL(new RegExp(`${base}/packages/[0-9a-f-]{36}`))
  return new URL(page.url()).pathname.split("/").pop()!
}

for (const [size, options] of SIZES) {
  test(`AC31 (${size}): a downloaded package reads Exported, never Published`, async ({
    browser,
  }) => {
    const w = await provisionManagerWorld()
    const asset = await acceptedDish(w, "soup", "#7a9a4b")

    const mgr = await as(browser, w.mgrA, options)
    // Exports is one of Venue's tabs (redesign R4, ia.md).
    await mgr.goto("/manager/venue")
    await mgr.getByRole("link", { name: "Exports", exact: true }).click()
    await expect(mgr).toHaveURL(/\/manager\/exports$/)
    const pkg = await makePackage(mgr, "/manager/exports", ["Soup"])

    await expect(chip(mgr, "package_ready")).toHaveText("Ready to download")
    await expect(
      mgr.getByText(
        "Exported is not Published. After you put a photo somewhere, tell an admin where: only admins record where a photo is published."
      )
    ).toBeVisible()

    const download = mgr.waitForEvent("download")
    await mgr.getByRole("link", { name: "Download ZIP" }).click()
    const file = await download
    expect(await file.failure()).toBeNull()
    expect(file.suggestedFilename()).toMatch(/\.zip$/)

    await mgr.reload()
    await expect(chip(mgr, "package_exported")).toHaveText("Exported")
    await expect(mgr.getByRole("region", { name: "Downloads" })).toContainText(
      "Exported, 1 photo"
    )
    // The photo itself: Exported, never Published.
    await expect(chip(mgr, "publication_exported")).toHaveText("Exported")
    await expect(chip(mgr, "publication_published_confirmed")).toHaveCount(0)
    await expect(mgr.getByText("Published", { exact: true })).toHaveCount(0)
    await evidence(mgr, `ac31-exported-${size.replace(" ", "-")}`)

    expect(
      psql(`select count(*) from public.export_package_downloads
        where package_id = ${sql(pkg)}::uuid and completed_at is not null`)
    ).toBe("1")
    expect(
      psql(`select count(*) from public.publication_events
        where asset_id = ${sql(asset)}::uuid`)
    ).toBe("0")
  })
}

test("AC32: a photo withdrawn after packaging blocks the download until the package is rebuilt without it", async ({
  browser,
}) => {
  const w = await provisionManagerWorld()
  const soup = await acceptedDish(w, "soup", "#7a9a4b")
  await acceptedDish(w, "pie", "#9a4b7a")

  const mgr = await as(browser, w.mgrA, PHONE)
  const pkg = await makePackage(mgr, "/manager/exports", ["Soup", "Pie"])
  await expect(chip(mgr, "package_ready")).toBeVisible()

  // An admin withdraws the soup photo from the library, with a reason.
  const admin = await as(browser, w.admin, DESKTOP)
  await admin.goto(`/admin/library/${soup}`)
  await admin.getByRole("button", { name: "Withdraw from use" }).click()
  const dialog = admin.getByRole("dialog")
  await dialog.getByLabel("Why").fill("DEV FIXTURE: the dish was changed")
  await dialog.getByRole("button", { name: "Withdraw from use" }).click()
  await expect(admin.getByText("Withdrawn from use.")).toBeVisible()

  // The queued package is blocked before any download.
  await mgr.reload()
  await expect(chip(mgr, "package_needs_rebuild")).toHaveText(
    "Needs rebuilding"
  )
  await expect(
    mgr.getByText(
      "1 photo in this package was withdrawn or changed after it was made, so the package can't be downloaded."
    )
  ).toBeVisible()
  await expect(mgr.getByRole("link", { name: "Download ZIP" })).toHaveCount(0)
  await evidence(mgr, "ac32-needs-rebuild")

  // A stale link refuses too, and writes no download.
  await mgr.goto(`/api/exports/${pkg}/download?from=manager`)
  await expect(mgr).toHaveURL(/download=invalidated/)
  await expect(mgr.locator('[role="alert"][data-slot="notice"]')).toContainText(
    "This package can't be downloaded"
  )
  await expect(chip(mgr, "package_invalidated").first()).toBeVisible()
  expect(
    psql(`select count(*) from public.export_package_downloads
      where package_id = ${sql(pkg)}::uuid and completed_at is not null`)
  ).toBe("0")

  // Rebuild: a new package without the withdrawn photo downloads.
  await mgr
    .getByRole("button", { name: "Rebuild without those photos" })
    .click()
  await expect(mgr).not.toHaveURL(new RegExp(pkg))
  await expect(mgr.getByText("Rebuilt from an earlier package")).toBeVisible()
  await expect(mgr.getByText("1 photo ·", { exact: false })).toBeVisible()
  await expect(
    mgr
      .getByRole("region", { name: "Photos" })
      .getByText("Pie", { exact: true })
  ).toBeVisible()
  await expect(
    mgr
      .getByRole("region", { name: "Photos" })
      .getByText("Soup", { exact: true })
  ).toHaveCount(0)
  const download = mgr.waitForEvent("download")
  await mgr.getByRole("link", { name: "Download ZIP" }).click()
  expect(await (await download).failure()).toBeNull()
  await evidence(mgr, "ac32-rebuilt")
})

test("AC33 (deferred, FA-40): a published photo that is withdrawn stops being exportable and shows Withdrawal pending until someone confirms it is taken down", async ({
  browser,
}) => {
  note(
    "deferred",
    "FA-40: no live destination adapters in Release 1. Pins the manual path: internal eligibility stops, the destination stays visibly pending."
  )
  const w = await provisionManagerWorld()
  const soup = await acceptedDish(w, "soup", "#7a9a4b")
  const destination = `DEV FIXTURE website ${w.tag}`

  const admin = await as(browser, w.admin, DESKTOP)
  await admin.goto("/admin/publishing")
  // Destinations is a closed disclosure on Publishing (second handoff).
  await admin.locator("#destinations summary").click()
  const add = admin
    .locator("details")
    .filter({ has: admin.getByText("Add a destination", { exact: true }) })
  await add.getByText("Add a destination", { exact: true }).click()
  await add.getByLabel("Name").fill(destination)
  await add.getByRole("button", { name: "Add destination" }).click()
  await expect(admin.getByText(destination).first()).toBeVisible()

  const pkg = await makePackage(
    admin,
    "/admin/publishing",
    ["Soup"],
    w.venueA.id
  )
  // One "Record where it's published" form beside the photos (second
  // handoff); the row's Record where chooses the photo.
  await admin
    .getByRole("link", { name: /^Record where/ })
    .first()
    .click()
  await admin.getByRole("combobox", { name: "Where" }).click()
  await admin.getByRole("option", { name: destination }).click()
  await admin
    .getByLabel(/^Page address/)
    .fill(`https://example.test/menu-${w.tag}`)
  await admin.getByRole("button", { name: "Record as Published" }).click()
  await expect(admin.getByText("Recorded as Published.")).toBeVisible()
  await admin.reload()
  await expect(
    chip(admin, "publication_published_confirmed").first()
  ).toBeVisible()

  // Withdraw it in the library.
  await admin.goto(`/admin/library/${soup}`)
  await admin.getByRole("button", { name: "Withdraw from use" }).click()
  const dialog = admin.getByRole("dialog")
  await dialog.getByLabel("Why").fill("DEV FIXTURE: no longer served")
  await dialog.getByRole("button", { name: "Withdraw from use" }).click()
  await expect(admin.getByText("Withdrawn from use.")).toBeVisible()

  // The manager: no longer exportable, and the destination is pending.
  const mgr = await as(browser, w.mgrA, PHONE)
  await mgr.goto("/manager/exports/new")
  await expect(mgr.getByText("Soup", { exact: true })).toHaveCount(0)
  await mgr.goto("/manager/exports")
  // One Notice when there are follow-ups (second handoff); an admin
  // confirms the removal, so the manager's page has no chip or form.
  const follow = mgr
    .locator('[data-slot="notice"]')
    .filter({ hasText: "1 photo needs taking down" })
  await expect(follow).toContainText(destination)
  await expect(follow).toContainText("an admin confirms it here")
  await evidence(mgr, "ac33-withdrawal-pending")

  // The old package can't be downloaded either.
  await mgr.goto(`/manager/exports/packages/${pkg}`)
  await expect(mgr.getByRole("link", { name: "Download ZIP" })).toHaveCount(0)
})
