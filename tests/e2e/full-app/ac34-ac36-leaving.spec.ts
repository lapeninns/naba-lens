import { expect, test, type Page } from "@playwright/test"

import { signIn } from "../../support/identities"
import { acceptPlacePhoto } from "../helpers/accepted"
import { openEmailLink } from "../helpers/email-link"
import {
  addPhotos,
  addSheet,
  assetNamed,
  keep,
  openAlbum,
  postAndLabel,
  SIZES,
  sql,
  uploadStateOf,
} from "../helpers/full-app"
import { provisionManagerWorld } from "../helpers/manager-world"
import { syntheticJpeg } from "../helpers/media"
import { provisioner, psql } from "../helpers/stack"
import { escape } from "../helpers/ui"
import { signedInPage, type Person } from "../helpers/world"

/**
 * AC34 (spec §16, S1-PEOPLE): a staff member leaves. Their access ends at
 * once, and the photos the venue accepted stay, still credited to them.
 * AC36 (spec §5.6): on a shared phone, the next person to sign in sees none
 * of the previous person's private previews or unsent photos.
 */

test.skip(({ browserName }) => browserName !== "chromium", "Chromium only")

const SIGNED_PUT = /\/storage\/v1\/object\/upload\/sign\//

async function signInOn(page: Page, who: Pick<Person, "email">) {
  const { data, error } = await provisioner().auth.admin.generateLink({
    type: "magiclink",
    email: who.email,
  })
  if (error) throw error
  await openEmailLink(
    page,
    `/auth/confirm?token_hash=${data.properties.hashed_token}&type=email`,
    who.email
  )
}

test("AC34 a leaver loses access at once; accepted photos and their credit remain", async ({
  browser,
}, info) => {
  test.setTimeout(180_000)
  const w = await provisionManagerWorld()
  const photo = await syntheticJpeg(`ac34-${w.tag}.jpg`)
  const staff = await signedInPage(browser, w.staffA1, SIZES.phone)
  await openAlbum(staff)
  await postAndLabel(staff, [photo], "soup", "Soup")
  const id = await assetNamed(photo.name)
  await expect.poll(() => uploadStateOf(id), { timeout: 60_000 }).toBe("ready")
  acceptPlacePhoto(id, w.mgrA.id)

  // The manager removes them from their only venue (Team, S1-PEOPLE).
  const managerDb = await signIn(provisioner(), w.mgrA.email)
  const { data, error } = await (
    managerDb.rpc as unknown as (
      n: string,
      a: Record<string, unknown>
    ) => PromiseLike<{ data: unknown; error: { message: string } | null }>
  )("remove_venue_member", {
    p_profile_id: w.staffA1.id,
    p_venue_id: w.venueA.id,
    p_reason: "DEV FIXTURE: left the business",
  })
  expect(error).toBeNull()
  expect(JSON.stringify(data)).toContain("deactivated")

  // Their open session ends: the next page is not the app.
  await staff.goto("/staff/home")
  await expect(staff).not.toHaveURL(/\/staff\//)
  await keep(staff, info, "ac34-leaver")
  expect(
    (
      await staff.request.get(`/api/media/${id}/thumb`, { maxRedirects: 0 })
    ).status()
  ).toBeGreaterThanOrEqual(400)

  // The business keeps the photo, still credited to them.
  expect(
    psql(
      `select deleted_at is null and uploader_id = ${sql(w.staffA1.id)}::uuid
       from public.media_assets where id = ${sql(id)}::uuid`
    )
  ).toBe("t")
  // (Colleagues no longer see a deactivated person's photos: the community
  // rule in negative.spec.ts. The business record is the admin library.)
  const admin = await signedInPage(browser, w.admin, SIZES.desktop)
  await admin.goto(`/admin?staff=${w.staffA1.id}`)
  await expect(
    admin.getByRole("list", { name: "Library" }).getByRole("button", {
      name: new RegExp(
        `^Photo, ${escape(photo.name)}, by ${escape(w.staffA1.name)}`
      ),
    })
  ).toBeVisible()
  await keep(admin, info, "ac34-admin-library")
  await admin.context().close()
  await staff.context().close()
})

test("AC36 the next person on a shared phone sees none of the last person's previews or unsent photos", async ({
  browser,
}, info) => {
  test.setTimeout(240_000)
  const w = await provisionManagerWorld()
  const sent = await syntheticJpeg(`ac36-sent-${w.tag}.jpg`)
  const unsent = await syntheticJpeg(`ac36-unsent-${w.tag}.jpg`)
  const page = await signedInPage(browser, w.staffA1, SIZES.phone)
  const context = page.context()

  // A sends one photo and leaves one unsent on the phone (its transfer fails).
  let block = false
  await context.route(SIGNED_PUT, (route) =>
    block ? route.abort("connectionreset") : route.continue()
  )
  await openAlbum(page)
  await postAndLabel(page, [sent], "soup", "Soup")
  const sentId = await assetNamed(sent.name)
  await expect
    .poll(() => uploadStateOf(sentId), { timeout: 60_000 })
    .toBe("ready")
  block = true
  await addPhotos(page, [unsent.path])
  const unsentId = await assetNamed(unsent.name)
  // Its transfer fails: it needs attention on this phone, never Posted.
  await expect(
    addSheet(page)
      .getByRole("status")
      .filter({ hasText: /posted/ })
  ).toContainText("need attention", { timeout: 120_000 })
  await page.keyboard.press("Escape")
  await keep(page, info, "ac36-a-before-sign-out")

  // A logs out from Me's Settings (the phone's place for it), explaining
  // unsent work.
  await page.goto("/staff/me/settings")
  page.once("dialog", (d) => void d.accept())
  await page.getByRole("button", { name: "Log out" }).click()
  const confirm = page.getByRole("alertdialog")
  if (await confirm.isVisible().catch(() => false))
    await confirm.getByRole("button", { name: /Log out/ }).click()
  await expect(page).toHaveURL(/\/login/)
  await expect(
    page.getByRole("status").filter({ hasText: "You have signed out." })
  ).toBeVisible()
  block = false

  // Nothing of A's is left on the phone. The sign-in card wipes it once it
  // has loaded (app/login/login-card-host.tsx), before anyone can type.
  await expect
    .poll(() =>
      page.evaluate(
        async ({ sentId, unsentId }) => {
          const uploadKeys = Object.keys(localStorage).filter((key) =>
            /upload-keys|tus::|capture/.test(key)
          )
          const hasJournal = (await indexedDB.databases()).some(
            (db) => db.name === "nabalens-capture-journal"
          )
          const previewCaches: string[] = []
          if ("caches" in window)
            for (const name of await caches.keys())
              for (const request of await (await caches.open(name)).keys())
                if (
                  request.url.includes(sentId) ||
                  request.url.includes(unsentId)
                )
                  previewCaches.push(name)
          return { uploadKeys, hasJournal, previewCaches }
        },
        { sentId, unsentId }
      )
    )
    .toEqual({ uploadKeys: [], hasJournal: false, previewCaches: [] })

  // B signs in on the same phone.
  await signInOn(page, w.staffA2)
  await openAlbum(page)
  const html = async () => page.content()
  // Album, My photos, Me and Today (DESIGN.md §5d, §5e, §5b, §5c).
  for (const path of [
    "/staff/album",
    "/staff/photos",
    "/staff/me",
    "/staff/home",
  ]) {
    await page.goto(path)
    await expect(page.locator("main")).toBeVisible()
    await page.waitForLoadState("networkidle")
    const content = await html()
    // A's posted photo is in the venue's private Album, which B shares
    // (D21); it is never in B's own photos or Me.
    if (path === "/staff/photos" || path === "/staff/me")
      expect(content, `${path}: A's sent photo`).not.toContain(sentId)
    expect(content, `${path}: A's unsent photo`).not.toContain(unsentId)
    expect(content, `${path}: A's file names`).not.toContain(unsent.name)
  }
  // Today's Unfinished row is absent: the Add queue holds none of A's photos.
  await expect(page.locator('[data-slot="unfinished-row"]')).toHaveCount(0)
  await expect(
    page.locator('[data-slot="album-add"]').filter({ visible: true }).first()
  ).toHaveAccessibleName("Add photos")
  // And B's session cannot fetch A's unreviewed previews.
  for (const id of [sentId, unsentId]) {
    expect(
      (
        await page.request.get(`/api/media/${id}/thumb`, { maxRedirects: 0 })
      ).status()
    ).toBe(404)
  }
  await keep(page, info, "ac36-b-after-sign-in")
  await context.close()
})
