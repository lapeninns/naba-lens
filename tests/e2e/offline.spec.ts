import { expect, test, type Page } from "@playwright/test"

import { STAFF_LANDING } from "./helpers/ui"
import { provisionWorld, signedInPage, type World } from "./helpers/world"

/**
 * The offline notice on signed-in list pages. The shell shows it above pages
 * that have no notice of their own; a page that places its own (the admin
 * Staff directory) shows exactly one. Coming back online removes it.
 */

test.skip(({ browserName }) => browserName !== "chromium", "Chromium only")
test.describe.configure({ mode: "serial" })

// The page's server render time, then when the connection dropped (X-01).
const BODY = /^Loaded at \d{2}:\d{2}\. You've been offline since \d{2}:\d{2}\.$/

let world: World
let staff: Page
let admin: Page

test.beforeAll(async ({ browser }) => {
  world = await provisionWorld()
  staff = await signedInPage(browser, world.staffA)
  await expect(staff).toHaveURL(STAFF_LANDING)
  admin = await signedInPage(browser, world.adminA)
  await expect(admin).toHaveURL(/\/admin$/)
})

test.afterAll(async () => {
  await staff?.context().close()
  await admin?.context().close()
})

const offlineAlerts = (page: Page) =>
  page.getByRole("alert").filter({ hasText: "You're offline" })

/**
 * A page's own control answering in this document: React has hydrated it,
 * and with it the shell's offline listeners. A server-rendered heading alone
 * doesn't show that; going offline before hydration shows the page's
 * loaded-offline copy instead of the two clocks.
 */
type Ready = (page: Page) => Promise<void>

/** Admin Content: More filters opens its panel and closes it again. */
const moreFiltersAnswers: Ready = async (page) => {
  const more = page.getByRole("button", { name: /^More filters/ })
  await expect(more).toHaveAttribute("aria-expanded", "false")
  await more.click()
  await expect(more).toHaveAttribute("aria-expanded", "true")
  await more.click()
  await expect(more).toHaveAttribute("aria-expanded", "false")
}

/** The page's `name` button opens its `name` dialog, and Escape closes it. */
const dialogAnswers =
  (name: string): Ready =>
  async (page) => {
    await page.getByRole("button", { name }).first().click()
    const dialog = page.getByRole("dialog", { name })
    await expect(dialog).toBeVisible()
    await page.keyboard.press("Escape")
    await expect(dialog).toBeHidden()
  }

async function offlineRoundTrip(
  page: Page,
  path: string,
  heading: RegExp,
  placed: "shell" | "page",
  ready: Ready
) {
  await page.goto(path)
  await expect(
    page.getByRole("heading", { level: 1, name: heading })
  ).toBeVisible()
  await ready(page)
  await expect(offlineAlerts(page)).toHaveCount(0)

  await page.context().setOffline(true)
  const alert = offlineAlerts(page)
  await expect(alert).toHaveCount(1)
  await expect(alert.getByText("You're offline", { exact: true })).toBeVisible()
  await expect(alert.getByText(BODY)).toBeVisible()
  await expect(alert.getByRole("button", { name: "Try again" })).toBeVisible()
  // The shell's copy sits above the page heading; a page's own, in its flow.
  const beforeHeading = await alert.evaluate((el) => {
    const h1 = el.closest("main")?.querySelector("h1")
    return (
      !!h1 &&
      !!(el.compareDocumentPosition(h1) & Node.DOCUMENT_POSITION_FOLLOWING)
    )
  })
  expect(beforeHeading, `${path}: notice placed by the ${placed}`).toBe(
    placed === "shell"
  )
  // What was loaded stays on screen.
  await expect(
    page.getByRole("heading", { level: 1, name: heading })
  ).toBeVisible()

  await page.context().setOffline(false)
  await expect(offlineAlerts(page)).toHaveCount(0)
}

test("staff list page: the shell shows the offline notice", async () => {
  await offlineRoundTrip(
    staff,
    "/staff",
    /./,
    "shell",
    dialogAnswers("Edit profile")
  )
})

test("admin list page: the shell shows the offline notice", async () => {
  await offlineRoundTrip(admin, "/admin", /./, "shell", moreFiltersAnswers)
})

test("admin Staff keeps its own notice and shows exactly one", async () => {
  await offlineRoundTrip(
    admin,
    "/admin/staff",
    /^Staff$/,
    "page",
    dialogAnswers("Invite staff")
  )
})
