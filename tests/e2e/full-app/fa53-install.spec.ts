import { expect, test, type Page } from "@playwright/test"

import { requireIsolatedStack } from "../helpers/stack"
import { provisionWorld } from "../helpers/world"
import {
  as,
  closeAll,
  DESKTOP,
  evidence,
  expectNoSidewaysScroll,
  PHONE,
  SIZES,
} from "./helpers"

/**
 * FA-53 (spec §15.3): Naba-Lens is installable and browser use is unchanged.
 * The manifest, icons and Apple touch icon are served to signed-out browsers
 * with the security headers and nothing about anyone; Me › Help and account
 * offers Add to home screen only while the browser fires
 * `beforeinstallprompt` (hidden once answered), and Safari's steps on iOS.
 *
 * Headless Chromium never decides a page is installable, so the journey
 * dispatches the browser's event itself, with a stub `prompt()`, exactly as
 * the component receives it.
 */

const IPHONE_SAFARI =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1"

test.describe.configure({ mode: "serial" })
test.beforeAll(() => requireIsolatedStack())
test.setTimeout(180_000)
test.afterEach(({ browser }) => closeAll(browser))

const installHeading = (page: Page) =>
  page.getByRole("heading", { name: "Add to home screen" })
const installButton = (page: Page) =>
  page.getByRole("button", { name: "Add to home screen" })

/** The browser's install event, as Chrome sends it, with a counting prompt. */
async function offerInstall(page: Page, outcome: "accepted" | "dismissed") {
  await page.evaluate((outcome) => {
    const w = window as unknown as { __prompts: number }
    w.__prompts = 0
    const event = new Event("beforeinstallprompt", { cancelable: true })
    Object.assign(event, {
      prompt: async () => {
        w.__prompts += 1
      },
      userChoice: Promise.resolve({ outcome, platform: "web" }),
    })
    window.dispatchEvent(event)
  }, outcome)
}

test("FA-53: the manifest and icons are served signed out, with the security headers and nothing personal", async ({
  browser,
  baseURL,
}) => {
  const context = await browser.newContext({ baseURL })
  const page = await context.newPage()

  const manifest = await page.request.get("/manifest.webmanifest")
  expect(manifest.status()).toBe(200)
  const headers = manifest.headers()
  expect(headers["content-type"]).toContain("application/manifest+json")
  expect(headers["set-cookie"]).toBeUndefined()
  expect(headers["content-security-policy"]).toContain("frame-ancestors 'none'")
  expect(headers["x-content-type-options"]).toBe("nosniff")
  const body = await manifest.json()
  expect(body).toMatchObject({
    name: "Naba-Lens",
    start_url: "/",
    display: "standalone",
    background_color: "#f6f1e7",
    theme_color: "#f6f1e7",
  })
  // The same static fields for everyone: no origin, key, address or account.
  expect(Object.keys(body).sort()).toEqual(
    [
      "background_color",
      "description",
      "display",
      "icons",
      "id",
      "name",
      "orientation",
      "scope",
      "short_name",
      "start_url",
      "theme_color",
    ].sort()
  )
  expect(JSON.stringify(body)).not.toMatch(/supabase|token|key|@|https?:/i)

  for (const icon of body.icons as { src: string }[]) {
    const res = await page.request.get(icon.src)
    expect(res.status(), icon.src).toBe(200)
    expect(res.headers()["content-type"]).toBe("image/png")
    expect(res.headers()["set-cookie"], icon.src).toBeUndefined()
  }

  // The sign-in page links the manifest, the Apple touch icon and both
  // theme colours; signed out, nothing else changes (no install row there).
  await page.goto("/login")
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute(
    "href",
    "/manifest.webmanifest"
  )
  const touchIcon = page.locator('link[rel="apple-touch-icon"]')
  await expect(touchIcon).toHaveCount(1)
  const touchHref = await touchIcon.getAttribute("href")
  const touch = await page.request.get(touchHref!)
  expect(touch.status()).toBe(200)
  expect(touch.headers()["content-type"]).toBe("image/png")
  await expect(
    page.locator('meta[name="theme-color"][content="#f6f1e7"]')
  ).toHaveCount(1)
  await expect(
    page.locator('meta[name="theme-color"][content="#151714"]')
  ).toHaveCount(1)
  await expect(
    page.locator('meta[name="apple-mobile-web-app-title"]')
  ).toHaveAttribute("content", "Naba-Lens")
  await expect(installHeading(page)).toHaveCount(0)
  await context.close()
})

for (const [size, options] of SIZES) {
  test(`FA-53 (${size}): Me offers Add to home screen only while the browser does, and hides it once answered`, async ({
    browser,
  }) => {
    const w = await provisionWorld()
    const page = await as(browser, w.staffA, options)
    const csp: string[] = []
    page.on("console", (m) => {
      if (/Content Security Policy/i.test(m.text())) csp.push(m.text())
    })
    await page.goto("/staff")
    await expect(
      page.getByRole("heading", { name: "Help and account" })
    ).toBeVisible()
    // Chromium has not offered installation: nothing to show.
    await expect(installHeading(page)).toHaveCount(0)

    await offerInstall(page, "dismissed")
    await expect(installButton(page)).toBeVisible()
    await installButton(page).scrollIntoViewIfNeeded()
    await evidence(page, `fa53-offer-${size.replace(" ", "-")}`)
    if (options === PHONE) await expectNoSidewaysScroll(page, "Me at 390")

    await installButton(page).click()
    await expect
      .poll(() =>
        page.evaluate(
          () => (window as unknown as { __prompts: number }).__prompts
        )
      )
      .toBe(1)
    // Dismissed: the prompt is spent and the row goes.
    await expect(installHeading(page)).toHaveCount(0)

    // Installed elsewhere (the browser's own menu): the row goes too.
    await offerInstall(page, "accepted")
    await expect(installButton(page)).toBeVisible()
    await page.evaluate(() => window.dispatchEvent(new Event("appinstalled")))
    await expect(installHeading(page)).toHaveCount(0)
    expect(csp).toEqual([])
  })
}

test("FA-53 (phone 390, iPhone Safari): Me shows the Share › Add to Home Screen steps, with no button", async ({
  browser,
}) => {
  const w = await provisionWorld()
  const page = await as(browser, w.staffA, {
    ...PHONE,
    userAgent: IPHONE_SAFARI,
  })
  await page.goto("/staff")
  await expect(installHeading(page)).toBeVisible()
  const card = page.locator('[data-slot="me-install"]')
  await expect(card).toHaveAttribute("data-offer", "ios")
  await expect(card.getByRole("listitem")).toHaveText([
    "Tap Share (the square with an arrow).",
    "Tap Add to Home Screen.",
    "Tap Add.",
  ])
  await expect(installButton(page)).toHaveCount(0)
  await card.scrollIntoViewIfNeeded()
  await evidence(page, "fa53-ios-steps-phone-390")
  await expectNoSidewaysScroll(page, "Me on iPhone at 390")
})

test("FA-53 (desktop 1280): a desktop browser with no install offer shows nothing", async ({
  browser,
}) => {
  const w = await provisionWorld()
  const page = await as(browser, w.staffB, DESKTOP)
  await page.goto("/staff")
  await expect(
    page.getByRole("heading", { name: "Help and account" })
  ).toBeVisible()
  await expect(installHeading(page)).toHaveCount(0)
})
