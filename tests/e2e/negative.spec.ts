import { readFile } from "node:fs/promises"

import { expect, test, type Browser, type Page } from "@playwright/test"

import {
  mailboxIds,
  messagesTo,
  SUBJECTS,
  waitForLink,
} from "./helpers/mailpit"
import { hevcMp4, sha256, syntheticJpeg } from "./helpers/media"
import { provisioner, psql } from "./helpers/stack"
import {
  chooseOption,
  libraryList,
  portfolioList,
  tile,
  uploadThroughDialog,
} from "./helpers/ui"
import {
  fixtureEmail,
  provisionWorld,
  seedReadyAssets,
  signedInPage,
  type World,
} from "./helpers/world"

/**
 * Release-gate negative paths (spec §7, §10), Chromium. Each test provisions its
 * own DEV FIXTURE world; every assertion runs as the ordinary user or anonymous
 * client in its own browser context.
 */

async function assetIdsOf(uploaderId: string) {
  const { data, error } = await provisioner()
    .from("media_assets")
    .select("id, original_filename, deleted_at, venue_id")
    .eq("uploader_id", uploaderId)
  if (error) throw error
  return data
}

/**
 * GoTrue allows one link per address per `max_frequency` (1 s in
 * supabase/config.toml); a faster request gets 429, which the app correctly
 * hides behind the neutral "Check your email". Wait out exactly the remainder
 * of that window, computed from the last send time, before asking again.
 */
async function respectSendInterval(email: string) {
  const remainingMs = Number(
    psql(
      `select coalesce(greatest(0, 1100 - extract(epoch from (now() - recovery_sent_at)) * 1000), 0)::int from auth.users where email = '${email}'`
    ) || 0
  )
  if (remainingMs > 0) await new Promise((r) => setTimeout(r, remainingMs))
}

async function requestLinkViaForm(page: Page, email: string) {
  await respectSendInterval(email)
  await page.goto("/login")
  await page.getByLabel("Email").fill(email)
  await page.getByRole("button", { name: "Send sign-in link" }).click()
  await expect(
    page.getByRole("heading", { name: "Check your email" })
  ).toBeVisible()
  await expect(
    page.getByText(`If ${email} has a NabaLens account`, { exact: false })
  ).toBeVisible()
}

async function anonymous(browser: Browser) {
  return (await browser.newContext()).newPage()
}

test.describe("release negatives", () => {
  let world: World
  test.beforeEach(async () => {
    world = await provisionWorld()
  })

  test("staff A is denied staff B's media, portfolio and admin routes; anonymous is denied", async ({
    browser,
  }) => {
    const photo = await syntheticJpeg(`b-only-${world.tag}.jpg`)
    const staffB = await signedInPage(browser, world.staffB)
    await expect(staffB).toHaveURL(/\/staff$/)
    await uploadThroughDialog(staffB, [photo])
    const [asset] = await assetIdsOf(world.staffB.id)

    const staffA = await signedInPage(browser, world.staffA)
    await expect(staffA).toHaveURL(/\/staff$/)
    // Same venue, still nothing of B's in A's own portfolio.
    await expect(
      staffA.getByText("Your portfolio starts here.", { exact: false })
    ).toBeVisible()
    await expect(tile(staffA, "Photo", photo.name)).toHaveCount(0)

    // Direct asset routes by URL: indistinguishable from a missing asset.
    for (const route of ["thumb", "preview", "stream", "download"]) {
      const r = await staffA.request.get(`/api/media/${asset.id}/${route}`, {
        maxRedirects: 0,
      })
      expect(r.status(), route).toBe(404)
    }
    // Admin pages, including B's portfolio, bounce staff to their own home.
    for (const path of [
      "/admin",
      "/admin/staff",
      `/admin/staff/${world.staffB.id}`,
      `/admin?staff=${world.staffB.id}`,
    ]) {
      await staffA.goto(path)
      await expect(staffA, path).toHaveURL(/\/staff$/)
    }
    // Admin-only route handler (avatar) refuses staff.
    const forged = await staffA.request.post(
      `/admin/staff/${world.staffB.id}/avatar`,
      {
        multipart: {
          file: {
            name: "a.png",
            mimeType: "image/png",
            buffer: Buffer.from("x"),
          },
        },
      }
    )
    expect(forged.status()).toBe(403)

    // Signed out: 401 on media, pages go to /login.
    const anon = await anonymous(browser)
    for (const route of ["thumb", "download"]) {
      const r = await anon.request.get(`/api/media/${asset.id}/${route}`, {
        maxRedirects: 0,
      })
      expect(r.status(), route).toBe(401)
    }
    for (const path of [
      "/staff",
      "/admin",
      `/admin/staff/${world.staffB.id}`,
    ]) {
      await anon.goto(path)
      await expect(anon, path).toHaveURL(/\/login$/)
    }

    // B still has their file: nothing above changed it.
    await staffB.reload()
    await expect(tile(portfolioList(staffB), "Photo", photo.name)).toBeVisible()
  })

  test("uninvited email: neutral message, no account, no email", async ({
    page,
  }) => {
    const email = fixtureEmail("uninvited", world.tag)
    await requestLinkViaForm(page, email)
    // GoTrue refuses synchronously (sign-ups disabled), before any mail is sent.
    expect(await messagesTo(email)).toHaveLength(0)
    const found = psql(
      `select count(*) from auth.users where email = '${email}'`
    )
    expect(found).toBe("0")
    // Same copy an invited address gets (no account directory).
    await page.getByRole("button", { name: "Use a different email" }).click()
    await requestLinkViaForm(page, world.staffA.email)
  })

  test("reused and expired magic links offer recovery", async ({ browser }) => {
    const email = world.staffA.email
    // Reused: works once, then refused in another browser.
    const first = await anonymous(browser)
    const seen = await mailboxIds(email)
    await requestLinkViaForm(first, email)
    const link = await waitForLink(email, SUBJECTS.signIn, seen)
    await first.goto(link)
    await expect(first).toHaveURL(/\/staff$/)
    const second = await anonymous(browser)
    await second.goto(link)
    await expect(second).toHaveURL(/\/login\?error=link_invalid$/)
    await expect(
      second.getByText("That sign-in link has expired")
    ).toBeVisible()
    await expect(second.getByLabel("Email")).toBeVisible()

    // Expired: a fresh, unused link whose send time is moved past otp_expiry (1 h).
    const third = await anonymous(browser)
    const seen2 = await mailboxIds(email)
    await requestLinkViaForm(third, email)
    const expiring = await waitForLink(email, SUBJECTS.signIn, seen2)
    psql(
      `update auth.users set recovery_sent_at = now() - interval '2 hours' where email = '${email}'`
    )
    await third.goto(expiring)
    await expect(third).toHaveURL(/\/login\?error=link_invalid$/)
    await expect(third.getByText("That sign-in link has expired")).toBeVisible()
    // Recovery: request a new link from that page and sign in.
    const seen3 = await mailboxIds(email)
    await respectSendInterval(email)
    await third.getByLabel("Email").fill(email)
    await third.getByRole("button", { name: "Send sign-in link" }).click()
    await expect(
      third.getByRole("heading", { name: "Check your email" })
    ).toBeVisible()
    await third.goto(await waitForLink(email, SUBJECTS.signIn, seen3))
    await expect(third).toHaveURL(/\/staff$/)

    // Garbage token.
    await third.context().clearCookies()
    await third.goto("/auth/confirm?token_hash=not-a-real-token&type=email")
    await expect(third).toHaveURL(/\/login\?error=link_invalid$/)
  })

  test("deactivated, already-signed-in staff cannot read, upload or delete", async ({
    browser,
  }) => {
    const kept = await syntheticJpeg(`kept-${world.tag}.jpg`)
    const late = await syntheticJpeg(`late-${world.tag}.jpg`)
    const staff = await signedInPage(browser, world.staffB)
    await uploadThroughDialog(staff, [kept])
    const [asset] = await assetIdsOf(world.staffB.id)
    const portfolio = portfolioList(staff)
    await expect(tile(portfolio, "Photo", kept.name)).toBeVisible()

    // Admin A deactivates through the UI.
    const admin = await signedInPage(browser, world.adminA)
    await admin.goto(`/admin/staff/${world.staffB.id}`)
    await admin.getByRole("button", { name: "Deactivate" }).click()
    await admin
      .getByRole("alertdialog")
      .getByRole("button", { name: "Deactivate" })
      .click()
    await expect(admin.getByText(/is deactivated/)).toBeVisible()

    // Read: the open page's next refresh (focus) is refused.
    await staff.evaluate(() => window.dispatchEvent(new Event("focus")))
    await expect(
      staff
        .getByRole("status")
        .filter({ hasText: "Your account is not active." })
    ).toBeVisible()
    const thumb = await staff.request.get(`/api/media/${asset.id}/thumb`, {
      maxRedirects: 0,
    })
    expect(thumb.status()).toBe(403)

    // Upload from the already-open dialog: refused, nothing reserved.
    await uploadThroughDialog(staff, [late], {
      expectSettled: "0 uploaded · 1 failed",
      close: false,
    })
    await expect(
      staff.getByRole("dialog").getByText("Your account is not active.", {
        exact: false,
      })
    ).toBeVisible()
    await staff.getByRole("button", { name: "Done" }).click()

    // Delete own media: refused with a clear message, the file stays.
    await tile(portfolio, "Photo", kept.name).click()
    await staff
      .getByRole("dialog")
      .getByRole("button", { name: "Delete" })
      .click()
    const confirm = staff.getByRole("alertdialog")
    await confirm.getByRole("button", { name: "Delete" }).click()
    await expect(
      confirm.getByRole("alert").filter({
        hasText: "Your account is not active, so files cannot be removed.",
      })
    ).toBeVisible()

    // Any navigation lands on the blocked page.
    await staff.goto("/staff")
    await expect(staff).toHaveURL(/\/auth\/blocked$/)
    await expect(
      staff.getByRole("heading", { name: "Account unavailable" })
    ).toBeVisible()

    const rows = await assetIdsOf(world.staffB.id)
    expect(rows).toHaveLength(1)
    expect(rows[0].deleted_at).toBeNull()
    // Retained for admins.
    await admin.goto(`/admin?staff=${world.staffB.id}`)
    await expect(tile(libraryList(admin), "Photo", kept.name)).toBeVisible()
  })

  test("venue transfer keeps old attribution; new uploads use the new venue", async ({
    browser,
  }) => {
    const { venue1, venue2, staffC } = world
    const before = await syntheticJpeg(`before-move-${world.tag}.jpg`)
    const after = await syntheticJpeg(`after-move-${world.tag}.jpg`)
    const staff = await signedInPage(browser, staffC)
    await expect(staff.getByText(venue2.name)).toBeVisible()
    await uploadThroughDialog(staff, [before])

    const admin = await signedInPage(browser, world.adminA)
    await admin.goto(`/admin/staff/${staffC.id}`)
    await admin.getByRole("button", { name: "Edit details" }).click()
    const edit = admin.getByRole("dialog")
    await chooseOption(admin, edit, "Venue", venue1.name)
    await edit.getByRole("button", { name: "Save changes" }).click()
    await expect(edit).toBeHidden()

    await staff.reload()
    await expect(staff.getByText(venue1.name)).toBeVisible()
    await uploadThroughDialog(staff, [after])

    const rows = await assetIdsOf(staffC.id)
    const venueOf = (name: string) =>
      rows.find((r) => r.original_filename === name)!.venue_id
    expect(venueOf(before.name)).toBe(venue2.id)
    expect(venueOf(after.name)).toBe(venue1.id)

    await admin.goto(`/admin?staff=${staffC.id}`)
    const library = libraryList(admin)
    await expect(
      tile(library, "Photo", before.name, `, by ${staffC.name}, ${venue2.name}`)
    ).toBeVisible()
    await expect(
      tile(library, "Photo", after.name, `, by ${staffC.name}, ${venue1.name}`)
    ).toBeVisible()
    await tile(library, "Photo", before.name).click()
    await expect(admin.getByRole("dialog").getByText(venue2.name)).toBeVisible()
  })

  test("unsupported-codec video shows the fallback; the original still downloads", async ({
    browser,
  }) => {
    const hevc = hevcMp4(`hevc-${world.tag}.mp4`)
    const staff = await signedInPage(browser, world.staffC)
    await uploadThroughDialog(staff, [hevc])

    const admin = await signedInPage(browser, world.adminA)
    await admin.goto(`/admin?staff=${world.staffC.id}`)
    await tile(libraryList(admin), "Video", hevc.name).click()
    const viewer = admin.getByRole("dialog")
    // Either the engine really decodes it (frames have size) or the explicit
    // fallback is shown. A dead, blank player is a failure.
    const fallback = viewer.getByText("Preview unavailable in this browser")
    await expect
      .poll(
        async () =>
          (await fallback.isVisible())
            ? "fallback"
            : await viewer
                .locator("video")
                .evaluate((v: HTMLVideoElement) =>
                  v.videoWidth > 0 ? "decoded" : "pending"
                )
                .catch(() => "pending"),
        { timeout: 15_000 }
      )
      .not.toBe("pending")
    test.info().annotations.push({
      type: "hevc preview",
      description: (await fallback.isVisible()) ? "fallback shown" : "decoded",
    })

    const [download] = await Promise.all([
      admin.waitForEvent("download"),
      viewer.getByRole("link", { name: "Download original" }).click(),
    ])
    expect(await download.failure()).toBeNull()
    expect(
      sha256(new Uint8Array(await readFile((await download.path())!)))
    ).toBe(hevc.sha256)
  })

  test("empty states and a failed download", async ({ browser }) => {
    // New staff: empty portfolio with the upload call to action.
    const staff = await signedInPage(browser, world.staffA)
    await expect(
      staff.getByText(
        "Your portfolio starts here. Upload your first photo or video."
      )
    ).toBeVisible()

    const admin = await signedInPage(browser, world.adminA)
    // Admin portfolio of someone without uploads.
    await admin.goto(`/admin/staff/${world.staffA.id}`)
    await expect(
      admin.getByText(`${world.staffA.name} has no uploads yet`)
    ).toBeVisible()
    // Filters that match nothing, and clearing them.
    await admin.goto(`/admin?staff=${world.staffA.id}&type=video`)
    await expect(
      admin.getByText("Nothing matches these filters.")
    ).toBeVisible()
    await admin.getByRole("button", { name: "Clear filters" }).click()
    await expect(admin).toHaveURL(/\/admin$/)

    // A ready record whose original is missing from storage (fixture): the
    // download is refused, and the library stays usable.
    const [id] = await seedReadyAssets(
      world.staffA.id,
      world.venue1.id,
      1,
      "image",
      `missing-${world.tag}`
    )
    const name = `missing-${world.tag}-01.jpg`
    await admin.goto(`/admin?staff=${world.staffA.id}`)
    await tile(libraryList(admin), "Photo", name).click()
    const viewer = admin.getByRole("dialog")
    await expect(
      viewer.getByText("Preview unavailable in this browser")
    ).toBeVisible()
    const response = await admin.request.get(`/api/media/${id}/download`)
    expect(response.status()).toBe(404)
    const [download] = await Promise.all([
      admin.waitForEvent("download"),
      viewer.getByRole("link", { name: "Download original" }).click(),
    ])
    expect(await download.failure()).not.toBeNull()
    await expect(admin).toHaveURL(
      new RegExp(`/admin\\?staff=${world.staffA.id}`)
    )
    await expect(
      viewer.getByRole("link", { name: "Download original" })
    ).toBeVisible()
    test.info().annotations.push({
      type: "failed download UX",
      description: `browser download failure: ${await download.failure()}; no in-app message`,
    })
  })

  test("admin portfolio offers download and delete (spec §3)", async ({
    browser,
  }) => {
    // KNOWN DEFECT on this base (078b60a): /admin/staff/[id] renders a
    // preview-only viewer. feat/nl-library f3ee17b moves it onto MediaGallery.
    // When that merges this test passes and test.fail() must be removed.
    test.fail()
    const photo = await syntheticJpeg(`portfolio-${world.tag}.jpg`)
    const staff = await signedInPage(browser, world.staffA)
    await uploadThroughDialog(staff, [photo])
    const admin = await signedInPage(browser, world.adminA)
    await admin.goto(`/admin/staff/${world.staffA.id}`)
    await tile(admin, "Photo", photo.name).click()
    const viewer = admin.getByRole("dialog")
    await expect(
      viewer.getByRole("link", { name: "Download original" })
    ).toBeVisible({ timeout: 5_000 })
    await expect(viewer.getByRole("button", { name: "Delete" })).toBeVisible()
  })
})
