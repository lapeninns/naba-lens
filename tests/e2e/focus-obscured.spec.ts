import { expect, test, type Page } from "@playwright/test"

import { signIn } from "../support/identities"
import { activateMenu, createMenuDraft } from "./helpers/menus"
import { provisioner } from "./helpers/stack"
import { STAFF_LANDING } from "./helpers/ui"
import { provisionWorld, signedInPage, type World } from "./helpers/world"

/**
 * WCAG 2.4.11 Focus not obscured at 320px: tabbing through a page never
 * leaves the focused control entirely under the phone TabBar, and the end of
 * the page scrolls clear of it.
 */

test.skip(({ browserName }) => browserName !== "chromium", "Chromium only")
test.describe.configure({ mode: "serial" })

let world: World
let staff: Page
let admin: Page
let draftId: string

test.beforeAll(async ({ browser }) => {
  test.setTimeout(180_000)
  world = await provisionWorld()
  const adminDb = await signIn(provisioner(), world.adminA.email)
  await activateMenu(
    adminDb,
    await createMenuDraft(adminDb, world.venue1.id, "Focus menu")
  )
  draftId = await createMenuDraft(adminDb, world.venue1.id, "Focus menu draft")
  const phone = { viewport: { width: 320, height: 640 } }
  staff = await signedInPage(browser, world.staffA, phone)
  await expect(staff).toHaveURL(STAFF_LANDING)
  admin = await signedInPage(browser, world.adminA, phone)
})

test.afterAll(async () => {
  await staff?.context().close()
  await admin?.context().close()
})

async function tabThrough(page: Page, path: string) {
  await page.goto(path)
  await expect(page.locator("h1").first()).toBeVisible()
  // The loading shell (with its own TabBar and heading) shows first while the
  // page streams into a hidden boundary; wait for React to swap it in.
  await expect(page.locator('[data-slot="tabbar"]')).toHaveCount(1)
  const bar = page.locator('[data-slot="tabbar"]')
  await expect(bar).toBeVisible()
  const covered: string[] = []
  const seen = new Set<string>()
  for (let i = 0; i < 120; i++) {
    await page.keyboard.press("Tab")
    const hit = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null
      const tabbar = document.querySelector('[data-slot="tabbar"]')
      if (!el || el === document.body || !tabbar) return null
      const name = `${el.tagName.toLowerCase()} "${(el.getAttribute("aria-label") ?? el.textContent ?? "").trim().slice(0, 40)}"`
      if (tabbar.contains(el)) return { name, covered: false, inBar: true }
      const r = el.getBoundingClientRect()
      const b = tabbar.getBoundingClientRect()
      return { name, covered: r.height > 0 && r.top >= b.top, inBar: false }
    })
    if (!hit) continue
    // Back at the bar after the page: one full pass done.
    if (hit.inBar && seen.size > 0) break
    seen.add(hit.name)
    if (hit.covered) covered.push(hit.name)
  }
  expect(seen.size, `${path}: tabbed through nothing`).toBeGreaterThan(3)
  expect.soft(covered, `${path}: focus hidden under the TabBar`).toEqual([])

  const clear = await page.evaluate(() => {
    window.scrollTo(0, document.documentElement.scrollHeight)
    const main = document.querySelector("main")!
    const last = main.lastElementChild!.getBoundingClientRect()
    const bar = document
      .querySelector('[data-slot="tabbar"]')!
      .getBoundingClientRect()
    return last.bottom <= bar.top
  })
  expect.soft(clear, `${path}: page end under the TabBar`).toBe(true)
}

test("draft menu editor at 320px", async () => {
  await tabThrough(admin, `/admin/menus/versions/${draftId}`)
})

test("admin Staff at 320px", async () => {
  await tabThrough(admin, "/admin/staff")
})

test("staff People at 320px", async () => {
  await tabThrough(staff, "/staff/people")
})
