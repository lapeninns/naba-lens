import { expect, test, type Page } from "@playwright/test"

import { signIn, type Db } from "../support/identities"
import {
  legacyStaffGrant,
  provisionCoverageWorld,
  seedImages,
  type CoverageWorld,
} from "./helpers/coverage-world"
import { activateMenu, createMenuDraft } from "./helpers/menus"
import { provisioner, psql } from "./helpers/stack"
import { escape } from "./helpers/ui"
import { signedInPage, type Person } from "./helpers/world"

/**
 * Our menu (menu items with an accepted photo) in the built app: staff browse
 * the venue's menu and filter to "Still needs a photo"; the venue's manager
 * accepts a labelled photo for a dish and the count goes up for everyone. The
 * service role only seeds the menu, the grant and the photo bytes; the label
 * is saved by the uploader's own session, and every decision goes through
 * the pages.
 */

const sql = (v: string) => `'${v.replace(/'/g, "''")}'`

function activeVersionId(venueId: string): string {
  return psql(
    `select id from public.menu_versions where venue_id = ${sql(venueId)} and status = 'active'`
  )
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
  const { error } = await client.rpc("save_media_labels", {
    p_asset_id: assetId,
    p_expected_revision: 0,
    p_content_types: [],
    p_note: null as unknown as string,
    p_items: [{ itemId, variantId: null }],
    p_missing_item: null as unknown as string,
    p_catalogue_version_id: activeVersionId(venueId),
  })
  if (error) throw new Error(`fixture label save failed: ${error.message}`)
}

/** The live decision for one photo and dish, "state:self_review" or "". */
const photoState = (assetId: string, itemId: string) =>
  psql(
    `select state || ':' || self_review::text from public.menu_item_photos where asset_id = ${sql(assetId)}::uuid and item_id = ${sql(itemId)}::uuid and state in ('accepted', 'better_photo_requested', 'needs_recheck')`
  )

/** A three-dish menu (Soup and Salad in Starters, Pie in Mains), a manager and one labelled photo of Soup. */
async function menuWorld(w: CoverageWorld) {
  const admin: Db = await signIn(provisioner(), w.admin.email)
  const versionId = await createMenuDraft(
    admin,
    w.venue1.id,
    `Our menu ${w.tag}`
  )
  await activateMenu(admin, versionId)
  await legacyStaffGrant(w.admin, w.manager, w.venue1)
  const soup = activeItemId(w.venue1.id, "starters--soup")
  const [asset] = await seedImages(w.staffA, w.venue1, 1, {
    prefix: "DEV-FIXTURE-our-menu",
  })
  await labelAsUploader(w.staffA, w.venue1.id, asset!, soup)
  return { soup, asset: asset! }
}

/** Streaming shows the loading shell first; wait until React swaps the page in. */
async function settled(page: Page) {
  await expect(page.locator('div[hidden][id^="S:"]')).toHaveCount(0)
}

async function open(page: Page, path: string) {
  await page.goto(path)
  await settled(page)
}

const progress = (page: Page, covered: number) =>
  page
    .getByRole("main")
    .getByText(`${covered} of 3 menu items have an accepted photo.`, {
      exact: true,
    })

const dishes = (page: Page) =>
  page.getByRole("main").getByRole("heading", { level: 3 })

test.describe("Our menu: menu items with an accepted photo", () => {
  test.setTimeout(240_000)

  test("staff browse and filter to gaps; a manager accepts a labelled photo and the count goes up", async ({
    browser,
  }) => {
    const w = await provisionCoverageWorld()
    const { soup, asset } = await menuWorld(w)

    // Staff: the whole menu, grouped by section, then only the gaps.
    const staff = await signedInPage(browser, w.staffA)
    await open(staff, "/staff/menu")
    await expect(
      staff.getByRole("heading", { level: 1, name: "Our menu" })
    ).toBeVisible()
    await expect(progress(staff, 0)).toBeVisible()
    await expect(staff.getByRole("region", { name: "Starters" })).toBeVisible()
    await expect(staff.getByRole("region", { name: "Mains" })).toBeVisible()
    await expect(dishes(staff)).toHaveText(["Soup", "Salad", "Pie"])
    // Each dish offers an explicit "Add a photo of this dish" to uploaders.
    await expect(
      staff
        .getByRole("article", { name: "Soup" })
        .getByRole("button", { name: "Add a photo of this dish" })
    ).toBeVisible()

    await staff.getByRole("link", { name: "Still needs a photo" }).click()
    await expect(staff).toHaveURL(/\/staff\/menu\?filter=gaps$/)
    await expect(
      staff.getByRole("link", { name: "Still needs a photo" })
    ).toHaveAttribute("aria-current", "page")
    await expect(dishes(staff)).toHaveText(["Soup", "Salad", "Pie"])

    // Search keeps the gaps filter.
    await staff.getByRole("searchbox", { name: /Search the menu/ }).fill("pie")
    await staff.getByRole("button", { name: "Search", exact: true }).click()
    await expect(staff).toHaveURL(/filter=gaps/)
    await expect(staff).toHaveURL(/q=pie/)
    await expect(dishes(staff)).toHaveText(["Pie"])

    // Manager: the labelled photo waits under its dish; accept it.
    const manager = await signedInPage(browser, w.manager)
    await open(manager, "/staff/manage/menu/items")
    await expect(
      manager.getByRole("heading", { level: 1, name: "Our menu" })
    ).toBeVisible()
    await expect(
      manager.getByText(
        /Unlabelled photos need labelling by their uploader first/
      )
    ).toBeVisible()
    await expect(progress(manager, 0)).toBeVisible()
    await expect(
      manager.getByText(
        /1 photo is waiting for a decision; the oldest has waited/
      )
    ).toBeVisible()
    const card = manager.getByRole("article", {
      name: `Soup: photo by ${w.staffA.name}`,
    })
    await expect(card).toContainText(w.venue1.name)
    await expect(card.locator("img")).toHaveAttribute(
      "src",
      new RegExp(`/api/menu-photos/${escape(asset)}/thumb`)
    )
    await card.getByRole("button", { name: "Accept for this dish" }).click()
    await expect(manager.getByText(/^Accepted for Soup\./)).toBeVisible()
    // Once accepted, the photo leaves the "To review" queue (the refresh may
    // land before or after this line), so assert the settled queue instead.
    await expect(card).toHaveCount(0)
    await expect(
      manager.getByText("Nothing to review", { exact: false })
    ).toBeVisible()
    expect(photoState(asset, soup)).toBe("accepted:false")

    // The count went up for the reviewer and for staff; Soup left the gaps.
    await manager.reload()
    await settled(manager)
    await expect(progress(manager, 1)).toBeVisible()
    await open(staff, "/staff/menu")
    await expect(progress(staff, 1)).toBeVisible()
    await expect(
      staff
        .getByRole("article", { name: "Soup" })
        .getByText("Has an accepted photo")
    ).toBeVisible()
    await open(staff, "/staff/menu?filter=gaps")
    await expect(dishes(staff)).toHaveText(["Salad", "Pie"])

    for (const page of [staff, manager]) await page.context().close()
  })
})
