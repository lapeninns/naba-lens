import { expect, test, type Page } from "@playwright/test"

import { signIn, type Db } from "../support/identities"
import {
  provisionCoverageWorld,
  seedImages,
  type CoverageWorld,
} from "./helpers/coverage-world"
import { convertToManager } from "./helpers/manager-world"
import { activateMenu, createMenuDraft } from "./helpers/menus"
import { provisioner, psql } from "./helpers/stack"
import { escape } from "./helpers/ui"
import { signedInPage, type Person } from "./helpers/world"

/**
 * Menu completion (menu items with an accepted photo) in the built app:
 * staff see the venue's menu as Album's Menu part, its shelves as folders
 * (DESIGN.md §5d) with each dish's slot tile; the venue's manager account
 * (decision D3) filters its Menu to "Still needs a photo", accepts a
 * labelled photo for a dish, and the dish counts as covered for everyone.
 * The service role only seeds the menu, the manager account and the photo
 * bytes; the label is saved by the uploader's own session, and every
 * decision goes through the pages.
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

/** A three-dish menu (Soup and Salad in Starters, Pie in Mains), a manager account and one labelled photo of Soup. */
async function menuWorld(w: CoverageWorld) {
  const admin: Db = await signIn(provisioner(), w.admin.email)
  const versionId = await createMenuDraft(
    admin,
    w.venue1.id,
    `Menu completion ${w.tag}`
  )
  await activateMenu(admin, versionId)
  await convertToManager(admin, w.manager, w.venue1)
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

/** A shelf (folder) link on Album's Menu part: "Mains 0 of 1 in · 1 empty". */
const shelf = (page: Page, name: string, line: string) =>
  page
    .getByRole("main")
    .getByRole("link", { name: `${name} ${line}`, exact: true })

/** The manager Menu's dish rows, by their level-3 headings. */
const dishes = (page: Page) =>
  page.getByRole("main").getByRole("heading", { level: 3 })

test.describe("Menu completion: menu items with an accepted photo", () => {
  test.setTimeout(240_000)

  test("staff see the menu in Album; a manager filters to gaps, accepts a labelled photo and the dish is covered", async ({
    browser,
  }) => {
    const w = await provisionCoverageWorld()
    const { soup, asset } = await menuWorld(w)

    // Staff: Album's Menu, by shelf. Soup's photo waits, so it is not empty.
    const staff = await signedInPage(browser, w.staffA)
    await open(staff, "/staff/album/menu")
    await expect(
      staff.getByRole("heading", { level: 1, name: "Menu" })
    ).toBeVisible()
    await expect(staff.getByText("2 still empty of 3")).toBeVisible()
    await expect(
      shelf(staff, "Starters & small plates", "0 of 2 in · 1 empty")
    ).toBeVisible()
    await expect(shelf(staff, "Mains", "0 of 1 in · 1 empty")).toBeVisible()
    await shelf(staff, "Starters & small plates", "0 of 2 in · 1 empty").click()
    await expect(staff).toHaveURL(/shelf=food\.starters/)
    await settled(staff)
    // Each slot is one tile: an empty one adds from the phone's photos; there
    // is no in-app camera (DESIGN.md §2, §9).
    await expect(
      staff.getByRole("link", { name: "Soup: waiting for review" })
    ).toBeVisible()
    await expect(
      staff.getByRole("button", { name: "Salad: needed" })
    ).toBeVisible()
    await expect(
      staff
        .getByRole("main")
        .getByRole("button", { name: /Take a photo|camera/ })
    ).toHaveCount(0)

    // Manager: the whole menu, grouped by section, then only the gaps.
    const manager = await signedInPage(browser, w.manager)
    await open(manager, "/manager/menu")
    await expect(
      manager.getByRole("region", { name: "Starters" })
    ).toBeVisible()
    await expect(manager.getByRole("region", { name: "Mains" })).toBeVisible()
    await expect(dishes(manager)).toHaveText(["Soup", "Salad", "Pie"])
    await manager
      .getByRole("link", { name: "Still needs a photo 2", exact: true })
      .click()
    await expect(manager).toHaveURL(/status=/)
    await settled(manager)
    await expect(dishes(manager)).toHaveText(["Salad", "Pie"])

    // Search keeps the gaps filter.
    const filtered = new URL(manager.url()).searchParams.get("status")
    await manager.getByRole("searchbox", { name: "Search items" }).fill("pie")
    await manager
      .getByRole("searchbox", { name: "Search items" })
      .press("Enter")
    await expect(manager).toHaveURL(/q=pie/)
    await expect(manager).toHaveURL(new RegExp(`status=${escape(filtered!)}`))
    await expect(dishes(manager)).toHaveText(["Pie"])

    // The labelled photo waits under its dish; accept it.
    await open(manager, "/manager/menu")
    await manager.getByRole("link", { name: "Soup", exact: true }).click()
    await expect(manager).toHaveURL(new RegExp(`/manager/menu/${soup}$`))
    await settled(manager)
    const card = manager
      .getByRole("region", { name: "Awaiting review" })
      .getByRole("article", { name: "Soup" })
    await expect(card).toContainText(w.staffA.name)
    await expect(card.locator("img")).toHaveAttribute(
      "src",
      new RegExp(`${escape(asset)}`)
    )
    await card.getByRole("button", { name: "Approve for public use" }).click()
    await expect.poll(() => photoState(asset, soup)).toBe("accepted:false")
    await expect(card).toHaveCount(0)

    // Soup is covered for the manager and for staff.
    await open(manager, "/manager/menu")
    await expect(
      manager
        .getByRole("region", { name: "Starters" })
        .getByText("1 of 2 covered")
    ).toBeVisible()
    await open(staff, "/staff/album/menu")
    await expect(
      shelf(staff, "Starters & small plates", "1 of 2 in · 1 empty")
    ).toBeVisible()
    await open(staff, "/staff/album/menu?kind=food&shelf=food.starters")
    await expect(
      staff.getByRole("link", { name: /^Soup: in the album/ })
    ).toBeVisible()

    for (const page of [staff, manager]) await page.context().close()
  })
})
