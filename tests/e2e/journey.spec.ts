import { readFile } from "node:fs/promises"

import { expect, test, type Page } from "@playwright/test"

import { mailboxIds, SUBJECTS, waitForLink } from "./helpers/mailpit"
import {
  sha256,
  type SourceFile,
  supportedMp4,
  syntheticHeic,
  syntheticJpeg,
} from "./helpers/media"
import { provisioner, storedObjects } from "./helpers/stack"
import {
  chooseOption,
  documentUnchanged,
  libraryList,
  markDocument,
  portfolioList,
  tile,
  uploadThroughDialog,
} from "./helpers/ui"
import {
  fixtureEmail,
  provisionWorld,
  signedInPage,
  type World,
} from "./helpers/world"

/**
 * Release-critical journey (spec §2 vertical slice + §10 acceptance), run on
 * Chromium, Firefox, WebKit and a mobile-emulated width. Real invite email →
 * real uploads (JPEG, H.264 MP4, HEIC from `sips`) → portfolio after reload and
 * in a fresh context → a second admin's already-open library picks them up
 * without reload → combined filters → portfolio → preview → original download
 * with matching SHA-256 → staff deletes one → both views lose it, old grants
 * are denied and storage is empty.
 */

// The admin library's foreground refresh is ~15 s (app/admin/admin-library.tsx).
const REFRESH_WINDOW = 15_000 + 10_000

async function downloadOriginal(page: Page) {
  const viewer = page.getByRole("dialog")
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    viewer.getByRole("link", { name: "Download original" }).click(),
  ])
  const path = await download.path()
  expect(await download.failure()).toBeNull()
  return {
    name: download.suggestedFilename(),
    sha256: sha256(new Uint8Array(await readFile(path!))),
  }
}

test.describe("release journey @core", () => {
  let world: World
  test.beforeAll(async () => {
    world = await provisionWorld()
  })

  test("invite → upload → portfolio → second admin → filters → download → delete @core", async ({
    browser,
  }, testInfo) => {
    test.setTimeout(300_000)
    const { tag, venue1 } = world
    const jpeg = await syntheticJpeg(`dish-${tag}.jpg`)
    const mp4 = supportedMp4(`clip-${tag}.mp4`)
    const heic = await syntheticHeic(`phone-${tag}.heic`)

    // --- Admin A invites a new staff member through the UI.
    const adminA = await signedInPage(browser, world.adminA)
    await expect(adminA).toHaveURL(/\/admin$/)
    await adminA.goto("/admin/staff")
    const inviteeEmail = fixtureEmail("invitee", tag)
    const inviteeName = `DEV FIXTURE Invitee ${tag}`
    const before = await mailboxIds(inviteeEmail)
    await adminA.getByRole("button", { name: "Invite staff" }).click()
    const invite = adminA.getByRole("dialog")
    await invite.getByLabel("Name").fill(inviteeName)
    await invite.getByLabel("Email").fill(inviteeEmail)
    await invite.getByLabel("Job title (optional)").fill("Tandoori chef")
    await chooseOption(adminA, invite, "Venue", venue1.name)
    await invite.getByRole("button", { name: "Send invitation" }).click()
    await expect(
      invite.getByRole("heading", { name: "Invitation sent" })
    ).toBeVisible()
    await invite.getByRole("button", { name: "Close" }).last().click()
    await expect(invite).toBeHidden()

    // --- The invitee accepts from the real email and lands on their portfolio.
    const inviteLink = await waitForLink(inviteeEmail, SUBJECTS.invite, before)
    const staffContext = await browser.newContext()
    const staff = await staffContext.newPage()
    await staff.goto(inviteLink)
    await expect(staff).toHaveURL(/\/staff$/)
    await expect(
      staff.getByRole("heading", { name: inviteeName })
    ).toBeVisible()
    await expect(staff.getByText(venue1.name)).toBeVisible()
    await expect(
      staff.getByText("Your portfolio starts here.", { exact: false })
    ).toBeVisible()
    const { data: invitee } = await provisioner()
      .from("profiles")
      .select("id, role, venue_id")
      .eq("display_name", inviteeName)
      .single()
    expect(invitee).toMatchObject({ role: "staff", venue_id: venue1.id })
    const inviteeId = invitee!.id

    // --- Admin B opens the library BEFORE the upload and keeps it open.
    const adminB = await signedInPage(browser, world.adminB)
    await expect(adminB).toHaveURL(/\/admin$/)
    await expect(
      libraryList(adminB).or(adminB.getByText("No uploads yet"))
    ).toBeVisible()
    await markDocument(adminB)

    // --- Staff uploads a JPEG, an MP4 and a HEIC through the real dialog.
    const seen = await uploadThroughDialog(staff, [jpeg, mp4, heic])
    for (const file of [jpeg, mp4, heic]) {
      const log = seen[file.name]
      // Real technical states, in order, ending in Uploaded.
      expect(log, file.name).toEqual(
        expect.arrayContaining(["Uploading", "Processing", "Uploaded"])
      )
      expect(log.indexOf("Uploading"), file.name).toBeLessThan(
        log.indexOf("Processing")
      )
      expect(log.at(-1), file.name).toBe("Uploaded")
    }
    const uploadsReadyAt = Date.now()
    await staff.getByRole("button", { name: "Done" }).click()

    const { data: rows } = await provisioner()
      .from("media_assets")
      .select("id, original_filename, media_type, upload_state, venue_id")
      .eq("uploader_id", inviteeId)
      .is("deleted_at", null)
    expect(rows).toHaveLength(3)
    for (const row of rows!) {
      expect(row).toMatchObject({ upload_state: "ready", venue_id: venue1.id })
    }
    const idOf = (name: string) =>
      rows!.find((r) => r.original_filename === name)!.id

    const portfolio = portfolioList(staff)
    await expect(tile(portfolio, "Photo", jpeg.name)).toBeVisible()
    await expect(tile(portfolio, "Video", mp4.name)).toBeVisible()
    await expect(tile(portfolio, "Photo", heic.name)).toBeVisible()

    // Persists after reload, with real thumbnails (HEIC decoded server-side).
    await staff.reload()
    for (const name of [jpeg.name, heic.name]) {
      const img = tile(portfolio, "Photo", name).locator("img")
      await expect
        .poll(() =>
          img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth)
        )
        .toBeGreaterThan(0)
    }
    await expect(portfolio.getByRole("button")).toHaveCount(3)

    // A fresh browser context, signed in through the real login form + email.
    const fresh = await browser.newContext()
    const freshPage = await fresh.newPage()
    const seenSignIn = await mailboxIds(inviteeEmail)
    await freshPage.goto("/login")
    await freshPage.getByLabel("Email").fill(inviteeEmail)
    await freshPage.getByRole("button", { name: "Send sign-in link" }).click()
    await expect(
      freshPage.getByRole("heading", { name: "Check your email" })
    ).toBeVisible()
    await freshPage.goto(
      await waitForLink(inviteeEmail, SUBJECTS.signIn, seenSignIn)
    )
    await expect(freshPage).toHaveURL(/\/staff$/)
    await expect(portfolioList(freshPage).getByRole("button")).toHaveCount(3)
    await fresh.close()

    // --- Admin B's already-open library shows them without a reload.
    const library = libraryList(adminB)
    const attribution = `, by ${inviteeName}, ${venue1.name}`
    await expect(tile(library, "Photo", jpeg.name, attribution)).toBeVisible({
      timeout: REFRESH_WINDOW,
    })
    await expect(tile(library, "Video", mp4.name, attribution)).toBeVisible()
    await expect(tile(library, "Photo", heic.name, attribution)).toBeVisible()
    expect(await documentUnchanged(adminB)).toBe(true)
    testInfo.annotations.push({
      type: "library refresh",
      description: `visible ${Math.round((Date.now() - uploadsReadyAt) / 1000)} s after upload settled`,
    })

    // --- Admin B combines venue + staff + type filters.
    await chooseOption(adminB, adminB, "Venue", venue1.name)
    await expect(adminB).toHaveURL(new RegExp(`venue=${venue1.id}`))
    await chooseOption(adminB, adminB, "Staff member", inviteeName)
    await expect(adminB).toHaveURL(new RegExp(`staff=${inviteeId}`))
    await adminB
      .getByRole("group", { name: "Media type" })
      .getByRole("button", { name: "Photos" })
      .click()
    await expect(adminB).toHaveURL(/type=image/)
    await expect(adminB).toHaveURL(new RegExp(`venue=${venue1.id}`))
    await expect(library.getByRole("button")).toHaveCount(2)
    await expect(tile(library, "Photo", jpeg.name, attribution)).toBeVisible()
    await expect(tile(library, "Photo", heic.name, attribution)).toBeVisible()
    await expect(tile(library, "Video", mp4.name)).toHaveCount(0)

    // Preview in the library viewer, and download originals there: the bytes
    // equal the uploaded sources (photos, then the video under "Videos").
    const viewer = adminB.getByRole("dialog")
    await tile(library, "Photo", jpeg.name).click()
    const preview = viewer.getByRole("img", { name: `Photo ${jpeg.name}` })
    await expect
      .poll(() =>
        preview.evaluate(
          (el: HTMLImageElement) => el.complete && el.naturalWidth
        )
      )
      .toBeGreaterThan(0)
    await expect(viewer.getByText(venue1.name)).toBeVisible()
    await adminB.keyboard.press("Escape")
    await expect(viewer).toBeHidden()

    const downloadFrom = async (kind: "Photo" | "Video", file: SourceFile) => {
      await tile(library, kind, file.name).click()
      const got = await downloadOriginal(adminB)
      expect(got.name, file.name).toBe(file.name)
      expect(got.sha256, file.name).toBe(file.sha256)
      await adminB.keyboard.press("Escape")
      await expect(viewer).toBeHidden()
    }
    await downloadFrom("Photo", jpeg)
    await downloadFrom("Photo", heic)
    await adminB
      .getByRole("group", { name: "Media type" })
      .getByRole("button", { name: "Videos" })
      .click()
    await expect(adminB).toHaveURL(/type=video/)
    await expect(library.getByRole("button")).toHaveCount(1)
    await downloadFrom("Video", mp4)

    // Open the contributor's portfolio from the viewer.
    await tile(library, "Video", mp4.name).click()
    await viewer.getByRole("link", { name: "Open portfolio" }).click()
    await expect(adminB).toHaveURL(new RegExp(`/admin/staff/${inviteeId}$`))
    await expect(
      adminB.getByRole("heading", { name: inviteeName })
    ).toBeVisible()
    await expect(
      adminB
        .getByRole("list", { name: `${inviteeName}'s portfolio` })
        .getByRole("button")
    ).toHaveCount(3)

    // --- Staff deletes their JPEG. Capture its grants first.
    const jpegId = idOf(jpeg.name)
    const thumbBefore = await staff.request.get(`/api/media/${jpegId}/thumb`, {
      maxRedirects: 0,
    })
    expect(thumbBefore.status()).toBe(302)
    const signedThumb = thumbBefore.headers()["location"]
    expect(await storedObjects(inviteeId, jpegId)).toEqual(
      expect.arrayContaining(["original.jpg", "preview.webp", "thumb.webp"])
    )
    await adminB.goto("/admin")
    await markDocument(adminB)
    await expect(tile(libraryList(adminB), "Photo", jpeg.name)).toBeVisible()

    await tile(portfolio, "Photo", jpeg.name).click()
    await staff
      .getByRole("dialog")
      .getByRole("button", { name: "Delete" })
      .click()
    const confirm = staff.getByRole("alertdialog")
    await expect(
      confirm.getByText(
        "Remove this file from your portfolio and the admin library? Previously downloaded copies cannot be recalled."
      )
    ).toBeVisible()
    await confirm.getByRole("button", { name: "Delete" }).click()
    await expect(confirm).toBeHidden()
    await expect(tile(portfolio, "Photo", jpeg.name)).toHaveCount(0)
    await expect(portfolio.getByRole("button")).toHaveCount(2)

    // Admin B's open library drops it on its next refresh, without reload.
    await expect(tile(libraryList(adminB), "Photo", jpeg.name)).toHaveCount(0, {
      timeout: REFRESH_WINDOW,
    })
    await expect(tile(libraryList(adminB), "Video", mp4.name)).toBeVisible()
    expect(await documentUnchanged(adminB)).toBe(true)

    // New grants are refused; the previously signed URL no longer serves bytes.
    for (const route of ["thumb", "preview"]) {
      const r = await staff.request.get(`/api/media/${jpegId}/${route}`, {
        maxRedirects: 0,
      })
      expect(r.status(), route).toBe(404)
    }
    expect(
      (await adminB.request.get(`/api/media/${jpegId}/download`)).status()
    ).toBe(404)
    const stale = await staff.request.get(signedThumb)
    expect(stale.status()).toBeGreaterThanOrEqual(400)

    // Storage: original and derivatives are gone (service client inspection).
    await expect
      .poll(() => storedObjects(inviteeId, jpegId), { timeout: 15_000 })
      .toEqual([])

    await staffContext.close()
    await adminA.context().close()
    await adminB.context().close()
  })
})
