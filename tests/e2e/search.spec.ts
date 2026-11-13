import AxeBuilder from "@axe-core/playwright"
import {
  devices,
  expect,
  test,
  type BrowserContextOptions,
  type Page,
  type TestInfo,
} from "@playwright/test"

import { signIn } from "../support/identities"
import {
  amenityOk,
  question,
  readyCheck,
  seedPhoto,
  sessionOf,
  submitArgs,
  type AmenitiesWorld,
} from "./helpers/amenities-world"
import { legacyStaffGrant, setUploaderRole } from "./helpers/coverage-world"
import {
  labelledPhoto,
  provisionManagerWorld,
  type ManagerWorld,
} from "./helpers/manager-world"
import { ok } from "./helpers/menus"
import { horizontalOverflow } from "./helpers/overflow"
import { provisioner, psql, requireIsolatedStack } from "./helpers/stack"
import {
  grantUse,
  testDestination,
  withdrawUse,
  type TestDestination,
} from "./helpers/use-grant"
import { seedReadyAssets, signedInPage } from "./helpers/world"

/**
 * B05-06 asset search screen (contracts/b05-search-screen-scope.md) in the
 * built app: an admin finds a photo by venue, menu item and use; a manager
 * account sees its own venue only (another venue in the URL is refused) and
 * another uploader's thumbnails; a legacy grant holder searches at
 * /staff/manage/search; plain staff get Manage isn't available and a 403 from
 * the API; Show more pages without duplicates; an empty filtered result
 * clears with focus on the results heading; axe and overflow at 1280 and 390.
 * The service role and psql only seed fixtures (photos, a test-only place of
 * use per SS-3, a legacy grant); decisions and grants use real sessions.
 *
 * Runs on `chromium` at 1280x800 and on `mobile-chromium` at 390x844.
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
const phone = (info: TestInfo) => info.project.name === "mobile-chromium"
const view = (info: TestInfo) => (phone(info) ? PHONE : DESKTOP)

test.afterEach(async ({ browser }) => {
  for (const context of browser.contexts())
    await context.close().catch(() => undefined)
})

/** A full-page screenshot kept in the test's output folder, pass or fail. */
async function evidence(page: Page, name: string) {
  const path = test.info().outputPath(`${name}.png`)
  await page.screenshot({ path, fullPage: true })
  await test.info().attach(name, { path, contentType: "image/png" })
}

const main = (page: Page) => page.getByRole("main")
const cards = (page: Page) => main(page).locator("[data-asset-card]")
/** The screen's one status line (not a skeleton's own status). */
const status = (page: Page) =>
  main(page).locator(
    'section[aria-labelledby="search-results-heading"] > p[role="status"]'
  )

/**
 * Picks `option` in the visible `combo` select as a person would: a tap on a
 * phone, a click on desktop, or (`keyboard`) Enter and the arrow keys. The
 * trigger then shows the choice (the screenshot shows what the URL says).
 */
async function choose(
  page: Page,
  combo: string,
  option: string,
  how: "pointer" | "keyboard" = "pointer"
) {
  const trigger = main(page).getByRole("combobox", { name: combo, exact: true })
  const touch = phone(test.info())
  if (how === "keyboard") {
    await trigger.focus()
    await page.keyboard.press("Enter")
    const listbox = page.getByRole("listbox")
    await expect(listbox).toBeVisible()
    const target = page.getByRole("option", { name: option, exact: true })
    for (let i = 0; i < 8; i++) {
      if ((await target.getAttribute("data-highlighted")) !== null) break
      await page.keyboard.press("ArrowDown")
    }
    await expect(target).toHaveAttribute("data-highlighted", "")
    await page.keyboard.press("Enter")
  } else {
    if (touch) await trigger.tap()
    else await trigger.click()
    const target = page.getByRole("option", { name: option, exact: true })
    if (touch) await target.tap()
    else await target.click()
  }
  await expect(page.getByRole("listbox")).toHaveCount(0)
  await expect(trigger).toContainText(option)
}

/** Every thumbnail on the page decoded real pixels. */
async function thumbnailsLoad(page: Page, count: number) {
  const imgs = main(page).locator("[data-asset-card] img")
  await expect(imgs).toHaveCount(count)
  for (let i = 0; i < count; i++)
    await expect
      .poll(() =>
        imgs.nth(i).evaluate((img: HTMLImageElement) => img.naturalWidth)
      )
      .toBeGreaterThan(0)
}

/**
 * No reuse, photo freshness, derivative, preview or download anywhere on
 * screen. Freshness may appear only as the answer's (B05 follow-up, §11.2):
 * the Answer freshness filter and its "Freshness for" use.
 * Visible text only: a closed Venue select keeps every venue's name in the
 * page, and other specs on a shared stack name venues "e2e-lib-refresh-…".
 */
async function readOnly(page: Page) {
  await expect(
    page.getByText(/another destination|reuse/i).filter({ visible: true })
  ).toHaveCount(0)
  await expect(
    page.getByText(/derivative/i).filter({ visible: true })
  ).toHaveCount(0)
  await expect(
    page
      .getByText(/fresh/i)
      .filter({ visible: true })
      .filter({ hasNotText: /^(Answer freshness|Freshness for)$/ })
  ).toHaveCount(0)
  await expect(
    main(page).getByRole("link", { name: /\b(download|preview|open|view)\b/i })
  ).toHaveCount(0)
  await expect(
    main(page).getByRole("button", {
      name: /\b(download|preview|view|reuse)\b/i,
    })
  ).toHaveCount(0)
  await expect(main(page).locator('a[href*="/download"]')).toHaveCount(0)
}

const firstName = (name: string) => name.split(" ")[0]!

type SearchWorld = ManagerWorld & {
  place: TestDestination
  soupInUse: string
  soupInUse2: string
  soupNone: string
  saladWithdrawn: string
  legacy: ManagerWorld["staffA2"]
}

let world: SearchWorld | null = null

async function searchWorld(): Promise<SearchWorld> {
  if (world) return world
  const w = await provisionManagerWorld()
  // Venue A: a soup photo in use (accepted for Soup by the manager), a second
  // soup photo in use (not reviewed), a soup photo with no use agreed by
  // another uploader, and a salad photo whose use was withdrawn. Two soup
  // photos in use make the Use filter necessary to find the third.
  const soupInUse = await labelledPhoto(w.staffA1, w.venueA, [w.itemsA.soup], {
    prefix: "DEV-FIXTURE-search-soup",
  })
  const soupNone = await labelledPhoto(w.staffA2, w.venueA, [w.itemsA.soup], {
    prefix: "DEV-FIXTURE-search-soup2",
    colour: "#2a6f4e",
  })
  const soupInUse2 = await labelledPhoto(w.staffA1, w.venueA, [w.itemsA.soup], {
    prefix: "DEV-FIXTURE-search-soup3",
    colour: "#4b5d8a",
  })
  const saladWithdrawn = await labelledPhoto(
    w.staffA1,
    w.venueA,
    [w.itemsA.salad],
    { prefix: "DEV-FIXTURE-search-salad", colour: "#7a3b2e" }
  )
  const manager = await signIn(provisioner(), w.mgrA.email)
  const revision = Number(
    psql(`select coalesce((select revision from public.menu_item_photo_heads
      where item_id = '${w.itemsA.soup}'), 1)`)
  )
  await ok(
    manager.rpc("review_menu_item_photo", {
      p_asset_id: soupInUse,
      p_item_id: w.itemsA.soup,
      p_variant_id: null as unknown as string,
      p_decision: "accepted",
      p_expected_revision: revision,
    })
  )
  const place = testDestination(w.tag, w.venueA.id)
  await grantUse(w.adminDb, soupInUse, place)
  await grantUse(w.adminDb, soupInUse2, place)
  await withdrawUse(w.adminDb, await grantUse(w.adminDb, saladWithdrawn, place))
  // Venue B: 30 ready videos (rows only) for paging, the manager's own
  // manager-era uploads.
  setUploaderRole(
    await seedReadyAssets(
      w.mgrB.id,
      w.venueB.id,
      30,
      "video",
      "DEV-FIXTURE-search-page"
    ),
    "manager"
  )
  // A staff account holding a legacy manager grant at venue A.
  await legacyStaffGrant(w.admin, w.staffA2, w.venueA)
  world = {
    ...w,
    place,
    soupInUse,
    soupInUse2,
    soupNone,
    saladWithdrawn,
    legacy: w.staffA2,
  }
  return world
}

test("(a) an admin finds the soup photo in use by venue, menu item and use", async ({
  browser,
}, info) => {
  const w = await searchWorld()
  const page = await signedInPage(browser, w.admin, view(info))
  await page.goto("/admin")
  await main(page)
    .getByRole("link", { name: "Search photos and videos" })
    .click()
  await expect(page).toHaveURL(/\/admin\/search$/)
  await expect(
    page.getByRole("heading", { level: 1, name: "Search photos and videos" })
  ).toBeVisible()

  await choose(page, "Venue", w.venueA.name)
  await expect(page).toHaveURL(new RegExp(`venue=${w.venueA.id}`))
  const item = main(page).getByRole("combobox", { name: "Menu item" })
  await expect(item).toBeEnabled()
  await item.click()
  await item.fill("Soup")
  await page.getByRole("option", { name: /^Soup/ }).click()
  await expect(page).toHaveURL(new RegExp(`item=${w.itemsA.soup}`))
  await expect(cards(page)).toHaveCount(3)
  await choose(page, "Use", "In use")
  await expect(page).toHaveURL(/rights=in_force/)
  await expect(cards(page)).toHaveCount(2)

  const card = cards(page).filter({ hasText: "Accepted" })
  await expect(card).toHaveCount(1)
  await expect(card).toContainText(/Uploaded \d{1,2} [A-Z][a-z]{2}/)
  await expect(card).toContainText(`By ${firstName(w.staffA1.name)}`)
  await expect(card).not.toContainText(w.staffA1.name)
  await expect(card).toContainText(w.venueA.name)
  await expect(card).toContainText("For Soup")
  await expect(card).toContainText(`In use on ${w.place.label}`)
  await expect(card).toContainText("Accepted")
  await expect(card).not.toContainText(w.soupInUse)
  await thumbnailsLoad(page, 2)
  await expect(status(page)).toHaveText("2 shown")
  await expect(
    main(page).getByRole("button", { name: "Showing: In use. Remove filter" })
  ).toBeVisible()

  // SS-3: with a registered place, "Where it's used" offers it for In use.
  await main(page)
    .getByRole("button", { name: /More filters/ })
    .click()
  await expect(
    main(page).getByRole("combobox", { name: "Where it's used" })
  ).toBeVisible()
  await readOnly(page)
  await evidence(page, `admin-soup-in-use-${phone(info) ? 390 : 1280}`)

  // R13: Use = "No use agreed" through the visible control narrows the soup
  // photos to the one nobody has agreed a use for.
  await choose(page, "Use", "No use agreed")
  await expect(page).toHaveURL(/rights=not_granted/)
  await expect(page).not.toHaveURL(/rights=in_force|destination=/)
  await expect(cards(page)).toHaveCount(1)
  await expect(cards(page).first()).toContainText("No use agreed")
  await expect(cards(page).first()).toContainText(
    `By ${firstName(w.staffA2.name)}`
  )
  await expect(cards(page).first()).not.toContainText("In use on")
  await expect(status(page)).toHaveText("1 shown")
  await expect(
    main(page).getByRole("button", {
      name: "Showing: No use agreed. Remove filter",
    })
  ).toBeVisible()
  await expect(
    main(page).getByRole("combobox", { name: "Where it's used" })
  ).toHaveCount(0)
  await thumbnailsLoad(page, 1)
  await evidence(page, `admin-soup-no-use-${phone(info) ? 390 : 1280}`)
})

test("(b) a manager sees its own venue only, with another uploader's thumbnails", async ({
  browser,
}, info) => {
  const w = await searchWorld()
  const page = await signedInPage(browser, w.mgrA, view(info))
  await page.goto("/manager")
  await main(page)
    .getByRole("link", { name: "Search photos and videos" })
    .click()
  await expect(page).toHaveURL(/\/manager\/search$/)
  await expect(main(page)).toContainText(
    `Find photos and videos from ${w.venueA.name}.`
  )
  await expect(cards(page)).toHaveCount(4)
  await expect(status(page)).toHaveText("4 shown")
  await expect(main(page)).not.toContainText(w.venueB.name)
  await expect(main(page).getByRole("combobox", { name: "Venue" })).toHaveCount(
    0
  )
  await thumbnailsLoad(page, 4)
  await expect(main(page)).toContainText(`By ${firstName(w.staffA2.name)}`)
  await expect(main(page)).toContainText("Use withdrawn")
  await expect(main(page)).toContainText("No use agreed")
  await readOnly(page)
  await evidence(page, `manager-own-venue-${phone(info) ? 390 : 1280}`)

  // The URL can't widen the venue: the database refuses another one.
  await page.goto(`/manager/search?venue=${w.venueB.id}`)
  await expect(main(page)).toContainText("You can search your own venue only.")
  await expect(cards(page)).toHaveCount(0)
  // The refusal is said once, through the one status region (R7).
  await expect(status(page)).toHaveText("You can search your own venue only.")
  await expect(main(page).locator('[data-slot="notice"][role]')).toHaveCount(0)
  await evidence(page, `manager-wrong-venue-${phone(info) ? 390 : 1280}`)
  await main(page).getByRole("button", { name: "Reload" }).click()
  await expect(page).toHaveURL(/\/manager\/search$/)
  await expect(cards(page)).toHaveCount(4)
  // Reload's button went with the refusal: focus is on the results (R6).
  await expect(
    page.getByRole("heading", { level: 2, name: "Results" })
  ).toBeFocused()
})

test("(c) a legacy grant holder searches the venue at /staff/manage/search", async ({
  browser,
}, info) => {
  const w = await searchWorld()
  const page = await signedInPage(browser, w.legacy, view(info))
  await page.goto("/staff/manage/search")
  await expect(
    page.getByRole("heading", { level: 1, name: "Search photos and videos" })
  ).toBeVisible()
  await expect(cards(page)).toHaveCount(4)
  await thumbnailsLoad(page, 4)
  // R13: by keyboard on desktop (Enter, arrows, Enter), by tap on a phone.
  await choose(
    page,
    "Use",
    "No use agreed",
    phone(info) ? "pointer" : "keyboard"
  )
  await expect(page).toHaveURL(/rights=not_granted/)
  await expect(cards(page)).toHaveCount(1)
  await expect(cards(page).first()).toContainText("For Soup")
  await expect(cards(page).first()).toContainText("No use agreed")
  await expect(status(page)).toHaveText("1 shown")
  await readOnly(page)
  await evidence(page, `legacy-manager-${phone(info) ? 390 : 1280}`)
})

test("(d) plain staff get Manage isn't available and a refused API", async ({
  browser,
}, info) => {
  const w = await searchWorld()
  const page = await signedInPage(browser, w.staffA1, view(info))
  await page.goto("/staff/manage/search")
  await expect(
    page.getByRole("heading", { level: 1, name: "Manage isn't available" })
  ).toBeVisible()
  await expect(cards(page)).toHaveCount(0)
  const res = await page.request.get("/api/media/search")
  expect(res.status()).toBe(403)
  expect(res.headers()["cache-control"]).toBe("private, no-store")
  const body = await res.json()
  expect(body).toMatchObject({ ok: false, code: "not_permitted" })
  expect(body.page).toBeUndefined()
})

test("(e) Show more pages to all 30 with no duplicates", async ({
  browser,
}, info) => {
  const w = await searchWorld()
  const page = await signedInPage(browser, w.mgrB, view(info))
  await page.goto("/manager/search?mediaType=video")
  await expect(cards(page)).toHaveCount(24)
  await expect(status(page)).toHaveText("Showing 24. More available.")
  await main(page).getByRole("button", { name: "Show more" }).click()
  await expect(cards(page)).toHaveCount(30)
  await expect(main(page).getByText("All 30 shown")).toBeVisible()
  await expect(status(page)).toHaveText("30 shown")
  // Focus moves to the first new card, never to the body.
  await expect(cards(page).nth(24)).toBeFocused()
  const thumbs = await cards(page).evaluateAll((els) =>
    els.map((el) => el.getAttribute("aria-label"))
  )
  expect(thumbs).toHaveLength(30)
  // Rows only (no bytes): each card says so in words.
  await expect(cards(page).first()).toContainText("No preview")
  await evidence(page, `paging-${phone(info) ? 390 : 1280}`)
})

test("(f) an empty filtered result clears, with focus on the results", async ({
  browser,
}, info) => {
  const w = await searchWorld()
  const page = await signedInPage(browser, w.admin, view(info))
  await page.goto(`/admin/search?venue=${w.venueA.id}&mediaType=video`)
  await expect(main(page)).toContainText("Nothing matches these filters.")
  await expect(main(page)).toContainText("Try all venues.")
  // The empty outcome is said in the one status region (R2).
  await expect(status(page)).toHaveText("Nothing matches these filters.")
  await evidence(page, `empty-filtered-${phone(info) ? 390 : 1280}`)
  await main(page)
    .getByRole("button", { name: "Clear filters", exact: true })
    .last()
    .click()
  await expect(page).toHaveURL(/\/admin\/search$/)
  await expect(
    page.getByRole("heading", { level: 2, name: "Results" })
  ).toBeFocused()
  await expect(cards(page).first()).toBeVisible()
})

/** Answers the next Show more (a request with a cursor) with `reply`. */
async function failNextPage(
  page: Page,
  status: number,
  body: Record<string, unknown>
) {
  await page.route(
    (url) =>
      url.pathname === "/api/media/search" && url.searchParams.has("cursor"),
    (route) =>
      route.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify(body),
      }),
    { times: 1 }
  )
}

test("(h) a failed, expired or signed-out Show more keeps focus and says why", async ({
  browser,
}, info) => {
  const w = await searchWorld()
  const width = phone(info) ? 390 : 1280
  const page = await signedInPage(browser, w.mgrB, view(info))
  const showMore = main(page).getByRole("button", { name: "Show more" })

  // A plain failure: Try again takes focus and the status says so.
  await page.goto("/manager/search?mediaType=video")
  await expect(cards(page)).toHaveCount(24)
  await failNextPage(page, 503, {
    ok: false,
    code: "unavailable",
    message: "Search is unavailable.",
  })
  await showMore.click()
  const tryAgain = main(page).getByRole("button", { name: "Try again" })
  await expect(tryAgain).toBeFocused()
  await expect(status(page)).toHaveText(
    "More photos and videos couldn't load. Try again."
  )
  await evidence(page, `more-failed-${width}`)
  await tryAgain.click()
  await expect(cards(page)).toHaveCount(30)
  await expect(cards(page).nth(24)).toBeFocused()
  await expect(status(page)).toHaveText("30 shown")

  // An expired page link: Search again takes focus, then page one returns.
  await page.goto("/manager/search?mediaType=video")
  await expect(cards(page)).toHaveCount(24)
  await failNextPage(page, 400, {
    ok: false,
    code: "invalid_input",
    message: "Check the search filters.",
    fieldErrors: { cursor: "This page link has expired." },
  })
  await showMore.click()
  const again = main(page).getByRole("button", { name: "Search again" })
  await expect(again).toBeFocused()
  await expect(status(page)).toHaveText(
    "This page link has expired. Search again."
  )
  await evidence(page, `more-expired-${width}`)
  await again.click()
  await expect(cards(page)).toHaveCount(24)
  await expect(cards(page).first()).toBeFocused()
  await expect(status(page)).toHaveText("Showing 24. More available.")

  // Signed out meanwhile: the Sign in link takes focus.
  await failNextPage(page, 401, {
    ok: false,
    code: "signed_out",
    message: "Sign in to continue.",
  })
  await showMore.click()
  await expect(main(page).getByRole("link", { name: "Sign in" })).toBeFocused()
  await expect(status(page)).toHaveText("Sign in to continue.")
  await evidence(page, `more-signed-out-${width}`)
})

test("(i) a refused filter focuses its control, or the error summary", async ({
  browser,
}, info) => {
  const w = await searchWorld()
  const width = phone(info) ? 390 : 1280
  const page = await signedInPage(browser, w.mgrA, view(info))

  // Dates out of order: More filters opens and Uploaded to takes focus.
  await page.goto(
    "/manager/search?uploadedFrom=2026-11-10&uploadedTo=2026-11-01"
  )
  await expect(main(page)).toContainText("Check the search filters.")
  await expect(status(page)).toHaveText("Check the search filters.")
  const to = main(page).getByRole("textbox", { name: "Uploaded to" })
  await expect(to).toBeVisible()
  await expect(to).toBeFocused()
  await expect(to).toHaveAttribute("aria-invalid", "true")
  await expect(main(page)).toContainText(
    "The start date must be before the end date."
  )
  await evidence(page, `field-error-dates-${width}`)

  // A media type that isn't one: the Photo or video group takes focus and
  // the pill shows the value given.
  await page.goto("/manager/search?mediaType=gif")
  await expect(main(page)).toContainText("Check the search filters.")
  await expect(page.locator("#search-mediaType")).toBeFocused()
  await expect(
    main(page).getByRole("button", { name: "Showing: gif. Remove filter" })
  ).toBeVisible()
  await evidence(page, `field-error-media-${width}`)
})

test("(g) the screen passes axe and fits 390px", async ({ browser }, info) => {
  const w = await searchWorld()
  const widths = phone(info) ? [390] : [1280, 390]
  for (const width of widths) {
    const options = width === 390 ? PHONE : { viewport: { width, height: 800 } }
    for (const [who, path] of [
      [w.admin, `/admin/search?venue=${w.venueA.id}`],
      [w.mgrA, "/manager/search"],
    ] as const) {
      const page = await signedInPage(browser, who, options)
      await page.goto(path)
      await expect(cards(page).first()).toBeVisible()
      await main(page)
        .getByRole("button", { name: /More filters/ })
        .click()
      const result = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
        .analyze()
      const serious = result.violations
        .filter((v) => v.impact === "serious" || v.impact === "critical")
        .map(
          (v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`
        )
      expect(serious, `${path} at ${width}`).toEqual([])
      if (width === 390) {
        const { overflowPx, culprit } = await horizontalOverflow(page)
        expect(overflowPx, culprit).toBeLessThanOrEqual(0)
      }
      await evidence(
        page,
        `axe-${who === w.admin ? "admin" : "manager"}-${width}`
      )
      await page.context().close()
    }
  }
})

// Last: it adds an amenity answer at venue A, which the counts above don't
// expect.
test("(j) answer freshness finds the photo behind an answer, labelled as the answer's", async ({
  browser,
}, info) => {
  const w = await searchWorld()
  const check = await readyCheck(
    { admin: w.admin } as unknown as AmenitiesWorld,
    w.venueA,
    "guest_toilets",
    w.staffA1
  )
  const evidencePhoto = await seedPhoto(w.staffA1, w.venueA, `search-${w.tag}`)
  await amenityOk(
    await sessionOf(w.staffA1),
    "amenity_submit_finding",
    submitArgs(check, "yes", [evidencePhoto])
  )
  expect(
    psql(`select count(*) from public.venue_amenity_checks c
      join public.amenity_submission_assets sa on sa.submission_id = c.current_submission_id
      where c.id = '${check}' and sa.asset_id = '${evidencePhoto}'`)
  ).toBe("1")

  for (const [who, path] of [
    [w.admin, `/admin/search?venue=${w.venueA.id}`],
    [w.mgrA, "/manager/search"],
  ] as const) {
    const page = await signedInPage(browser, who, view(info))
    await page.goto(path)
    await expect(cards(page).first()).toBeVisible()
    await main(page)
      .getByRole("button", { name: /More filters/ })
      .click()
    await choose(page, "Answer freshness", "Not rated yet")
    await expect(page).toHaveURL(/answerFreshness=unrated/)
    await expect(cards(page)).toHaveCount(1)
    const card = cards(page).first()
    await expect(card).toContainText(
      `Supports \u201c${question("guest_toilets")}\u201d: not rated yet (internal and public)`
    )
    await expect(
      main(page).getByRole("button", {
        name: "Showing: Answer not rated yet (internal use). Remove filter",
      })
    ).toBeVisible()
    // No freshness policy is set yet (OD-15): nothing is current.
    await choose(page, "Answer freshness", "Current")
    await expect(cards(page)).toHaveCount(0)
    await choose(page, "Freshness for", "Public use")
    await expect(page).toHaveURL(/answerUse=public/)
    await readOnly(page)
    await evidence(
      page,
      `answer-freshness-${who === w.admin ? "admin" : "manager"}-${phone(info) ? 390 : 1280}`
    )
    await page.context().close()
  }

  // An admin without a venue isn't offered it; a URL that asks is refused.
  const page = await signedInPage(browser, w.admin, view(info))
  await page.goto("/admin/search")
  await main(page)
    .getByRole("button", { name: /More filters/ })
    .click()
  await expect(
    main(page).getByRole("combobox", { name: "Answer freshness" })
  ).toHaveCount(0)
  await page.goto("/admin/search?answerFreshness=unrated")
  await expect(main(page)).toContainText("Choose a venue first.")
})
