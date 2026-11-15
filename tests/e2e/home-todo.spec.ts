import { expect, test, type Locator, type Page } from "@playwright/test"

import { staffCaptureHref } from "../../lib/amenities/contract"
import { signIn, type Db } from "../support/identities"
import {
  amenityOk,
  captureForm,
  checkId,
  checkState,
  provisionAmenitiesWorld,
  question,
  readyCheck,
  seedPhoto,
  sessionOf,
  submitAndComplete,
} from "./helpers/amenities-world"
import {
  provisionCoverageWorld,
  seedImages,
  type CoverageWorld,
} from "./helpers/coverage-world"
import { syntheticJpeg } from "./helpers/media"
import { activateMenu, createMenuDraft } from "./helpers/menus"
import { provisioner, psql } from "./helpers/stack"
import { escape, STAFF_LANDING } from "./helpers/ui"
import {
  assetIdFor,
  doneButton,
  labelsOn,
  pickFiles,
  savingSheet,
  sql,
} from "./helpers/upload-label-flow"
import { signedInPage, type Person } from "./helpers/world"

/**
 * Goal-led Home (goals-not-tasks G-1, decisions 9 to 12), in the built app:
 * Our menu lists the dishes still needed in menu order, each a camera tap
 * away; a dish whose photo waits for review stays listed with its state;
 * nothing on Home says task, due or Overdue for menu work; a person who may
 * not upload sees the dishes with no actions; other jobs are a row away, a
 * sent finding is confirmed on Home, and the Home badge counts cards on Home,
 * never dishes. Chromium at 390 px (phone, touch). Emulation, not a device.
 */

const PHONE = {
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
}

/** Staff pages whose phone TabBar shows the Home badge (Home itself does not). */
const BADGE_PAGES = [
  "/staff/community",
  "/staff/people",
  "/staff/menu",
  "/staff",
]

/** The phone TabBar's Home link; its name carries the badge. */
const homeTab = (page: Page) =>
  page
    .getByRole("navigation", { name: "Staff" })
    .getByRole("link", { name: /^Home\b/ })

/** "Home , 1 thing to do": browsers may put a space either side of the comma. */
const homeName = (count: number) =>
  new RegExp(`^Home ?, ?${count} ${count === 1 ? "thing" : "things"} to do$`)

const ourMenu = (page: Page) => page.getByRole("region", { name: "Our menu" })

const stillNeeded = (page: Page) =>
  ourMenu(page).getByRole("list", { name: "Still needed" })

const dishRow = (scope: Locator, name: string) =>
  scope.getByRole("article", { name, exact: true })

/** Streaming shows the loading shell first; wait until React swaps the page in. */
async function settled(page: Page) {
  await expect(page.locator('div[hidden][id^="S:"]')).toHaveCount(0)
}

/** Stable item id behind a source key in the venue's active version. */
function activeItemId(venueId: string, sourceKey: string): string {
  const id = psql(`select e.item_id from public.menu_entries e
    join public.menu_versions v on v.id = e.version_id
    where v.venue_id = ${sql(venueId)} and v.status = 'active' and e.source_key = ${sql(sourceKey)}`)
  if (!id) throw new Error(`No active item ${sourceKey}`)
  return id
}

/** Labels one photo with one dish as its uploader (fixture setup only). */
async function labelAsUploader(
  who: Person,
  venueId: string,
  assetId: string,
  itemId: string
) {
  const client = await signIn(provisioner(), who.email)
  const versionId = psql(
    `select id from public.menu_versions where venue_id = ${sql(venueId)} and status = 'active'`
  )
  const { error } = await client.rpc("save_media_labels", {
    p_asset_id: assetId,
    p_expected_revision: 0,
    p_content_types: [],
    p_note: null as unknown as string,
    p_items: [{ itemId, variantId: null }],
    p_missing_item: null as unknown as string,
    p_catalogue_version_id: versionId,
  })
  if (error) throw new Error(`fixture label save failed: ${error.message}`)
}

/**
 * A three-dish menu (Soup and Salad in Starters, Pie in Mains) with no
 * accepted photo, and staff B's photo of Soup waiting for review.
 */
async function menuWorld(w: CoverageWorld) {
  const admin: Db = await signIn(provisioner(), w.admin.email)
  const versionId = await createMenuDraft(admin, w.venue1.id, `Goals ${w.tag}`)
  await activateMenu(admin, versionId)
  const soup = activeItemId(w.venue1.id, "starters--soup")
  const [asset] = await seedImages(w.staffB, w.venue1, 1, {
    prefix: "DEV-FIXTURE-goals-home",
  })
  await labelAsUploader(w.staffB, w.venue1.id, asset!, soup)
}

test.describe("Home: goals, not tasks", () => {
  test.setTimeout(300_000)

  test("390: Still needed in menu order, a dish's camera saves its label, and no task, due or Overdue", async ({
    browser,
  }) => {
    const w = await provisionCoverageWorld()
    await menuWorld(w)

    const page = await signedInPage(browser, w.staffA, PHONE)
    await expect(page).toHaveURL(STAFF_LANDING)
    await settled(page)
    await expect(ourMenu(page)).toBeVisible()
    await expect(
      ourMenu(page).getByText("0 of 3 have an accepted photo")
    ).toBeVisible()
    await expect(stillNeeded(page).getByRole("heading")).toHaveText([
      "Soup",
      "Salad",
      "Pie",
    ])
    // A colleague's photo waits for review: Soup stays, marked, still open.
    const soup = dishRow(stillNeeded(page), "Soup")
    await expect(soup.getByText("Waiting for review")).toBeVisible()
    await expect(
      soup.getByRole("button", { name: "Take a photo of this dish" })
    ).toBeVisible()
    await expect(
      ourMenu(page).getByRole("link", { name: "See all 3" })
    ).toHaveAttribute("href", "/staff/menu?filter=gaps")

    // Goals replace To do: no To do, no share box, no task words.
    await expect(page.getByRole("region", { name: /^To do/ })).toHaveCount(0)
    const main = page.getByRole("main")
    await expect(main).not.toContainText(/\btasks?\b/i)
    await expect(main).not.toContainText(/\bdue\b/i)
    await expect(main).not.toContainText(/overdue/i)

    // Picking a file from a Home dish row saves a label for that dish.
    const photo = await syntheticJpeg(`goals-home-pie-${w.tag}.jpg`)
    const input = await pickFiles(
      page,
      dishRow(stillNeeded(page), "Pie").getByRole("button", {
        name: "Take a photo of this dish",
      }),
      [photo.path]
    )
    expect(input.capture).toBe("environment")
    const sheet = savingSheet(page, "Saving 1 photo")
    await expect(sheet).toBeVisible()
    await expect(
      sheet.getByRole("button", { name: "Remove Pie" })
    ).toBeVisible()
    await doneButton(sheet).tap()
    await expect(sheet).toBeHidden()
    const id = await assetIdFor(photo.name)
    await expect.poll(() => labelsOn(id), { timeout: 90_000 }).toBe("Pie")

    // Nothing on Home asks this person to act: the badge never counts dishes.
    for (const path of BADGE_PAGES) {
      await page.goto(path)
      await expect(homeTab(page), path).toHaveAccessibleName(/^Home$/)
    }
  })

  test("390: a person who may not upload sees the dishes with no actions", async ({
    browser,
  }) => {
    const w = await provisionCoverageWorld()
    await menuWorld(w)
    // The venue stops taking photos (uploadBlockReason: venue_inactive).
    psql(
      `update public.venues set active = false where id = ${sql(w.venue1.id)}`
    )

    const page = await signedInPage(browser, w.staffA, PHONE)
    await expect(page).toHaveURL(STAFF_LANDING)
    await settled(page)
    await expect(stillNeeded(page).getByRole("heading")).toHaveText([
      "Soup",
      "Salad",
      "Pie",
    ])
    await expect(stillNeeded(page).getByRole("button")).toHaveCount(0)
    await expect(page.getByRole("button", { name: "Open camera" })).toHaveCount(
      0
    )
  })

  test("390: other jobs are two taps away, a sent finding is confirmed, and the badge counts the one card", async ({
    browser,
  }) => {
    const w = await provisionAmenitiesWorld()
    const darts = await readyCheck(w, w.venueA, "darts", w.staffA)
    const toilets = checkId(w.venueA, "guest_toilets")
    await amenityOk(await sessionOf(w.admin), "amenity_assign_check", {
      p_check_id: toilets,
      p_assignee_id: w.staffA.id,
      p_revision: checkState(toilets).revision,
    })
    const photo = await seedPhoto(w.staffA, w.venueA, `home-goals-${w.tag}`, {
      purpose: "amenity",
    })

    const page = await signedInPage(browser, w.staffA, PHONE)
    await expect(page).toHaveURL(STAFF_LANDING)
    await settled(page)
    // Tap 1: the Other jobs row. Tap 2: the check.
    const row = page.getByRole("link", { name: /^Other jobs/ })
    await expect(row).toHaveAttribute("href", "/staff/tasks/other")
    await row.tap()
    await expect(page).toHaveURL(/\/staff\/tasks\/other$/)
    await page
      .locator(`a[href="${staffCaptureHref(darts)}"]`)
      .first()
      .tap()
    await expect(page).toHaveURL(
      new RegExp(`${escape(staffCaptureHref(darts))}$`)
    )

    const form = captureForm(page)
    await form.answer("yes")
    await form.attach(photo)
    await submitAndComplete(page, darts)

    // Home confirms the sent check by name until dismissed.
    await expect(page).toHaveURL(
      new RegExp(`/staff/tasks\\?finding_sent=${escape(darts)}$`)
    )
    const notice = page.getByRole("status").filter({ hasText: "Finding sent" })
    await expect(notice).toBeVisible()
    await expect(notice).toBeFocused()
    await expect(notice).toContainText(question("darts"))
    await notice.getByRole("button", { name: "Dismiss" }).tap()
    await expect(notice).toHaveCount(0)
    // Focus lands on a heading that exists on goal-led Home.
    await expect(
      page.getByRole("heading", { level: 2, name: "Our menu" })
    ).toBeFocused()
    await expect(page).toHaveURL(STAFF_LANDING)

    // One check is left: the Other jobs row is one card on the badge.
    for (const path of BADGE_PAGES) {
      await page.goto(path)
      await expect(homeTab(page), path).toHaveAccessibleName(homeName(1))
    }
  })
})
