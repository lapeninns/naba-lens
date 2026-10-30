import { mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

import { expect, test, type Browser, type Page } from "@playwright/test"
import sharp from "sharp"

import {
  createIdentity,
  createVenue,
  serviceClient,
  type TestIdentity,
} from "../support/identities"

/**
 * Wave 3 finding 7: the security headers from next.config.ts are present, and the
 * CSP does not break the real upload (signed PUT + TUS to Supabase), thumbnail,
 * preview and video flows. Any CSP violation fails the test.
 */

const admin = serviceClient()

type Violation = { directive: string; blocked: string }

async function signIn(
  browser: Browser,
  identity: TestIdentity,
  baseURL: string
) {
  const { data, error } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email: identity.email,
  })
  if (error) throw error
  const context = await browser.newContext({ baseURL })
  // Record CSP violations from the first document onwards.
  await context.addInitScript(() => {
    const w = window as unknown as { __csp: Violation[] }
    w.__csp = []
    document.addEventListener("securitypolicyviolation", (event) => {
      w.__csp.push({
        directive: event.violatedDirective,
        blocked: event.blockedURI,
      })
    })
  })
  const page = await context.newPage()
  const consoleViolations: string[] = []
  page.on("console", (message) => {
    if (/Content Security Policy/i.test(message.text()))
      consoleViolations.push(message.text())
  })
  await page.goto(
    `/auth/confirm?token_hash=${data.properties.hashed_token}&type=email`
  )
  return { page, consoleViolations }
}

async function violations(page: Page) {
  return page.evaluate(
    () => (window as unknown as { __csp: Violation[] }).__csp
  )
}

test("security headers are sent and the CSP allows upload, thumbnails, preview and video", async ({
  browser,
  baseURL,
}) => {
  test.setTimeout(120_000)
  const venue = await createVenue(admin, "e2e-csp")
  const staff = await createIdentity(admin, {
    label: "e2e-csp",
    role: "staff",
    venueId: venue.id,
    session: false,
  })
  const dir = await mkdtemp(join(tmpdir(), "nabalens-e2e-"))
  const jpegPath = join(dir, "csp-photo.jpg")
  await writeFile(
    jpegPath,
    await sharp({
      create: {
        width: 800,
        height: 600,
        channels: 3,
        background: { r: 30, g: 120, b: 90 },
      },
    })
      .jpeg()
      .toBuffer()
  )
  const video = fileURLToPath(
    new URL("../fixtures/media/synthetic.mp4", import.meta.url)
  )

  const { page, consoleViolations } = await signIn(browser, staff, baseURL!)
  await expect(page).toHaveURL(/\/staff$/)

  const response = await page.request.get("/staff")
  const headers = response.headers()
  expect(headers["content-security-policy"]).toContain("frame-ancestors 'none'")
  expect(headers["content-security-policy"]).toContain("object-src 'none'")
  expect(headers["content-security-policy"]).toMatch(
    /img-src 'self' blob: data:/
  )
  expect(headers["x-content-type-options"]).toBe("nosniff")
  expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin")
  expect(headers["permissions-policy"]).toContain("camera=(self)")
  expect(headers["x-frame-options"]).toBe("DENY")

  // Upload a photo (signed PUT) and a video (TUS) through the real dialog.
  await page
    .getByRole("button", { name: "Upload photos or videos" })
    .first()
    .click()
  const dialog = page.getByRole("dialog")
  await dialog
    .getByLabel("Choose photos or videos")
    .setInputFiles([jpegPath, video])
  await dialog.getByRole("button", { name: /^Upload 2/ }).click()
  await expect(dialog.getByText("2 uploaded")).toBeVisible({ timeout: 60_000 })
  await dialog.getByRole("button", { name: "Done" }).click()

  // Thumbnail (302 to a 60 s signed Storage URL on the Supabase origin).
  const portfolio = page.getByRole("list", { name: "Your portfolio" })
  const tile = portfolio.getByRole("button", { name: /^Photo, csp-photo/ })
  await expect(tile.locator("img")).toHaveJSProperty("complete", true)
  expect(
    await tile
      .locator("img")
      .evaluate((img: HTMLImageElement) => img.naturalWidth)
  ).toBeGreaterThan(0)

  // Preview.
  await tile.click()
  const viewer = page.getByRole("dialog")
  const previewImg = viewer.locator("img").first()
  await expect(previewImg).toHaveJSProperty("complete", true)
  expect(
    await previewImg.evaluate((img: HTMLImageElement) => img.naturalWidth)
  ).toBeGreaterThan(0)
  await viewer.press("Escape")

  // Video playback through the stream route.
  await portfolio.getByRole("button", { name: /^Video, synthetic/ }).click()
  const player = page.getByRole("dialog").locator("video")
  await expect(player).toBeVisible()
  await expect
    .poll(() => player.evaluate((v: HTMLVideoElement) => v.readyState), {
      timeout: 15_000,
    })
    .toBeGreaterThanOrEqual(1)

  expect(await violations(page)).toEqual([])
  expect(consoleViolations).toEqual([])
})

test("/api/profile refuses a cross-origin POST before doing anything", async ({
  request,
}) => {
  const form = { multipart: { displayName: "TEST csrf" } }
  const crossSite = await request.post("/api/profile", {
    ...form,
    headers: { origin: "https://evil.example", "sec-fetch-site": "cross-site" },
  })
  expect(crossSite.status()).toBe(403)
  const crossOrigin = await request.post("/api/profile", {
    ...form,
    headers: { origin: "https://evil.example" },
  })
  expect(crossOrigin.status()).toBe(403)
  // Same-origin gets past the check (and then needs a session).
  const sameOrigin = await request.post("/api/profile", form)
  expect(sameOrigin.status()).toBe(401)
})
