import {
  devices,
  expect,
  test,
  type BrowserContextOptions,
  type Locator,
  type Page,
  type TestInfo,
} from "@playwright/test"

import { openEmailLink } from "./helpers/email-link"
import { mailboxIds, waitForSignInEmail } from "./helpers/mailpit"
import {
  labelledPhoto,
  MENU_SIZE,
  photoRow,
  preferredAsset,
  provisionManagerWorld,
} from "./helpers/manager-world"
import { syntheticJpeg } from "./helpers/media"
import { psql, requireIsolatedStack } from "./helpers/stack"
import {
  escape,
  openPortfolio,
  STAFF_LANDING,
  uploadThroughDialog,
} from "./helpers/ui"
import { signedInPage, type Person } from "./helpers/world"

/**
 * The venue manager workspace (/manager) in the built app, Phase 2 (spec
 * §6.6): sign-in lands managers on /manager, wrong-role navigation, no way to
 * add photos, Overview counts against the active menu, the review journey
 * (staff upload and label → accept → menu photo → staff Our menu), relink
 * with a reason, ask for another photo, withdraw, the Unlabelled photos
 * filter, venue isolation and a revoked manager. Managers are real venue
 * manager accounts (helpers/manager-world); every decision goes through the
 * pages. The service role only seeds menus, photo bytes and the conversion's
 * admin session, and reads the database to check what a page did.
 *
 * Runs on `chromium` at 1280x800 and on `mobile-chromium` at 390x844 with
 * touch (each test makes its own contexts at the project's viewport).
 */

test.describe.configure({ mode: "serial" })
test.beforeAll(() => requireIsolatedStack())
test.setTimeout(240_000)

const PHONE: BrowserContextOptions = {
  viewport: { width: 390, height: 844 },
  userAgent: devices["Pixel 7"].userAgent,
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
}
const DESKTOP: BrowserContextOptions = {
  viewport: { width: 1280, height: 800 },
}

const view = (info: TestInfo) =>
  info.project.name === "mobile-chromium" ? PHONE : DESKTOP

const OVERVIEW = /\/manager$/

// Journey evidence: the final state of every page the test left open.
test.afterEach(async ({ browser }, testInfo) => {
  let n = 0
  for (const context of browser.contexts()) {
    for (const page of context.pages()) {
      n += 1
      const body = await page.screenshot().catch(() => null)
      if (body)
        await testInfo.attach(`final-page-${n}`, {
          body,
          contentType: "image/png",
        })
    }
    await context.close().catch(() => undefined)
  }
})

/** A full-page screenshot kept in the test's output folder, pass or fail. */
async function evidence(page: Page, name: string) {
  const path = test.info().outputPath(`${name}.png`)
  await page.screenshot({ path, fullPage: true })
  await test.info().attach(name, { path, contentType: "image/png" })
}

function note(type: string, description: string) {
  test.info().annotations.push({ type, description })
}

/** The nav link a manager sees at this width (sidebar or bottom bar). */
const navLink = (page: Page, name: RegExp) =>
  page
    .getByRole("navigation", { name: "Venue workspace" })
    .getByRole("link", { name })
    .filter({ visible: true })
    .first()

const main = (page: Page) => page.getByRole("main")

/** A Review card by its staff label and contributor. */
const card = (page: Page, label: string, who: Person) =>
  page
    .getByRole("list", { name: "Photos to review" })
    .getByRole("article")
    .filter({ hasText: label })
    .filter({ hasText: who.name })

/** Clicks a card action, opening "More actions" first when it is tucked away. */
async function cardAction(page: Page, scope: Locator, name: string) {
  const button = scope.getByRole("button", { name, exact: true })
  if (!(await button.isVisible())) {
    await scope.getByRole("button", { name: "More actions" }).click()
  }
  await button.click()
}

async function statusFilter(page: Page, name: string) {
  await page
    .getByRole("group", { name: "Status" })
    .getByRole("button", { name, exact: true })
    .click()
  await expect(
    page
      .getByRole("group", { name: "Status" })
      .getByRole("button", { name, exact: true })
  ).toHaveAttribute("aria-pressed", "true")
}

const staffProgress = (page: Page, covered: number) =>
  main(page).getByText(
    `${covered} of ${MENU_SIZE} menu items have an accepted photo.`,
    { exact: true }
  )

/** Pages a manager can open; none may offer to add or upload photos. */
async function expectNoAddControls(page: Page, path: string) {
  await page.goto(path)
  await expect(main(page)).toBeVisible()
  const adding = /upload|add (a )?photo|add photos|^add\b|take a photo/i
  await expect(page.getByRole("button", { name: adding })).toHaveCount(0)
  await expect(page.getByRole("link", { name: adding })).toHaveCount(0)
  await expect(page.locator('input[type="file"]')).toHaveCount(0)
}

async function requestSignIn(page: Page, email: string) {
  await page.goto("/login")
  await page.getByLabel("Email").fill(email)
  await page.getByRole("button", { name: "Send sign-in link" }).click()
  await expect(
    page.getByRole("heading", { name: "Check your email" })
  ).toBeVisible()
}

test.describe("venue manager workspace (Phase 2)", () => {
  test("sign-in: a manager lands on /manager by link and by code; wrong-role navigation goes home", async ({
    browser,
  }, info) => {
    const w = await provisionManagerWorld()

    // mgrA: the emailed link.
    const linkContext = await browser.newContext(view(info))
    const byLink = await linkContext.newPage()
    const seenA = await mailboxIds(w.mgrA.email)
    await requestSignIn(byLink, w.mgrA.email)
    const { link } = await waitForSignInEmail(w.mgrA.email, seenA)
    await openEmailLink(byLink, link)
    await expect(byLink).toHaveURL(OVERVIEW)
    await expect(
      byLink.getByRole("heading", { level: 1, name: "Overview" })
    ).toBeVisible()
    await expect(navLink(byLink, /^Review/)).toBeVisible()

    // mgrB: the code from the same email, entered on the login page.
    const codeContext = await browser.newContext(view(info))
    const byCode = await codeContext.newPage()
    const seenB = await mailboxIds(w.mgrB.email)
    await requestSignIn(byCode, w.mgrB.email)
    const { code } = await waitForSignInEmail(w.mgrB.email, seenB)
    await byCode.getByRole("textbox", { name: "Sign-in code" }).fill(code)
    await byCode.getByRole("button", { name: "Sign in with code" }).click()
    await expect(byCode).toHaveURL(OVERVIEW)
    await expect(main(byCode)).toContainText(w.venueB.name)

    // A manager account opening staff or admin pages goes to /manager.
    for (const path of [
      "/",
      "/staff",
      "/staff/tasks",
      "/staff/menu",
      "/staff/manage",
      "/staff/manage/review",
      "/admin",
      "/admin/staff",
      `/admin/coverage/${w.venueA.id}/menu-photos`,
    ]) {
      await byLink.goto(path)
      await expect(byLink, `manager on ${path}`).toHaveURL(OVERVIEW)
    }

    // Staff and admins opening /manager go to their own home.
    const staff = await signedInPage(browser, w.staffA1, view(info))
    for (const path of ["/manager", "/manager/review", "/manager/menu"]) {
      await staff.goto(path)
      await expect(staff, `staff on ${path}`).toHaveURL(STAFF_LANDING)
    }
    const admin = await signedInPage(browser, w.admin, view(info))
    await admin.goto("/manager")
    await expect(admin).toHaveURL(/\/admin$/)
    note("roles", "manager (link, code), staff, admin")
  })

  test("Overview counts match the active menu; no page offers to add or upload photos", async ({
    browser,
  }, info) => {
    const w = await provisionManagerWorld()
    const soupPhoto = await labelledPhoto(w.staffA1, w.venueA, [w.itemsA.soup])
    await labelledPhoto(w.staffA2, w.venueA, [w.itemsA.pie])

    // What the database says the active menu holds (food and drinks items).
    const eligible = Number(
      psql(`select count(distinct e.item_id) from public.menu_entries e
        join public.menu_versions v on v.id = e.version_id and v.status = 'active'
        join public.menu_sections s on s.id = e.section_id and s.kind in ('food', 'drinks')
        where v.venue_id = '${w.venueA.id}'::uuid`)
    )
    expect(eligible).toBe(MENU_SIZE)

    const mgr = await signedInPage(browser, w.mgrA, view(info))
    await expect(mgr).toHaveURL(OVERVIEW)
    await expect(
      main(mgr).getByRole("heading", {
        name: `Menu photos · 0 of ${eligible} items covered`,
      })
    ).toBeVisible()
    await expect(
      main(mgr).getByText("2 photos waiting for a decision")
    ).toBeVisible()
    await expect(navLink(mgr, /^Review.*2 photos waiting/)).toBeVisible()
    for (const section of [
      "Starters: 0 of 2",
      "Mains: 0 of 1",
      "Drinks: 0 of 1",
    ])
      await expect(main(mgr).getByText(section)).toBeVisible()
    await evidence(mgr, "overview-counts")

    // Menu lists every active item, grouped by section.
    await mgr.goto("/manager/menu")
    for (const name of ["Soup", "Salad", "Pie", "Lager"])
      await expect(
        main(mgr).getByRole("link", { name, exact: true })
      ).toBeVisible()

    for (const path of [
      "/manager",
      "/manager/review",
      "/manager/review?status=all",
      "/manager/review?status=unlabelled",
      "/manager/menu",
      `/manager/menu/${w.itemsA.soup}`,
      `/manager/review/contributors/${w.staffA1.id}`,
      "/manager/account",
    ]) {
      await expectNoAddControls(mgr, path)
    }
    // The photo itself is reachable through the private route.
    const thumb = await mgr.request.get(`/api/menu-photos/${soupPhoto}/thumb`, {
      maxRedirects: 0,
    })
    expect(thumb.status()).toBe(302)
    note("overview", `0 of ${eligible} items covered; 2 photos waiting`)
  })

  test("journey: staff upload and label → manager accepts → sets the menu photo → staff Our menu updates", async ({
    browser,
  }, info) => {
    const w = await provisionManagerWorld()

    // Staff 1 uploads a JPEG and labels it Soup in the real dialogs.
    const staff = await signedInPage(browser, w.staffA1, view(info))
    await openPortfolio(staff)
    const photo = await syntheticJpeg(`mgr-journey-${w.tag}.jpg`)
    await uploadThroughDialog(staff, [photo], { close: false })
    const upload = staff.getByRole("dialog", {
      name: "Upload photos or videos",
    })
    await upload.getByRole("button", { name: "Label this file" }).click()
    const editor = staff.getByRole("dialog", { name: "Labels", exact: true })
    await editor
      .getByRole("combobox", { name: new RegExp(`^Menu item at `) })
      .fill("soup")
    await editor.getByRole("option", { name: /^Soup\b/ }).click()
    await editor.getByRole("button", { name: /^Save labels/ }).click()
    await expect(editor).toBeHidden()
    if (await upload.isVisible())
      await upload.getByRole("button", { name: "Done" }).click()
    const first = psql(
      `select id from public.media_assets where uploader_id = '${w.staffA1.id}'::uuid and original_filename = '${photo.name}'`
    )
    expect(first).toMatch(/^[0-9a-f-]{36}$/)
    await staff.goto("/staff/menu")
    await expect(staffProgress(staff, 0)).toBeVisible()

    // Staff 2's photo of Soup (fixture, labelled by its uploader).
    const second = await labelledPhoto(w.staffA2, w.venueA, [w.itemsA.soup], {
      colour: "#4b7bc9",
    })

    // The manager signs in and sees the totals before any decision.
    const mgr = await signedInPage(browser, w.mgrA, view(info))
    await expect(mgr).toHaveURL(OVERVIEW)
    const before = `Menu photos · 0 of ${MENU_SIZE} items covered`
    await expect(main(mgr).getByRole("heading", { name: before })).toBeVisible()
    await expect(
      main(mgr).getByText("2 photos waiting for a decision")
    ).toBeVisible()
    await evidence(mgr, "overview-before")

    await navLink(mgr, /^Review/).click()
    await expect(mgr).toHaveURL(/\/manager\/review$/)
    const one = card(mgr, "Labelled: Soup", w.staffA1)
    await expect(one).toBeVisible()

    // The large preview loads through the private preview route.
    const preview = mgr.waitForResponse(
      (r) =>
        r.url().includes(`/api/menu-photos/${first}/preview`) &&
        r.request().method() === "GET"
    )
    await one
      .getByRole("button", { name: `Open the photo by ${w.staffA1.name}` })
      .click()
    expect([200, 302]).toContain((await preview).status())
    const dialog = mgr.getByRole("dialog")
    await expect
      .poll(() =>
        dialog
          .locator("img")
          .first()
          .evaluate(
            (img: HTMLImageElement) => img.complete && img.naturalWidth > 0
          )
      )
      .toBe(true)
    await mgr.keyboard.press("Escape")
    await expect(dialog).toBeHidden()

    await one.getByRole("button", { name: "Accept for this item" }).click()
    await expect(
      mgr.getByText("Accepted for Soup. Soup now has a photo.")
    ).toBeVisible()
    expect(photoRow(first)).toBe(`${w.itemsA.soup}:accepted:staff_label`)

    // The second photo: accept it and make it the menu photo.
    const two = card(mgr, "Labelled: Soup", w.staffA2)
    await two
      .getByRole("button", { name: "Accept and set as menu photo" })
      .click()
    await expect(
      mgr.getByText("Accepted for Soup. Set as the menu photo for Soup.")
    ).toBeVisible()
    expect(preferredAsset(w.itemsA.soup)).toBe(second)

    // Item detail: the new menu photo, the first one as an alternative; swap.
    await mgr.goto(`/manager/menu/${w.itemsA.soup}`)
    const menuPhoto = main(mgr).getByRole("region", { name: "Menu photo" })
    await expect(
      menuPhoto.getByRole("article", { name: `Photo by ${w.staffA2.name}` })
    ).toBeVisible()
    const alternatives = main(mgr).getByRole("region", {
      name: "Accepted alternatives",
    })
    const alt = alternatives.getByRole("article", {
      name: `Photo by ${w.staffA1.name}`,
    })
    await alt.getByRole("button", { name: "Set as menu photo" }).click()
    await expect(
      mgr.getByText("Set as the menu photo for Soup.").first()
    ).toBeVisible()
    await expect.poll(() => preferredAsset(w.itemsA.soup)).toBe(first)
    await mgr.reload()
    await expect(
      main(mgr)
        .getByRole("region", { name: "Menu photo" })
        .getByRole("article", { name: `Photo by ${w.staffA1.name}` })
    ).toBeVisible()

    // Totals after the decisions; Menu shows Soup with a photo.
    await mgr.goto("/manager")
    const after = `Menu photos · 1 of ${MENU_SIZE} items covered`
    await expect(main(mgr).getByRole("heading", { name: after })).toBeVisible()
    await expect(
      main(mgr).getByText("0 photos waiting for a decision")
    ).toBeVisible()
    await expect(
      main(mgr).getByText("Nothing waiting for review")
    ).toBeVisible()
    await evidence(mgr, "overview-after")
    await mgr.goto("/manager/menu")
    const soupRow = main(mgr)
      .getByRole("article")
      .filter({
        has: mgr.getByRole("link", { name: "Soup", exact: true }),
      })
    await expect(soupRow).toContainText("Has a photo")

    // Staff Our menu: 1 of 4, Soup has an accepted photo with its thumbnail.
    await staff.goto("/staff/menu")
    await expect(staffProgress(staff, 1)).toBeVisible()
    const soup = main(staff).getByRole("article", { name: "Soup" })
    await expect(soup.getByText("Has an accepted photo")).toBeVisible()
    await expect(soup.locator("img").first()).toHaveAttribute(
      "src",
      new RegExp(`/api/menu-photos/${escape(first)}/thumb`)
    )
    await evidence(staff, "staff-our-menu-after")
    note("totals", `before: ${before}; after: ${after}`)
    note("staff", `Our menu before 0 of ${MENU_SIZE}, after 1 of ${MENU_SIZE}`)
  })

  test("relink with a reason, ask for another photo, withdraw", async ({
    browser,
  }, info) => {
    const w = await provisionManagerWorld()
    const wrong = await labelledPhoto(w.staffA1, w.venueA, [w.itemsA.salad])
    const blurred = await labelledPhoto(w.staffA2, w.venueA, [w.itemsA.pie], {
      colour: "#7a4bc9",
    })
    const mgr = await signedInPage(browser, w.mgrA, view(info))
    await mgr.goto("/manager/review")

    // Relink: the staff label is wrong; a reason is required.
    await card(mgr, "Labelled: Salad", w.staffA1)
      .getByRole("button", { name: "Choose a different menu item" })
      .click()
    const picker = mgr.getByRole("dialog", {
      name: "Choose a different menu item",
    })
    await picker.getByRole("searchbox", { name: "Search the menu" }).fill("lag")
    await picker.getByRole("radio", { name: /^Lager/ }).check()
    await picker.getByRole("button", { name: "Accept for Lager" }).click()
    await expect(picker).toBeVisible()
    await expect(
      picker.getByText("Say why the staff label is wrong.")
    ).toBeVisible()
    expect(photoRow(wrong)).toBe("")
    await picker
      .getByRole("textbox", { name: /Why is the staff label wrong\?/ })
      .fill(`It's a pint of lager, not a salad (${w.tag})`)
    await picker.getByRole("button", { name: "Accept for Lager" }).click()
    await expect(picker).toBeHidden()
    await expect(mgr.getByText("Moved to Lager and accepted.")).toBeVisible()
    expect(photoRow(wrong)).toBe(
      `${w.itemsA.lager}:accepted:reviewer:${w.itemsA.salad}`
    )
    await statusFilter(mgr, "Accepted")
    const moved = card(mgr, "Labelled: Salad", w.staffA1)
    await expect(moved.getByRole("heading", { name: "Lager" })).toBeVisible()
    await expect(moved).toContainText("Moved from Salad")
    await expect(moved).toContainText("Matched by a reviewer")

    // Ask for another photo: a reason is required, then staff see it.
    await statusFilter(mgr, "Waiting")
    await card(mgr, "Labelled: Pie", w.staffA2)
      .getByRole("button", { name: "Ask for another photo" })
      .click()
    const ask = mgr.getByRole("dialog", {
      name: "Ask for another photo of Pie",
    })
    await ask.getByRole("button", { name: "Ask for another photo" }).click()
    await expect(ask).toBeVisible()
    expect(photoRow(blurred)).toBe("")
    const askReason = `Show the whole pie, in focus (${w.tag})`
    await ask
      .getByRole("textbox", { name: "What should the next photo show?" })
      .fill(askReason)
    await ask.getByRole("button", { name: "Ask for another photo" }).click()
    await expect(ask).toBeHidden()
    await expect(
      mgr.getByText(
        `Asked ${w.staffA2.name.split(" ")[0]} for another photo of Pie.`
      )
    ).toBeVisible()
    expect(photoRow(blurred)).toBe(
      `${w.itemsA.pie}:better_photo_requested:staff_label`
    )
    const staff2 = await signedInPage(browser, w.staffA2, view(info))
    await staff2.goto("/staff")
    await expect(
      main(staff2).getByText("Better photo requested").first()
    ).toBeVisible()

    // Withdraw the relinked acceptance with a reason: Lager needs a photo again.
    await statusFilter(mgr, "Accepted")
    await cardAction(
      mgr,
      card(mgr, "Labelled: Salad", w.staffA1),
      "Withdraw acceptance"
    )
    const withdraw = mgr.getByRole("dialog", {
      name: "Withdraw acceptance for Lager",
    })
    await withdraw
      .getByRole("textbox", { name: "Why is this photo no longer right?" })
      .fill(`Wrong glass for our lager (${w.tag})`)
    await withdraw.getByRole("button", { name: "Withdraw acceptance" }).click()
    await expect(withdraw).toBeHidden()
    await expect(
      mgr.getByText("Withdrawn. Lager needs a photo again.")
    ).toBeVisible()
    expect(photoRow(wrong)).toBe(
      `${w.itemsA.lager}:withdrawn:reviewer:${w.itemsA.salad}`
    )
    await evidence(mgr, "review-after-withdraw")
  })

  test("Unlabelled photos: only food or drink photos with no item; a manager assigns one", async ({
    browser,
  }, info) => {
    const w = await provisionManagerWorld()
    const dish = await labelledPhoto(w.staffA1, w.venueA, [], {
      contentTypes: ["dish"],
    })
    const team = await labelledPhoto(w.staffA1, w.venueA, [], {
      contentTypes: ["team"],
      colour: "#3d9c5a",
    })
    const mgr = await signedInPage(browser, w.mgrA, view(info))
    await mgr.goto("/manager/review")
    await statusFilter(mgr, "Unlabelled photos")
    await expect(mgr).toHaveURL(/status=unlabelled/)
    const list = mgr.getByRole("list", { name: "Photos to review" })
    await expect(list.getByRole("article")).toHaveCount(1)
    const unlabelled = card(mgr, "No label", w.staffA1)
    await expect(unlabelled.locator("img").first()).toHaveAttribute(
      "src",
      new RegExp(`/api/menu-photos/${escape(dish)}/thumb`)
    )
    await unlabelled.getByRole("button", { name: "Choose a menu item" }).click()
    const picker = mgr.getByRole("dialog", { name: "Choose a menu item" })
    await picker.getByRole("searchbox", { name: "Search the menu" }).fill("pie")
    await picker.getByRole("radio", { name: /^Pie/ }).check()
    await picker.getByRole("button", { name: "Accept for Pie" }).click()
    await expect(picker).toBeHidden()
    await expect(mgr.getByText("Moved to Pie and accepted.")).toBeVisible()
    expect(photoRow(dish)).toBe(`${w.itemsA.pie}:accepted:reviewer`)
    expect(photoRow(team)).toBe("")
    await mgr.reload()
    await expect(
      mgr.getByText(`No unlabelled photos at ${w.venueA.name}`)
    ).toBeVisible()
  })

  test("venue A's manager cannot open venue B; a revoked manager sees Venue access unavailable", async ({
    browser,
  }, info) => {
    const w = await provisionManagerWorld()
    const photoA = await labelledPhoto(w.staffA1, w.venueA, [w.itemsA.soup])

    // mgrB (venue B) and venue A's ids: not found, no bytes, no cards.
    const mgrB = await signedInPage(browser, w.mgrB, view(info))
    await mgrB.goto(`/manager/menu/${w.itemsA.soup}`)
    await expect(
      main(mgrB).getByText("This item isn't on your current menu", {
        exact: true,
      })
    ).toBeVisible()
    await mgrB.goto(`/manager/review/contributors/${w.staffA1.id}`)
    await expect(
      main(mgrB).getByText("This page isn't available in your workspace", {
        exact: true,
      })
    ).toBeVisible()
    const denied = await mgrB.request.get(`/api/menu-photos/${photoA}/thumb`, {
      maxRedirects: 0,
    })
    expect(denied.status()).toBe(404)
    await mgrB.goto("/manager/review?status=all")
    await expect(main(mgrB)).not.toContainText(w.staffA1.name)
    // And the reverse: mgrA cannot open venue B's items.
    const mgrA = await signedInPage(browser, w.mgrA, view(info))
    await mgrA.goto(`/manager/menu/${w.itemsB.soup}`)
    await expect(
      main(mgrA).getByText("This item isn't on your current menu", {
        exact: true,
      })
    ).toBeVisible()

    // Before the revoke: mgrA's workspace is private and the photo loads.
    const page = await mgrA.goto("/manager/review")
    expect(page!.headers()["cache-control"] ?? "").toMatch(/no-store/)
    const allowed = await mgrA.request.get(`/api/menu-photos/${photoA}/thumb`, {
      maxRedirects: 0,
    })
    expect(allowed.status()).toBe(302)
    expect(allowed.headers()["cache-control"] ?? "").toMatch(/private/)

    // The admin revokes mgrA's grant: the next page load is unavailable.
    const grant = psql(
      `select id from public.venue_manager_grants where staff_id = '${w.mgrA.id}'::uuid and revoked_at is null`
    )
    const revoked = await w.adminDb.rpc("revoke_venue_manager", {
      p_grant_id: grant,
      p_reason: "DEV FIXTURE: manager access check",
    })
    expect(revoked.error).toBeNull()
    for (const path of ["/manager", "/manager/review", "/manager/menu"]) {
      await mgrA.goto(path)
      await expect(
        mgrA.getByRole("heading", {
          level: 1,
          name: "Venue access unavailable",
        })
      ).toBeVisible()
      await expect(mgrA.getByText("Your venue access has ended.")).toBeVisible()
      await expect(
        mgrA.getByRole("navigation", { name: "Venue workspace" })
      ).toHaveCount(0)
    }
    await expect(mgrA.getByRole("button", { name: "Sign out" })).toBeVisible()
    await evidence(mgrA, "venue-access-unavailable")
    const after = await mgrA.request.get(`/api/menu-photos/${photoA}/thumb`, {
      maxRedirects: 0,
    })
    expect(after.status()).toBe(404)
    // Still a manager account: staff pages stay closed to it.
    await mgrA.goto("/staff/tasks")
    await expect(mgrA).not.toHaveURL(STAFF_LANDING)
  })
})
