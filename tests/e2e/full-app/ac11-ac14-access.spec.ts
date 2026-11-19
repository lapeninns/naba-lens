import { expect, test, type Page } from "@playwright/test"

import { signIn, type Db } from "../../support/identities"
import { seedImages } from "../helpers/coverage-world"
import {
  assetNamed,
  foreignLabels,
  keep,
  matchBySearch,
  matchSummary,
  openAlbum,
  SIZES,
  sql,
  startMatch,
  uploadStateOf,
  venueOfAsset,
} from "../helpers/full-app"
import { provisionManagerWorld } from "../helpers/manager-world"
import { syntheticJpeg } from "../helpers/media"
import { provisioner, psql } from "../helpers/stack"
import { escape, STAFF_LANDING } from "../helpers/ui"
import { signedInPage } from "../helpers/world"

/**
 * Access during upload and across venues (spec §3, §5.6, §6 S2, §16; FA-22):
 * AC11 the venue changes while Match is open: no label from the old venue
 *      survives on a photo, and Match says where the photos now go;
 * AC12 the person's membership is removed mid-upload: finalisation is
 *      refused and the bytes stay private;
 * AC13 staff use another venue's ids directly: no data, preview, export or
 *      change;
 * AC14 a person manages A and is staff at B: manager rights only at A.
 */

test.skip(({ browserName }) => browserName !== "chromium", "Chromium only")

type Rpc = (
  name: string,
  args: Record<string, unknown>
) => PromiseLike<{ data: unknown; error: { message: string } | null }>
const rpc = (db: Db) => db.rpc.bind(db) as unknown as Rpc

async function adminCall(
  adminEmail: string,
  name: string,
  args: Record<string, unknown>
) {
  const db = await signIn(provisioner(), adminEmail)
  const { data, error } = await rpc(db)(name, args)
  if (error) throw new Error(`${name}: ${error.message}`)
  return data
}

/**
 * The venue switcher on Me's Settings (or the manager's Team):
 * "Work at another venue", Change venue. A staff role lands on Today.
 */
async function switchVenue(page: Page, path: string, venueName: string) {
  await page.goto(path)
  await page.getByRole("combobox", { name: "Work at another venue" }).click()
  await page
    .getByRole("option", { name: new RegExp(`^${escape(venueName)}`) })
    .click()
  await page.getByRole("button", { name: "Change venue" }).click()
}

const finaliseFor = (body: string) =>
  body.includes('"assetId"') && body.includes('"idempotencyKey"')

test("AC11 a venue change during Match leaves no old-venue label on any photo", async ({
  browser,
}, info) => {
  test.setTimeout(240_000)
  const w = await provisionManagerWorld()
  // Staff at A, and also staff at B.
  await adminCall(w.admin.email, "admin_set_venue_membership", {
    p_profile_id: w.staffA1.id,
    p_venue_id: w.venueB.id,
    p_role: "staff",
    p_reason: "DEV FIXTURE: covers shifts at B",
  })
  const files = await Promise.all(
    ["1", "2", "3"].map((n) => syntheticJpeg(`ac11-${n}-${w.tag}.jpg`))
  )
  const page = await signedInPage(browser, w.staffA1, SIZES.phone)
  await openAlbum(page)
  const { match } = await startMatch(
    page,
    files.map((f) => f.path)
  )
  await expect(match.locator('[data-slot="match-venue"]')).toHaveText(
    `For ${w.venueA.name}`
  )
  await matchBySearch(match, "soup", "Soup")

  // Another tab on the same phone moves the person to venue B.
  const other = await page.context().newPage()
  await switchVenue(other, "/staff/me/settings", w.venueB.name)
  await expect(other).toHaveURL(STAFF_LANDING)
  await openAlbum(other)
  await expect(other.locator('[data-slot="album-landing"]')).toContainText(
    w.venueB.name
  )
  await other.close()

  // Back in Match: it now says B and offers B's slots (S3-E2E-1 E7, fixed
  // by S3-R3: the other tab's switch reaches this one).
  await page.bringToFront()
  await expect(match.locator('[data-slot="match-venue"]')).toHaveText(
    `For ${w.venueB.name}`,
    { timeout: 15_000 }
  )
  await expect(match).toContainText(
    `You are now adding photos for ${w.venueB.name}.`
  )
  await keep(page, info, "ac11-after-switch")
  // The person answers with what Match offers (A's Pie and Lager when Match
  // did not notice the switch, B's when it did).
  await matchBySearch(match, "pie", "Pie")
  await matchBySearch(match, "lager", "Lager")
  await expect(matchSummary(page)).toBeVisible()
  await keep(page, info, "ac11-summary")
  const summaryVenue = await page
    .locator('[data-slot="match-summary-venue"]')
    .textContent()

  // Whatever was sent, no photo carries another venue's label.
  for (const f of files) {
    const n = Number(
      psql(`select count(*) from public.media_assets
        where original_filename = ${sql(f.name)} and deleted_at is null`)
    )
    if (n === 0) continue
    const id = await assetNamed(f.name)
    await expect
      .poll(() => foreignLabels(id), { timeout: 30_000, message: f.name })
      .toBe(0)
  }
  // Photos answered after the switch: sent to B, or not sent at all, and
  // the end never names a venue they did not go to.
  for (const f of files.slice(1)) {
    const n = Number(
      psql(`select count(*) from public.media_assets
        where original_filename = ${sql(f.name)} and deleted_at is null and upload_state = 'ready'`)
    )
    if (n === 0) continue
    const id = await assetNamed(f.name)
    expect(venueOfAsset(id), f.name).toBe(w.venueB.id)
    expect(summaryVenue, "the end names where they went").not.toContain(
      w.venueA.name
    )
  }
  await page.context().close()
})

test("AC12 removed from the venue mid-upload: finalise is refused; the bytes stay private", async ({
  browser,
}, info) => {
  test.setTimeout(180_000)
  const w = await provisionManagerWorld()
  const photo = await syntheticJpeg(`ac12-${w.tag}.jpg`)
  const page = await signedInPage(browser, w.staffA2, SIZES.phone)
  // Hold the first finalise until the membership is gone.
  let release!: () => void
  const held = new Promise<void>((r) => (release = r))
  let seen!: () => void
  const reached = new Promise<void>((r) => (seen = r))
  await page.route("**/*", async (route) => {
    const r = route.request()
    if (
      r.method() !== "POST" ||
      !r.headers()["next-action"] ||
      !finaliseFor(r.postData() ?? "")
    )
      return route.fallback()
    seen()
    await held
    return route.continue()
  })
  await openAlbum(page)
  const { match } = await startMatch(page, [photo.path])
  await matchBySearch(match, "soup", "Soup")
  await reached
  const id = await assetNamed(photo.name)

  // The manager removes them from their only venue.
  const managerDb = await signIn(provisioner(), w.mgrA.email)
  const removed = await rpc(managerDb)("remove_venue_member", {
    p_profile_id: w.staffA2.id,
    p_venue_id: w.venueA.id,
    p_reason: "DEV FIXTURE: left the business",
  })
  expect(removed.error).toBeNull()
  release()

  // Not finalised, now or later.
  await page.waitForTimeout(3_000)
  expect(uploadStateOf(id)).not.toBe("ready")
  await keep(page, info, "ac12-after-removal")
  // The stored bytes are private: no public URL, and a colleague and an
  // anonymous visitor get nothing through the app.
  const path = psql(
    `select original_path from public.media_assets where id = ${sql(id)}::uuid`
  )
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const anon = await browser.newContext()
  expect(
    (
      await anon.request.get(`${base}/storage/v1/object/public/media/${path}`)
    ).status()
  ).toBeGreaterThanOrEqual(400)
  expect(
    (
      await anon.request.get(`/api/media/${id}/thumb`, { maxRedirects: 0 })
    ).status()
  ).toBe(401)
  await anon.close()
  const colleague = await signedInPage(browser, w.staffA1, SIZES.phone)
  for (const route of ["thumb", "preview", "stream", "download"]) {
    const res = await colleague.request.get(`/api/media/${id}/${route}`, {
      maxRedirects: 0,
    })
    expect(res.status(), route).toBe(404)
  }
  await colleague.context().close()
  await page.context().close()
})

test("AC13 staff using another venue's ids get no data, preview, export or change", async ({
  browser,
}) => {
  test.setTimeout(180_000)
  const w = await provisionManagerWorld()
  // A photo at venue B, accepted there (so B's own staff could see it).
  const [bPhoto] = await seedImages(w.mgrB, w.venueB, 1, {
    prefix: `ac13-b-${w.tag}`,
  })
  const page = await signedInPage(browser, w.staffA1, SIZES.desktop)

  // Media routes.
  for (const route of ["thumb", "preview", "stream", "download"]) {
    const res = await page.request.get(`/api/media/${bPhoto}/${route}`, {
      maxRedirects: 0,
    })
    expect([403, 404], route).toContain(res.status())
  }
  // B's slot page, B's manager and export screens.
  await page.goto(`/staff/album/slot/dish/${w.itemsB.soup}`)
  await expect(
    page.getByText(/can't find|not found|isn't available/i).first()
  ).toBeVisible()
  for (const path of [
    "/manager",
    `/manager/review/photo/${bPhoto}`,
    `/admin/library/${bPhoto}`,
  ]) {
    await page.goto(path)
    await expect(page, path).toHaveURL(STAFF_LANDING)
  }
  // Direct database calls in their own session.
  const db = await signIn(provisioner(), w.staffA1.email)
  const label = await rpc(db)("save_media_labels", {
    p_asset_id: bPhoto,
    p_expected_revision: 0,
    p_content_types: [],
    p_note: null,
    p_items: [{ itemId: w.itemsB.soup, variantId: null }],
    p_missing_item: null,
    p_catalogue_version_id: psql(
      `select id from public.menu_versions where venue_id = ${sql(w.venueB.id)}::uuid and status = 'active'`
    ),
  })
  expect(label.error, "label another venue's photo").not.toBeNull()
  const sw = await rpc(db)("switch_active_venue", { p_venue_id: w.venueB.id })
  expect(sw.error, "switch to a venue they don't work at").not.toBeNull()
  const exp = await rpc(db)("export_candidates", {
    p_venue_id: w.venueB.id,
    p_mode: "public",
  })
  expect(exp.error, "export B's photos").not.toBeNull()
  const request = await rpc(db)("media_request_create", {
    p_venue_id: w.venueB.id,
    p_type: "missing_photo",
    p_intended_use: "public",
    p_brief: "x",
    p_slot_kind: "dish",
    p_slot_id: w.itemsB.pie,
    p_photo_count: 1,
    p_priority: "normal",
    p_wants_video: false,
  })
  expect(request.error, "ask for a photo at B").not.toBeNull()
  const { data: rows } = await db
    .from("media_assets")
    .select("id")
    .eq("venue_id", w.venueB.id)
  expect(rows ?? []).toHaveLength(0)
  // The profile still says A: nothing above moved them.
  expect(
    psql(
      `select venue_id from public.profiles where id = ${sql(w.staffA1.id)}::uuid`
    )
  ).toBe(w.venueA.id)
  await page.context().close()
})

test("AC14 manager at A and staff at B: manager rights apply only at A", async ({
  browser,
}, info) => {
  test.setTimeout(180_000)
  const w = await provisionManagerWorld()
  // mgrA manages A and is also staff at B.
  await adminCall(w.admin.email, "admin_set_venue_membership", {
    p_profile_id: w.mgrA.id,
    p_venue_id: w.venueB.id,
    p_role: "staff",
    p_reason: "DEV FIXTURE: helps out at B",
  })
  const [aPhoto] = await seedImages(w.staffA1, w.venueA, 1, {
    prefix: `ac14-a-${w.tag}`,
  })
  const [bPhoto] = await seedImages(w.mgrB, w.venueB, 1, {
    prefix: `ac14-b-${w.tag}`,
  })
  const page = await signedInPage(browser, w.mgrA, SIZES.desktop)

  // At A: the manager workspace, and A's photo in review.
  await page.goto(`/manager/review/photo/${aPhoto}`)
  await expect(page).toHaveURL(new RegExp(`/manager/review/photo/${aPhoto}$`))
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible()
  // Never B's photo, even while managing A.
  await page.goto(`/manager/review/photo/${bPhoto}`)
  await expect(
    page.getByText(/can't find|not found|isn't available/i).first()
  ).toBeVisible()

  // Working at B: staff only.
  await switchVenue(page, "/manager/team", w.venueB.name)
  await expect(page).toHaveURL(STAFF_LANDING)
  await openAlbum(page)
  await expect(page.locator('[data-slot="album-landing"]')).toContainText(
    w.venueB.name
  )
  await keep(page, info, "ac14-at-b")
  for (const path of [
    "/manager",
    "/manager/review",
    `/manager/review/photo/${bPhoto}`,
  ]) {
    await page.goto(path)
    await expect(page, path).not.toHaveURL(/\/manager/)
  }
  // And in the database: no manager decision at B.
  const db = await signIn(provisioner(), w.mgrA.email)
  const { data: team, error: teamError } = await rpc(db)("venue_team", {
    p_venue_id: w.venueB.id,
  })
  expect(
    teamError ?? (Array.isArray(team) && team.length === 0 ? "empty" : null)
  ).not.toBeNull()
  const decide = await rpc(db)("remove_venue_member", {
    p_profile_id: w.mgrB.id,
    p_venue_id: w.venueB.id,
    p_reason: "should be refused",
  })
  expect(decide.error, "remove a member at B").not.toBeNull()
  expect(
    psql(`select count(*) from public.venue_memberships
      where profile_id = ${sql(w.mgrB.id)}::uuid and venue_id = ${sql(w.venueB.id)}::uuid
        and ended_at is null`)
  ).toBe("1")
  await page.context().close()
})
