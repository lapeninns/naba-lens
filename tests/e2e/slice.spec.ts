import { createHash } from "node:crypto"
import { mkdtemp, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

import { expect, test, type Browser } from "@playwright/test"
import sharp from "sharp"

import {
  createIdentity,
  createVenue,
  serviceClient,
  type TestIdentity,
} from "../support/identities"

/**
 * The vertical slice (spec §9 M2 + M3) in a real browser against the local
 * stack: staff uploads a synthetic JPEG (signed PUT) and an MP4 (TUS) through the
 * upload dialog; both appear in their portfolio; a different admin finds the
 * photo in the library and downloads byte-identical original bytes; another staff
 * member at the same venue is denied every path to it.
 */

const sha256 = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex")

const admin = serviceClient()

/** Signs in through the app's own /auth/confirm route with a magic-link token. */
async function signIn(
  browser: Browser,
  identity: TestIdentity,
  baseURL: string
) {
  // The local auth server occasionally times out (504) when several stacks
  // share this machine; retry that, nothing else.
  let link = await admin.auth.admin.generateLink({
    type: "magiclink",
    email: identity.email,
  })
  for (let i = 0; link.error?.status === 504 && i < 3; i++) {
    link = await admin.auth.admin.generateLink({
      type: "magiclink",
      email: identity.email,
    })
  }
  const { data, error } = link
  if (error) throw error
  const context = await browser.newContext({ baseURL })
  const page = await context.newPage()
  await page.goto(
    `/auth/confirm?token_hash=${data.properties.hashed_token}&type=email`
  )
  await page.getByRole("button", { name: "Continue" }).click()
  return page
}

async function syntheticJpeg(dir: string) {
  const bytes = await sharp({
    create: {
      width: 1600,
      height: 1200,
      channels: 3,
      background: { r: 180, g: 90, b: 40 },
    },
  })
    .composite([
      {
        input: Buffer.from(
          `<svg width="1600" height="1200"><circle cx="800" cy="600" r="${300 + Math.floor(Math.random() * 200)}" fill="#f4e1c1"/></svg>`
        ),
      },
    ])
    .jpeg({ quality: 88 })
    .toBuffer()
  const path = join(dir, "curry-dish.jpg")
  await writeFile(path, bytes)
  return { path, bytes: new Uint8Array(bytes) }
}

async function assetsOf(uploaderId: string) {
  const { data, error } = await admin
    .from("media_assets")
    .select("id, media_type, upload_state, original_filename")
    .eq("uploader_id", uploaderId)
    .order("created_at")
  if (error) throw error
  return data
}

test.describe("vertical slice: upload, portfolio, library, download, isolation", () => {
  test("staff uploads; a different admin downloads identical bytes; other staff are denied", async ({
    browser,
    baseURL,
  }, testInfo) => {
    test.setTimeout(120_000)
    const venue = await createVenue(admin, "e2e-slice")
    const staffA = await createIdentity(admin, {
      label: "e2e-slice-a",
      role: "staff",
      venueId: venue.id,
      session: false,
    })
    const staffB = await createIdentity(admin, {
      label: "e2e-slice-b",
      role: "staff",
      venueId: venue.id,
      session: false,
    })
    const adminUser = await createIdentity(admin, {
      label: "e2e-slice-admin",
      role: "admin",
      session: false,
    })
    const dir = await mkdtemp(join(tmpdir(), "nabalens-e2e-"))
    const jpeg = await syntheticJpeg(dir)
    const video = fileURLToPath(
      new URL("../fixtures/media/synthetic.mp4", import.meta.url)
    )

    // --- Staff A uploads through the real dialog.
    const staffPage = await signIn(browser, staffA, baseURL!)
    await expect(staffPage).toHaveURL(/\/staff$/)
    await expect(
      staffPage.getByRole("heading", { name: "TEST e2e-slice-a" })
    ).toBeVisible()
    await expect(
      staffPage.getByText("Your portfolio starts here.", { exact: false })
    ).toBeVisible()

    await staffPage
      .getByRole("button", { name: "Upload photos or videos" })
      .first()
      .click()
    const dialog = staffPage.getByRole("dialog")
    await dialog
      .getByLabel("Choose photos or videos")
      .setInputFiles([jpeg.path, video])
    await dialog.getByRole("button", { name: /^Upload 2/ }).click()
    await expect(dialog.getByText("2 uploaded")).toBeVisible({
      timeout: 60_000,
    })
    await dialog.getByRole("button", { name: "Done" }).click()

    const portfolio = staffPage.getByRole("list", { name: "Your portfolio" })
    await expect(
      portfolio.getByRole("button", { name: /^Photo, curry-dish\.jpg/ })
    ).toBeVisible()
    await expect(
      portfolio.getByRole("button", { name: /^Video, synthetic\.mp4/ })
    ).toBeVisible()

    const assets = await assetsOf(staffA.id)
    expect(assets.map((a) => [a.media_type, a.upload_state])).toEqual(
      expect.arrayContaining([
        ["image", "ready"],
        ["video", "ready"],
      ])
    )
    expect(assets).toHaveLength(2)
    const photo = assets.find((a) => a.media_type === "image")!

    // Persists after reload, with a real thumbnail from the signed route.
    await staffPage.reload()
    const tile = portfolio.getByRole("button", { name: /^Photo, curry-dish/ })
    await expect(tile.locator("img")).toHaveJSProperty("complete", true)
    expect(
      await tile
        .locator("img")
        .evaluate((img: HTMLImageElement) => img.naturalWidth)
    ).toBeGreaterThan(0)
    await staffPage.screenshot({
      path: testInfo.outputPath("staff-portfolio.png"),
      fullPage: true,
    })

    // --- A different admin sees it in the library and downloads the original.
    const adminPage = await signIn(browser, adminUser, baseURL!)
    await expect(adminPage).toHaveURL(/\/admin$/)
    const library = adminPage.getByRole("list", { name: "Library" })
    const libraryTile = library.getByRole("button", {
      name: new RegExp(
        `^Photo, curry-dish\\.jpg, by TEST e2e-slice-a, ${venue.name}`
      ),
    })
    await expect(libraryTile).toBeVisible()
    await libraryTile.click()
    const viewer = adminPage.getByRole("dialog")
    await expect(viewer.getByText("Venue at upload")).toBeVisible()
    await expect(
      viewer.getByRole("link", { name: "Open portfolio" })
    ).toHaveAttribute("href", `/admin/staff/${staffA.id}`)
    const [download] = await Promise.all([
      adminPage.waitForEvent("download"),
      viewer.getByRole("link", { name: "Download original" }).click(),
    ])
    expect(download.suggestedFilename()).toBe("curry-dish.jpg")
    const downloaded = new Uint8Array(await readFile((await download.path())!))
    expect(sha256(downloaded)).toBe(sha256(jpeg.bytes))

    const headers = (
      await adminPage.request.get(`/api/media/${photo.id}/download`)
    ).headers()
    expect(headers["content-type"]).toBe("image/jpeg")
    expect(headers["content-disposition"]).toMatch(/^attachment;/)
    expect(headers["x-content-type-options"]).toBe("nosniff")
    expect(headers["cache-control"]).toBe("private, no-store")
    await adminPage.screenshot({
      path: testInfo.outputPath("admin-viewer.png"),
    })
    await viewer.press("Escape")

    // Filters live in the URL and are applied on the server.
    await adminPage.goto(`/admin?staff=${staffA.id}&type=video`)
    await expect(
      library.getByRole("button", { name: /^Video, synthetic\.mp4/ })
    ).toBeVisible()
    await expect(library.getByRole("button", { name: /^Photo/ })).toHaveCount(0)

    // --- Staff B (same venue) is denied every path to A's photo.
    const otherPage = await signIn(browser, staffB, baseURL!)
    await expect(otherPage).toHaveURL(/\/staff$/)
    await expect(
      otherPage.getByText("Your portfolio starts here.", { exact: false })
    ).toBeVisible()
    for (const route of ["thumb", "preview", "stream", "download"]) {
      const response = await otherPage.request.get(
        `/api/media/${photo.id}/${route}`,
        { maxRedirects: 0 }
      )
      expect(response.status(), route).toBe(404)
    }
    // And the staff member's own routes still work for A.
    const own = await staffPage.request.get(`/api/media/${photo.id}/thumb`, {
      maxRedirects: 0,
    })
    expect(own.status()).toBe(302)
    expect(own.headers()["cache-control"]).toBe("private, no-store")
    // Staff never download through the admin route, even their own file.
    expect(
      (await staffPage.request.get(`/api/media/${photo.id}/download`)).status()
    ).toBe(404)

    // Signed out: nothing.
    const anonymous = await browser.newContext({ baseURL })
    expect(
      (
        await anonymous.request.get(`/api/media/${photo.id}/thumb`, {
          maxRedirects: 0,
        })
      ).status()
    ).toBe(401)
    await anonymous.close()

    // --- Deletion (lifecycle's removeMediaAsset): admin removes the photo...
    await adminPage.goto("/admin")
    await library
      .getByRole("button", { name: /^Photo, curry-dish\.jpg/ })
      .click()
    await adminPage
      .getByRole("dialog")
      .getByRole("button", { name: "Delete" })
      .click()
    const confirm = adminPage.getByRole("alertdialog")
    await expect(
      confirm.getByText(
        "Remove this file from your portfolio and the admin library? Previously downloaded copies cannot be recalled."
      )
    ).toBeVisible()
    await confirm.getByRole("button", { name: "Delete" }).click()
    await expect(confirm).toBeHidden()
    await expect(
      library.getByRole("button", { name: /^Photo, curry-dish\.jpg/ })
    ).toHaveCount(0)

    // ...staff remove their own video; both views lose both files.
    await staffPage.reload()
    await expect(
      portfolio.getByRole("button", { name: /^Photo, curry-dish/ })
    ).toHaveCount(0)
    await portfolio
      .getByRole("button", { name: /^Video, synthetic\.mp4/ })
      .click()
    await staffPage
      .getByRole("dialog")
      .getByRole("button", { name: "Delete" })
      .click()
    await staffPage
      .getByRole("alertdialog")
      .getByRole("button", { name: "Delete" })
      .click()
    await expect(
      staffPage.getByText("Your portfolio starts here.", { exact: false })
    ).toBeVisible()
    await adminPage.goto(`/admin?staff=${staffA.id}`)
    await expect(
      adminPage.getByText("Nothing matches these filters.")
    ).toBeVisible()
    expect(
      (await adminPage.request.get(`/api/media/${photo.id}/download`)).status()
    ).toBe(404)
    const { data: gone } = await admin
      .from("media_assets")
      .select("deleted_at")
      .eq("uploader_id", staffA.id)
    expect(gone!.every((r) => r.deleted_at !== null)).toBe(true)
  })

  test("staff edit their own name and profile photo", async ({
    browser,
    baseURL,
  }) => {
    const venue = await createVenue(admin, "e2e-profile")
    const staff = await createIdentity(admin, {
      label: "e2e-profile",
      role: "staff",
      venueId: venue.id,
      session: false,
    })
    const dir = await mkdtemp(join(tmpdir(), "nabalens-e2e-"))
    const photo = await syntheticJpeg(dir)
    const page = await signIn(browser, staff, baseURL!)
    await page.getByRole("button", { name: "Edit profile" }).click()
    const dialog = page.getByRole("dialog")
    await dialog.getByLabel("Display name").fill("TEST e2e renamed")
    await dialog.getByLabel("Profile photo").setInputFiles(photo.path)
    await dialog.getByRole("button", { name: /^Save/ }).click()
    await expect(
      page.getByRole("heading", { name: "TEST e2e renamed" })
    ).toBeVisible()
    const { data } = await admin
      .from("profiles")
      .select("display_name, avatar_path")
      .eq("id", staff.id)
      .single()
    expect(data!.display_name).toBe("TEST e2e renamed")
    expect(data!.avatar_path).toMatch(/\.webp$/)
  })
})
