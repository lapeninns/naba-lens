import { expect, test, type Page } from "@playwright/test"

import { provisionManagerWorld } from "../helpers/manager-world"
import { psql } from "../helpers/stack"
import {
  acceptAsManager,
  as,
  closeAll,
  evidence,
  expectNoSidewaysScroll,
  exportablePhoto,
  SIZES,
  sql,
} from "./helpers"

/**
 * FA-52 shot templates (spec §8 A7, §5.2 step 2, §11): an admin changes the
 * Food template in Settings › Shot templates and picks an example from the
 * Library's photos accepted for public use. A staff member then reads that
 * instruction, with the example photo, on a dish slot no manager has
 * briefed; a manager starting a request on another dish finds Brief already
 * filled with it. The change is in the activity log. Phone (390) and
 * desktop (1280).
 *
 * Templates are organisation-wide, so the sizes run one after the other and
 * the seeded words are put back at the end.
 */

test.skip(({ browserName }) => browserName !== "chromium", "Chromium only")
test.describe.configure({ mode: "serial" })

const seeded = () =>
  psql(
    `select instruction || '|' || revision from public.shot_templates where category = 'food'`
  )

/** The photo really drew (the thumbnail route signed it for this person). */
async function expectDrawn(page: Page, selector: string) {
  const img = page.locator(selector).locator("img").first()
  await expect(img).toBeVisible()
  await expect
    .poll(() => img.evaluate((el) => (el as HTMLImageElement).naturalWidth))
    .toBeGreaterThan(0)
}

let original = ""

test.beforeAll(() => {
  original = seeded().split("|")[0]!
})

test.afterAll(() => {
  psql(
    `update public.shot_templates set instruction = ${sql(original)}, example_asset_id = null
     where category = 'food'`
  )
})

for (const [size, context] of SIZES) {
  test(`FA-52 an admin's Food template and example reach the slot and the request form (${size})`, async ({
    browser,
  }) => {
    test.setTimeout(240_000)
    const w = await provisionManagerWorld()
    // A dish photo accepted for public use at venue A: the example to pick.
    const example = await exportablePhoto(w.staffA1, w.venueA, [w.itemsA.soup])
    await acceptAsManager(w.mgrA, example, w.itemsA.soup)
    const words = `The dish on its usual plate, in daylight (${w.tag})`

    // --- Admin: Settings › Shot templates › Food -------------------------
    const admin = await as(browser, w.admin, context)
    await admin.goto("/admin/settings")
    const panel = admin.locator('[data-slot="shot-templates"]')
    await expect(panel.locator("[data-category]")).toHaveCount(5)
    await expectNoSidewaysScroll(admin, "Settings")
    await admin.getByRole("link", { name: "Edit the Food template" }).click()
    await expect(
      admin.getByRole("heading", { name: "Food shot template" })
    ).toBeVisible()
    await admin.getByRole("textbox", { name: "Instruction" }).fill(words)
    const choice = admin.locator(`[data-asset-id="${example}"]`)
    await expect(choice).toBeVisible({ timeout: 30_000 })
    await choice.getByRole("radio").click()
    await admin
      .getByRole("textbox", { name: /Why are you changing this/ })
      .fill("Clearer words for staff")
    await expectNoSidewaysScroll(admin, "Shot template")
    await admin.getByRole("button", { name: "Save template" }).click()
    await expect(admin.getByRole("status")).toContainText("Template saved")
    await evidence(admin, `fa52-${size}-admin`)
    expect(
      psql(
        `select (after ->> 'instruction') || '|' || (after ->> 'exampleAssetId') || '|' || reason
         from public.activity_events
         where action = 'shot_template_set' and object_id = 'food'
           and actor_id = ${sql(w.admin.id)}::uuid
         order by id desc limit 1`
      )
    ).toBe(`${words}|${example}|Clearer words for staff`)
    await admin.goto("/admin/settings#shot-templates")
    await expect(panel.locator('[data-category="food"]')).toContainText(words)

    // --- Staff: a Food slot with no manager's brief ---------------------
    const staff = await as(browser, w.staffA1, context)
    await staff.goto(`/staff/album/slot/dish/${w.itemsA.pie}`)
    const brief = staff.locator('section[aria-labelledby="slot-brief"]')
    await expect(brief).toContainText("What the photo must show")
    await expect(brief).toContainText(words)
    await expect(brief).toContainText("Example of a good photo")
    await expectDrawn(staff, '[data-slot="slot-example"]')
    await expectNoSidewaysScroll(staff, "Slot page")
    await evidence(staff, `fa52-${size}-slot`)

    // --- Manager: a new request on a Food slot is prefilled -------------
    const manager = await as(browser, w.mgrA, context)
    await manager.goto(`/manager/requests/new?kind=dish&slot=${w.itemsA.salad}`)
    await expect(manager.getByRole("textbox", { name: /^Brief/ })).toHaveValue(
      words
    )
    await expectNoSidewaysScroll(manager, "New request")
    await evidence(manager, `fa52-${size}-request`)

    await closeAll(browser)
  })
}
