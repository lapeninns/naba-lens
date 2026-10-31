import { expect, test, type Locator } from "@playwright/test"

import {
  activateNewVersion,
  attachShot,
  openOwnLabelEditor,
  pickMenuItem,
  sql,
  worldWithActiveRailway,
} from "../fixtures/menus/journey-helpers"
import { psql, requireIsolatedStack } from "../e2e/helpers/stack"
import { seedReadyAssets, signedInPage } from "../e2e/helpers/world"

/**
 * Journeys menus.label-conflict (MENUS-QA-08, MENUS-QA-15) and
 * menus.o1-save-while-reloading (MENUS-O1): staff are editing labels when an
 * admin activates a new menu version for the venue.
 */

test.beforeAll(() => requireIsolatedStack())

const MENU_UPDATED =
  "The menu for this venue was updated while you were editing"

const labelRows = (fileName: string) =>
  psql(`select count(*) from public.media_labels l
    join public.media_assets a on a.id = l.asset_id
    where a.original_filename = ${sql(fileName)}`)

/** Staff pick Onion Bhaji + Kitchen, then a new menu version goes active. */
async function staleEditor(
  browser: Parameters<typeof worldWithActiveRailway>[0],
  tag: string
) {
  const { world, admin } = await worldWithActiveRailway(browser)
  const prefix = `${tag}-${world.tag}`
  await seedReadyAssets(world.staffA.id, world.venue1.id, 1, "image", prefix)
  const fileName = `${prefix}-01.jpg`
  const staff = await signedInPage(browser, world.staffA)
  const { viewer, editor } = await openOwnLabelEditor(staff, "Photo", fileName)
  await pickMenuItem(editor, "onion bhaji", /^Onion Bhaji in Appetisers/)
  await editor.getByRole("button", { name: "Kitchen" }).click()
  await activateNewVersion(admin, world.venue1)
  return { world, staff, viewer, editor, fileName }
}

async function expectChoicesKept(editor: Locator) {
  await expect(
    editor.getByRole("list", { name: /^Selected menu items/ })
  ).toContainText("Onion Bhaji")
  await expect(editor.getByRole("button", { name: "Kitchen" })).toHaveAttribute(
    "aria-pressed",
    "true"
  )
}

test("menus.label-conflict: a menu activated while staff edit is refused, nothing is saved, choices stay and Reload then saves", async ({
  browser,
}, testInfo) => {
  test.setTimeout(240_000)
  const { staff, viewer, editor, fileName } = await staleEditor(
    browser,
    "jr-conflict"
  )

  await test.step("Save is refused with the menu-updated error", async () => {
    await editor.getByRole("button", { name: /^Save labels/ }).click()
    await expect(editor).toContainText(MENU_UPDATED)
    await attachShot(testInfo, "menu-updated-error", staff)
  })

  await test.step("nothing was saved and the choices are kept", async () => {
    expect(labelRows(fileName)).toBe("0")
    await expectChoicesKept(editor)
  })

  await test.step("Reload the menu, then Save stores the labels", async () => {
    await editor.getByRole("button", { name: "Reload the menu" }).click()
    await expect(editor.getByText("Loading the menu…")).toHaveCount(0)
    await expect(
      editor.getByRole("combobox", { name: /^Search the menu/ })
    ).toBeVisible()
    await expectChoicesKept(editor)
    await editor.getByRole("button", { name: /^Save labels/ }).click()
    await expect(editor).toBeHidden()
    const labels = viewer.getByRole("region", { name: "Labels" })
    await expect(
      labels.getByRole("list", { name: "Menu items" })
    ).toContainText("Onion Bhaji")
    await expect(
      labels.getByRole("list", { name: "Content types" })
    ).toHaveText("Kitchen")
    expect(labelRows(fileName)).toBe("1")
    await attachShot(testInfo, "labels-saved-after-reload", staff)
  })
})

test("menus.o1-save-while-reloading: while the reloaded menu is loading, Save is disabled and sends nothing", async ({
  browser,
}, testInfo) => {
  test.setTimeout(240_000)
  const { staff, editor, fileName } = await staleEditor(browser, "jr-o1")
  await editor.getByRole("button", { name: /^Save labels/ }).click()
  await expect(editor).toContainText(MENU_UPDATED)

  // Hold every Server Function request so the reload stays in flight.
  let release: () => void = () => {}
  const gate = new Promise<void>((resolve) => (release = resolve))
  let held = 0
  await staff.route("**/*", async (route) => {
    const request = route.request()
    if (request.method() === "POST" && request.headers()["next-action"]) {
      held += 1
      await gate
    }
    await route.continue()
  })

  await editor.getByRole("button", { name: "Reload the menu" }).click()
  await expect.poll(() => held).toBe(1)
  const save = editor.getByRole("button", { name: /^Save labels/ })
  await expect(save).toBeDisabled()
  await attachShot(testInfo, "save-disabled-while-reloading", staff)

  // A submit that bypasses the disabled button (the Enter key, a script) must
  // not send a stale save either.
  await editor
    .locator("form")
    .evaluate((form: HTMLFormElement) => form.requestSubmit())
  await staff.waitForTimeout(500)
  expect(held).toBe(1)
  expect(labelRows(fileName)).toBe("0")

  release()
  await expect(save).toBeEnabled()
  await save.click()
  await expect(editor).toBeHidden()
  expect(labelRows(fileName)).toBe("1")
})
