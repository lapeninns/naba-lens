import { expect, test } from "@playwright/test"

import { provisionManagedWorld } from "./helpers/managed-world"
import { appBarFit } from "./helpers/overflow"
import { signedInPage } from "./helpers/world"

/**
 * The AppBar's sections fit beside Add and Log out at every md-up width,
 * for each role's set of sections: staff (five), a manager (six) and an
 * admin. Before, from md to lg (and at lg with the name shown) the nav was
 * squeezed and its last links slid under the right-hand group.
 */

test.skip(({ browserName }) => browserName !== "chromium", "Chromium only")

test("AppBar sections fit beside Add and Log out", async ({ browser }) => {
  test.setTimeout(180_000)
  const m = await provisionManagedWorld("appbar")
  const people = [
    ["staff", m.world.staffA, "/staff"],
    ["manager", m.world.manager, "/staff/tasks"],
    ["admin", m.world.admin, "/admin"],
  ] as const
  for (const [role, person, path] of people) {
    const page = await signedInPage(browser, person)
    for (const width of [768, 900, 1024, 1180, 1280]) {
      await page.setViewportSize({ width, height: 900 })
      await page.goto(path)
      await page.evaluate(() => document.fonts.ready)
      const bar = await appBarFit(page)
      expect.soft(bar, `${role}@${width}: AppBar shown`).not.toBeNull()
      expect.soft(bar?.fits, `${role}@${width}: ${bar?.detail}`).toBe(true)
    }
    await page.context().close()
  }
})
