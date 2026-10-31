import { expect, test, type Page } from "@playwright/test"

import {
  activeItemId,
  attachShot,
  openOwnLabelEditor,
  openVenueMenus,
  pickMenuItem,
  sql,
  worldWithActiveRailway,
} from "../fixtures/menus/journey-helpers"
import { psql, requireIsolatedStack } from "../e2e/helpers/stack"
import { seedReadyAssets, signedInPage } from "../e2e/helpers/world"

/**
 * Journey menus.unavailable-items (MENUS-QA-04, MENUS-QA-08): items staff can't
 * pick, and the "Item not on the menu?" route back to the venue's Menus page.
 */

test.beforeAll(() => requireIsolatedStack())

const MOMO_KEY = "appetisers--momo-veg-chicken"

/** Admin archives "Momo" in the venue's active menu through the Menus UI. */
async function archiveMomo(admin: Page, venue: { id: string; name: string }) {
  await openVenueMenus(admin, venue)
  await admin.getByRole("link", { name: "View active menu" }).click()
  await admin.getByRole("searchbox", { name: "Search items" }).fill("Momo")
  await admin
    .getByRole("button", { name: /^Momo Veg · Chicken/, expanded: false })
    .click()
  await admin.getByRole("button", { name: "Archive item: Momo" }).click()
  const confirm = admin.getByRole("alertdialog")
  await expect(confirm).toContainText(
    "Staff can no longer add it to new labels"
  )
  await confirm.getByRole("button", { name: "Archive item" }).click()
  await expect(
    admin.getByRole("button", { name: "Unarchive item: Momo" })
  ).toBeVisible()
}

const labelRows = (fileName: string) =>
  psql(`select count(*) from public.media_labels l
    join public.media_assets a on a.id = l.asset_id
    where a.original_filename = ${sql(fileName)}`)

test("menus.unavailable-items: an archived item is no longer offered to staff", async ({
  browser,
}, testInfo) => {
  test.setTimeout(240_000)
  const { world, admin } = await worldWithActiveRailway(browser)
  const prefix = `jr-arch-${world.tag}`
  await seedReadyAssets(world.staffA.id, world.venue1.id, 1, "image", prefix)
  const staff = await signedInPage(browser, world.staffA)

  await test.step("before: Momo is offered", async () => {
    const { editor } = await openOwnLabelEditor(
      staff,
      "Photo",
      `${prefix}-01.jpg`
    )
    await editor
      .getByRole("combobox", { name: /^Search the menu/ })
      .fill("Momo")
    await expect(
      editor.getByRole("option", { name: /^Momo in Appetisers/ })
    ).toBeVisible()
    await staff.keyboard.press("Escape")
  })

  await archiveMomo(admin, world.venue1)
  expect(
    psql(`select archived_at is not null from public.menu_items
      where id = ${sql(activeItemId(world.venue1.id, MOMO_KEY))}`)
  ).toBe("t")

  await test.step("after: Momo is not offered", async () => {
    const { editor } = await openOwnLabelEditor(
      staff,
      "Photo",
      `${prefix}-01.jpg`
    )
    await editor
      .getByRole("combobox", { name: /^Search the menu/ })
      .fill("Momo")
    await expect(
      editor.getByText("No menu items match", { exact: false }).first()
    ).toBeVisible()
    await expect(
      editor.getByRole("option", { name: /^Momo in Appetisers/ })
    ).toHaveCount(0)
    await attachShot(testInfo, "archived-item-not-offered", staff)
  })
})

test("menus.unavailable-items: an item archived while staff edit is flagged and can be removed, then the rest saves", async ({
  browser,
}, testInfo) => {
  test.setTimeout(240_000)
  const { world, admin } = await worldWithActiveRailway(browser)
  const prefix = `jr-gone-${world.tag}`
  await seedReadyAssets(world.staffA.id, world.venue1.id, 1, "image", prefix)
  const fileName = `${prefix}-01.jpg`
  const staff = await signedInPage(browser, world.staffA)
  const { viewer, editor } = await openOwnLabelEditor(staff, "Photo", fileName)
  await pickMenuItem(editor, "Momo", /^Momo in Appetisers/)
  await editor
    .getByRole("group", { name: /^Which Momo\?/ })
    .getByRole("button", { name: "Not specified" })
    .click()
  await editor.getByRole("button", { name: "Kitchen" }).click()

  await archiveMomo(admin, world.venue1)

  await editor.getByRole("button", { name: /^Save labels/ }).click()
  await expect(editor).toContainText("Some menu items are no longer available")
  expect(labelRows(fileName)).toBe("0")
  await attachShot(testInfo, "unavailable-items-error", staff)

  await editor.getByRole("button", { name: "Remove unavailable items" }).click()
  await expect(
    editor.getByRole("list", { name: /^Selected menu items/ })
  ).toHaveCount(0)
  await editor.getByRole("button", { name: /^Save labels/ }).click()
  await expect(editor).toBeHidden()
  const labels = viewer.getByRole("region", { name: "Labels" })
  await expect(labels.getByRole("list", { name: "Content types" })).toHaveText(
    "Kitchen"
  )
  expect(labelRows(fileName)).toBe("1")
})

test("menus.unavailable-items: Item not on the menu? reaches the venue's Menus page and resolves", async ({
  browser,
}, testInfo) => {
  test.setTimeout(240_000)
  const { world, admin } = await worldWithActiveRailway(browser)
  const prefix = `jr-miss-${world.tag}`
  await seedReadyAssets(world.staffA.id, world.venue1.id, 1, "image", prefix)
  const staff = await signedInPage(browser, world.staffA)
  const missing = `JOURNEY lamb shank special ${world.tag}`

  await test.step("staff suggests an item that is not on the menu", async () => {
    const { viewer, editor } = await openOwnLabelEditor(
      staff,
      "Photo",
      `${prefix}-01.jpg`
    )
    await editor.getByRole("button", { name: "Item not on the menu?" }).click()
    await editor
      .getByRole("textbox", { name: "Missing menu item" })
      .fill(missing)
    await editor.getByRole("button", { name: /^Save labels/ }).click()
    await expect(editor).toBeHidden()
    await expect(viewer.getByRole("region", { name: "Labels" })).toContainText(
      `Suggested missing item: ${missing}`
    )
  })

  await test.step("the suggestion is on the venue's Menus page", async () => {
    await openVenueMenus(admin, world.venue1)
    await expect(
      admin.getByRole("heading", { name: "Missing-item suggestions (1 open)" })
    ).toBeVisible()
    const list = admin.getByRole("list", { name: "Missing-item suggestions" })
    await expect(list).toContainText(missing)
    await expect(list).toContainText(`Suggested by ${world.staffA.name}`)
    await attachShot(testInfo, "suggestion-on-menus-page", admin)
  })

  await test.step("the admin links it to a menu item and it resolves", async () => {
    const list = admin.getByRole("list", { name: "Missing-item suggestions" })
    await list
      .getByRole("combobox", { name: `Menu item for “${missing}”` })
      .click()
    await admin
      .getByRole("option", { name: /^Lamb Chops/ })
      .first()
      .click()
    await list
      .getByRole("button", { name: `Link to item: “${missing}”` })
      .click()
    await expect(
      admin.getByRole("heading", { name: "Missing-item suggestions (0 open)" })
    ).toBeVisible()
    expect(
      psql(
        `select status from public.menu_item_suggestions where suggested_name = ${sql(missing)}`
      )
    ).toBe("resolved")
    await attachShot(testInfo, "suggestion-resolved", admin)
  })
})
