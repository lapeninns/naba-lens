import { expect, test } from "@playwright/test"

import { provisionLayoutWorld } from "./helpers/s5-layout"
import { appBarFit } from "./helpers/overflow"
import { signedInPage } from "./helpers/world"

/**
 * The AppBar's sections fit beside Add and Log out at every md-up width,
 * for each role whose shell has one: staff (the tabs of DESIGN.md §15) and
 * an admin. Before, from md to lg (and at lg with the name shown) the nav was
 * squeezed and its last links slid under the right-hand group. From 1100px
 * (v2's bp-desktop, D10) an admin's sections are in the SideNav instead. A
 * venue manager works in /manager (decision D3), whose sections are section
 * tabs and the SideNav, not this AppBar, so no manager row here.
 */

test.skip(({ browserName }) => browserName !== "chromium", "Chromium only")

test("AppBar sections fit beside Add and Log out", async ({ browser }) => {
  test.setTimeout(180_000)
  const m = await provisionLayoutWorld("appbar")
  const people = [
    ["staff", m.world.staffA, "/staff/home"],
    ["admin", m.world.admin, "/admin"],
  ] as const
  for (const [role, person, path] of people) {
    const page = await signedInPage(browser, person)
    // An admin's seven sections (spec §8) are in the AppBar from lg to
    // bp-desktop (1100px) and in the SideNav above it; below lg the tab bar
    // shows three and More (S2-ADMIN).
    const widths = role === "admin" ? [1024] : [768, 900, 1024, 1180, 1280]
    for (const width of widths) {
      await page.setViewportSize({ width, height: 900 })
      await page.goto(path)
      await page.evaluate(() => document.fonts.ready)
      const bar = await appBarFit(page)
      expect.soft(bar, `${role}@${width}: AppBar shown`).not.toBeNull()
      expect.soft(bar?.fits, `${role}@${width}: ${bar?.detail}`).toBe(true)
    }
    if (role === "admin") {
      for (const width of [1180, 1280]) {
        await page.setViewportSize({ width, height: 900 })
        await page.goto(path)
        const rail = page
          .locator('[data-slot="side-nav"]')
          .filter({ visible: true })
        await expect(rail, `admin@${width}: SideNav shown`).toBeVisible()
        await expect(
          page.locator('[data-slot="app-nav"]').filter({ visible: true }),
          `admin@${width}: AppBar sections hidden`
        ).toBeHidden()
        for (const name of ["Overview", "Library", "People", "Settings"])
          await expect(
            rail.getByRole("link", { name, exact: true }),
            `admin@${width}: ${name} in the SideNav`
          ).toBeInViewport()
      }
    }
    await page.context().close()
  }
})
