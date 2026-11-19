import { randomUUID } from "node:crypto"

import {
  devices,
  expect,
  test,
  type Browser,
  type Page,
  type Route,
} from "@playwright/test"

import { signIn, type Db } from "../support/identities"
import {
  assignBeforeCutOver,
  legacyStaffGrant,
  provisionCoverageWorld,
  type CoverageWorld,
} from "./helpers/coverage-world"
import { syntheticJpeg, type SourceFile } from "./helpers/media"
import { activateMenu, createMenuDraft } from "./helpers/menus"
import { provisioner, psql } from "./helpers/stack"
import {
  escape,
  myPhotoLink,
  myPhotos,
  openMyPhotos,
  openOtherJobs,
  OTHER_JOBS_PATH,
  savingTitle,
  STAFF_LANDING,
  STAFF_TABS,
} from "./helpers/ui"
import { signedInPage } from "./helpers/world"

/**
 * Staff coverage journey (owner handoff §6 AC-13, AC-14, AC-16, AC-18; R-S1..R-S4) in
 * the real staff pages: Today, My photos, Other jobs and Me's Your month row
 * (DESIGN.md §5b, §5c, §5e). Until the manager pages land, the manager's part (grant,
 * task, target, review) is done through the manager's own signed-in database
 * session, the same calls the manager pages make; everything staff do goes
 * through the UI.
 */

type RpcResult<T> = {
  data: T | null
  error: { code: string; message: string; details?: string | null } | null
}

async function ok<T>(call: PromiseLike<RpcResult<T>>): Promise<T> {
  const { data, error } = await call
  if (error) {
    throw new Error(`${error.message} (${error.code}) ${error.details ?? ""}`)
  }
  return data as T
}

const key = () => `ws5-${randomUUID()}`
const none = null as never

function londonMonth(at = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(at)
  const get = (t: string) => parts.find((p) => p.type === t)!.value
  return {
    period: `${get("year")}-${get("month")}-01`,
    label: new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/London",
      month: "long",
      year: "numeric",
    }).format(at),
  }
}

type Setup = { manager: Db; requirementId: string; title: string }

/** Manager grant, one task for staff A (target 2) and A's monthly target 2. */
async function managerSetup(w: CoverageWorld): Promise<Setup> {
  const service = provisioner()
  const manager = await signIn(service, w.manager.email)
  await legacyStaffGrant(w.admin, w.manager, w.venue1)
  const title = `WS5 Back bar shelf ${w.tag}`
  const [row] = await ok(
    manager.rpc("save_coverage_requirement", {
      p_venue_id: w.venue1.id,
      p_requirement_id: none,
      p_expected_revision: none,
      p_kind: "venue_specific",
      p_title: title,
      p_guidance: "Bottles facing out, labels readable.",
      p_photo_target: 2,
      p_due_on: none,
      p_client_request_key: key(),
    })
  )
  const requirementId = row!.requirement_id
  await ok(
    manager.rpc("set_coverage_requirement_assignees", {
      p_requirement_id: requirementId,
      p_staff_ids: [w.staffA.id],
    })
  )
  await ok(
    manager.rpc("set_monthly_target", {
      p_staff_id: w.staffA.id,
      p_venue_id: w.venue1.id,
      p_period_month: londonMonth().period,
      p_target_count: 2,
    })
  )
  return { manager, requirementId, title }
}

/** Your month, opened the way staff do: the Your month row on Me (§5b). */
async function openYourMonth(page: Page) {
  await page.goto(STAFF_TABS.me)
  await page.locator('[data-slot="me-month"]').click()
  await expect(page).toHaveURL(/\/staff\/tasks\/month$/)
}

/** The newest asset this person uploaded under a file name. */
const assetNamed = (uploaderId: string, fileName: string) =>
  psql(
    `select id from public.media_assets where uploader_id = '${uploaderId}'::uuid and original_filename = '${fileName}' order by created_at desc limit 1`
  )

const revisionOf = (table: string, id: string) =>
  Number(psql(`select revision from public.${table} where id = '${id}'::uuid`))

/**
 * A confirmed menu plan from the fixture menu (two food sections): Starters
 * (target 2, assigned to staff A) and Mains (target 1). Returns Starters.
 */
async function menuSectionSetup(w: CoverageWorld, manager: Db) {
  const admin = await signIn(provisioner(), w.admin.email)
  const versionId = await createMenuDraft(
    admin,
    w.venue1.id,
    `WS5 menu ${w.tag}`
  )
  await activateMenu(admin, versionId)
  const [plan] = await ok(
    manager.rpc("start_menu_coverage_plan", {
      p_venue_id: w.venue1.id,
      p_menu_version_id: versionId,
    })
  )
  const planId = (plan as { plan_id: string }).plan_id
  const section = (title: string) =>
    psql(
      `select id from public.coverage_requirements where menu_plan_id = '${planId}'::uuid and title = '${title}'`
    )
  const starters = section("Starters")
  const mains = section("Mains")
  for (const [id, title, target, guidance] of [
    [starters, "Starters", 2, "Any starter, plated as it goes to the table."],
    [mains, "Mains", 1, null],
  ] as const) {
    await ok(
      manager.rpc("save_coverage_requirement", {
        p_venue_id: none,
        p_requirement_id: id,
        p_expected_revision: revisionOf("coverage_requirements", id),
        p_kind: none,
        p_title: title,
        p_guidance: guidance ?? none,
        p_photo_target: target,
        p_due_on: none,
        p_client_request_key: none,
      })
    )
    await ok(
      manager.rpc("set_coverage_requirement_status", {
        p_requirement_id: id,
        p_expected_revision: revisionOf("coverage_requirements", id),
        p_status: "active",
      })
    )
  }
  // G-8: sections take no assignee now; Starters' assignment is history from
  // before the cut-over (the send and replacement paths still honour it).
  assignBeforeCutOver(starters, w.venue1.id, [w.staffA.id], w.manager.id)
  await ok(
    manager.rpc("confirm_menu_coverage_plan", {
      p_plan_id: planId,
      p_expected_revision: revisionOf("menu_coverage_plans", planId),
    })
  )
  return starters
}

/**
 * The task flow: "Choose from your photos" opens the photo picker straight
 * away; the picked photos start saving at once in the staff Add queue
 * ("Saving N photos"), and each one comes back selected as soon as it is
 * ready. Sending them stays a separate step.
 */
async function uploadForTask(page: Page, files: SourceFile[]) {
  const [chooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    page.getByRole("button", { name: "Choose from your photos" }).click(),
  ])
  expect(chooser.isMultiple()).toBe(true)
  await chooser.setFiles(files.map((f) => f.path))
  const dialog = page.getByRole("dialog", { name: savingTitle(files) })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole("status")).toHaveText(`${files.length} saved`, {
    timeout: 90_000,
  })
  await dialog.getByRole("button", { name: "Done" }).click()
  await expect(dialog).toBeHidden()
}

async function sendSelected(page: Page, count: number) {
  const send = page.getByRole("button", {
    name: `Send ${count} ${count === 1 ? "photo" : "photos"}`,
  })
  await expect(send).toBeEnabled({ timeout: 30_000 })
  await send.click()
  await expect(
    page.getByRole("status").filter({
      hasText: `Sent ${count} ${count === 1 ? "photo" : "photos"} for review.`,
    })
  ).toBeVisible()
}

async function sendReplacement(page: Page) {
  const send = page.getByRole("button", { name: "Send another photo" })
  await expect(send).toBeEnabled({ timeout: 30_000 })
  await send.click()
  await expect(
    page.getByRole("status").filter({
      hasText: "Your new photo is waiting for review",
    })
  ).toBeVisible()
}

function items(requirementId: string) {
  return psql(`
    select coalesce(string_agg(i.id || '|' || i.state || '|' || i.revision || '|' || coalesce(i.replaces_item_id::text, '-') || '|' || a.original_filename, ',' order by i.submitted_at, a.original_filename), '')
    from public.coverage_submission_items i join public.media_assets a on a.id = i.asset_id
    where i.requirement_id = '${requirementId}'::uuid`)
    .split(",")
    .filter(Boolean)
    .map((row) => {
      const [id, state, revision, replaces, name] = row.split("|")
      return { id: id!, state, revision: Number(revision), replaces, name }
    })
}

async function review(
  manager: Db,
  item: { id: string; revision: number },
  decision: "accepted" | "needs_another_photo",
  reason?: string
) {
  await ok(
    manager.rpc("review_coverage_item", {
      p_item_id: item.id,
      p_expected_revision: item.revision,
      p_decision: decision,
      p_reason: reason,
      p_client_request_key: key(),
    })
  )
}

/**
 * AC-16: a signed link that no longer works by the time the browser fetches
 * it. The evidence route's real redirect is passed on with its storage token
 * spoiled, so storage refuses it the way it refuses an expired token (route
 * interception only sees the first URL of a redirect chain). The photo
 * re-signs once through the evidence route and loads without "Try again";
 * after two failures the person gets "Try again", which loads it.
 */
async function expiredLinkRecovery(page: Page) {
  const evidence = "**/api/coverage/evidence/**"
  const expired = (failures: number) => {
    const seen = new Map<string, number>()
    return async (route: Route) => {
      const path = new URL(route.request().url()).pathname
      const count = seen.get(path) ?? 0
      seen.set(path, count + 1)
      const response = await route.fetch({ maxRedirects: 0 })
      const location = response.headers()["location"]
      if (count >= failures || response.status() !== 302 || !location) {
        return route.fulfill({ response })
      }
      const spoiled = new URL(location)
      spoiled.searchParams.set("token", `${spoiled.searchParams.get("token")}x`)
      return route.fulfill({
        response,
        headers: { ...response.headers(), location: spoiled.toString() },
      })
    }
  }
  const mine = page.getByRole("region", { name: "Your photos for this task" })
  const loaded = async () => {
    const images = mine.locator("img")
    await expect(images).toHaveCount(2)
    for (const image of await images.all()) {
      await image.scrollIntoViewIfNeeded()
      await expect
        .poll(() =>
          image.evaluate(
            (img: HTMLImageElement) => img.complete && img.naturalWidth > 0
          )
        )
        .toBe(true)
    }
  }

  await page.route(evidence, expired(1))
  await page.reload()
  await loaded()
  await expect(mine.getByRole("button", { name: /Try again/ })).toHaveCount(0)
  await page.unroute(evidence)

  await page.route(evidence, expired(2))
  await page.reload()
  // The images load lazily: bring them into view so they are fetched.
  const images = mine.locator("img")
  await expect(images).toHaveCount(2)
  for (const image of await images.all()) {
    await image.scrollIntoViewIfNeeded().catch(() => undefined)
  }
  const retry = mine.getByRole("button", { name: /Try again/ })
  await expect(retry).toHaveCount(2)
  await retry.first().click()
  await expect(retry).toHaveCount(1)
  await retry.first().click()
  await expect(retry).toHaveCount(0)
  await loaded()
  await page.unroute(evidence)
}

async function staffJourney(
  page: Page,
  w: CoverageWorld,
  setup: Setup,
  browser: Browser
) {
  // Staff land on Today (DESIGN.md §5c); the month's target is Your month,
  // a row on Me (§5b); the venue-specific job is one Other jobs row away
  // from Today (revb B2), in the list page.
  const monthProgress = (accepted: number) =>
    page.getByRole("main").getByRole("progressbar", {
      name: `${accepted} of 2 photos accepted`,
      exact: true,
    })
  const assigned = page.getByRole("list", { name: "Assigned tasks" })
  const taskCard = assigned.getByRole("listitem").filter({
    has: page.getByRole("link", { name: setup.title, exact: true }),
  })

  // Landing: Today, with the Other jobs row; the month's target on Your month.
  await expect(page).toHaveURL(STAFF_LANDING)
  await openYourMonth(page)
  await expect(monthProgress(0)).toBeVisible()
  await openOtherJobs(page)
  await expect(assigned.getByRole("link", { name: setup.title })).toBeVisible()
  await expect(
    taskCard.getByRole("img", { name: "0 of 2 photos accepted", exact: true })
  ).toBeVisible()

  // Open the task, take/upload two photos, send them.
  await assigned.getByRole("link", { name: setup.title }).click()
  await expect(page).toHaveURL(
    new RegExp(`/staff/tasks/${setup.requirementId}$`)
  )
  const [first, second, third] = await Promise.all(
    ["one", "two", "three"].map((n) => syntheticJpeg(`task-${n}-${w.tag}.jpg`))
  )
  await uploadForTask(page, [first!, second!])
  await sendSelected(page, 2)
  // FA-20: colleagues see a photo only once it is accepted, so the sent
  // notice must not say the photos are already shared or that review only
  // decides whether they count (S3-E2E-1 E9, fixed by S3-R3).
  await expect(page.getByText(/^Sent|sent/).first()).toBeVisible()
  await expect(
    page.getByText(/already in your portfolio and Explore/)
  ).toHaveCount(0)
  await expect(
    page.getByText(/Review only decides whether they count/)
  ).toHaveCount(0)

  await expiredLinkRecovery(page)

  // On My photos at once; a colleague sees nothing before review (FA-20,
  // spec §3.3 row 3; this reverses Goals v0.5's AC-13).
  let sent = items(setup.requirementId)
  expect(sent.map((i) => [i.name, i.state])).toEqual([
    [first!.name, "submitted"],
    [second!.name, "submitted"],
  ])
  await openMyPhotos(page)
  for (const file of [first!, second!]) {
    await expect(
      myPhotoLink(myPhotos(page), assetNamed(w.staffA.id, file.name))
    ).toBeVisible()
  }
  const colleague = await signedInPage(browser, w.staffB)
  const byA = colleague.getByRole("button", {
    name: new RegExp(`^Photo by ${escape(w.staffA.name)}, `),
  })
  await colleague.goto("/staff/community")
  await expect(colleague.locator("main")).toBeVisible()
  await expect(byA).toHaveCount(0)

  // Manager: accept one, ask for another photo with a reason.
  const reason = `WS5: the shelf is out of focus (${w.tag})`
  await review(setup.manager, sent[0]!, "accepted")
  await review(setup.manager, sent[1]!, "needs_another_photo", reason)

  // The accepted photo now shows to the colleague, by author, never by its
  // file name (R-02); the one sent back does not.
  await colleague.reload()
  await expect(byA).toHaveCount(1)
  const explore = await colleague.content()
  for (const file of [first!, second!]) {
    expect(explore).not.toContain(file.name)
  }
  await colleague.context().close()

  await openYourMonth(page)
  await expect(monthProgress(1)).toBeVisible()
  // The job's card on Other jobs says it needs another photo; its page asks
  // for the replacement with the reviewer's reason.
  await openOtherJobs(page)
  await expect(taskCard).toContainText("Needs another photo")
  await taskCard.getByRole("link", { name: setup.title }).click()
  await expect(page).toHaveURL(
    new RegExp(`/staff/tasks/${setup.requirementId}(\\?|$)`)
  )
  await expect(
    page.getByRole("heading", { level: 1, name: "Send another photo" })
  ).toBeVisible()
  await expect(
    page
      .getByRole("region", { name: "What your reviewer asked for" })
      .getByText(reason)
  ).toBeVisible()
  await expect(
    page.getByText("The photos you send now replace this one.")
  ).toBeVisible()
  await expect(page.getByText(reason).first()).toBeVisible()
  await uploadForTask(page, [third!])
  await sendReplacement(page)

  sent = items(setup.requirementId)
  const replacement = sent.find((i) => i.name === third!.name)!
  expect(replacement).toMatchObject({
    state: "submitted",
    replaces: sent[1]!.id,
  })
  await review(setup.manager, replacement, "accepted")

  // Done: target met, nothing left to replace, the job complete in its list.
  await openYourMonth(page)
  await expect(monthProgress(2)).toBeVisible()
  await expect(
    page.getByRole("main").getByText("Target met", { exact: true })
  ).toBeVisible()
  await page.goto(OTHER_JOBS_PATH)
  await expect(taskCard).toContainText("Complete")
  await expect(taskCard).not.toContainText("Needs another photo")
}

test.describe("coverage: staff tasks journey (WS5)", () => {
  test.setTimeout(240_000)

  test("desktop: land on Today, send, replace on request, reach the target", async ({
    browser,
  }) => {
    const w = await provisionCoverageWorld()
    const setup = await managerSetup(w)
    const page = await signedInPage(browser, w.staffA)
    await staffJourney(page, w, setup, browser)
  })

  // A Pixel 7 context in the chromium project (a describe-level device would
  // force its own worker); the colleague's Explore check stays on desktop.
  test("phone (Pixel 7): the same journey at phone width (AC-14)", async ({
    browser,
  }) => {
    const w = await provisionCoverageWorld()
    const setup = await managerSetup(w)
    const page = await signedInPage(browser, w.staffA, devices["Pixel 7"])
    await staffJourney(page, w, setup, browser)
  })

  test("needs setup: a joiner without a team or target never shows complete (AC-18, R-S2)", async ({
    browser,
  }) => {
    const w = await provisionCoverageWorld()
    const page = await signedInPage(browser, w.joiner)
    await expect(page).toHaveURL(STAFF_LANDING)
    // Your month (the Me row, DESIGN.md §5b) reads Needs setup, never
    // complete. (Me's Your month card, which named the missing team, is gone.)
    await openYourMonth(page)
    const monthly = page.getByRole("main")
    await expect(monthly).toContainText(
      /Your manager sets your target for .+\. Until then, photos you add still go to Photos/
    )
    await expect(monthly.getByText("Target met")).toHaveCount(0)
    await expect(monthly.getByText("Needs setup").first()).toBeVisible()
  })

  /** Album › Menu at a section's shelf, Needed only, scrolled to the section. */
  const SECTION_SHELF =
    /\/staff\/album\/menu\?kind=food&shelf=[^&#]+&show=needed#shelf-section-/

  test("photo guide: a menu-section task goes to the Album's Menu; the guide teaches the four angles (phone)", async ({
    browser,
    request,
  }) => {
    const w = await provisionCoverageWorld()
    const setup = await managerSetup(w)
    const startersId = await menuSectionSetup(w, setup.manager)
    const sectionId = psql(
      `select menu_section_id from public.coverage_requirements where id = '${startersId}'::uuid`
    )
    const page = await signedInPage(browser, w.staffA, devices["Pixel 7"])

    // G-4: menu work is on the Album's Menu (DESIGN.md §5d, D16). With no
    // open "needs another photo" request, the section's task link opens the
    // section's shelf at that section, showing the dishes still needed.
    expect(sectionId).toMatch(/^[0-9a-f-]{36}$/)
    await page.goto(`/staff/tasks/${startersId}`)
    await expect(page).toHaveURL(SECTION_SHELF)
    // The shelf is the page; the task's section is a heading inside it.
    await expect(
      page.getByRole("heading", { level: 2, name: "Starters" })
    ).toBeVisible()
    await page.goto(`/staff/tasks/${startersId}?replaces=${randomUUID()}`)
    await expect(page).toHaveURL(SECTION_SHELF)

    // The full guide: the examples open full screen, no angle marked.
    await page.goto("/staff/tasks/guide")
    const tile = page.getByRole("button", {
      name: "45° angle. Open example",
    })
    await tile.scrollIntoViewIfNeeded()
    await expect
      .poll(() =>
        tile
          .locator("img")
          .evaluate(
            (img: HTMLImageElement) => img.complete && img.naturalWidth > 0
          )
      )
      .toBe(true)
    await tile.click()
    // The dialog is named after the angle on screen, so its name changes
    // with Previous/Next; find it by role and check the name at each step.
    const viewer = page.getByRole("dialog")
    await expect(viewer).toBeVisible()
    await expect(viewer).toHaveAccessibleName("45° angle")
    await expect(viewer.getByText("1 of 4 · Mixed grill")).toBeVisible()
    await expect(
      viewer.getByRole("button", { name: "Previous" })
    ).toBeDisabled()
    await viewer.getByRole("button", { name: "Next" }).click()
    await expect(viewer).toHaveAccessibleName("Overhead")
    await expect(viewer.getByText("2 of 4 · Mixed grill")).toBeVisible()
    await viewer.getByRole("button", { name: "Previous" }).click()
    await expect(viewer).toHaveAccessibleName("45° angle")
    await expect(viewer.getByText("1 of 4 · Mixed grill")).toBeVisible()
    await page.keyboard.press("Escape")
    await expect(page.getByRole("dialog")).toHaveCount(0)
    await expect(tile).toBeFocused()

    await expect(page).toHaveURL(/\/staff\/tasks\/guide$/)
    await expect(
      page.getByRole("heading", { level: 1, name: "Photo guide" })
    ).toBeVisible()
    await expect(
      page.getByRole("heading", { name: "Every shot" })
    ).toBeVisible()
    await expect(page.getByText("No flash.")).toBeVisible()
    await expect(
      page.getByText("Only take photos when it's safe.", { exact: false })
    ).toBeVisible()
    await expect(page.getByText("Suggested", { exact: true })).toHaveCount(0)
    await page
      .getByRole("group", { name: "Example dish" })
      .getByRole("button", { name: "Momos" })
      .click()
    await expect(
      page
        .getByRole("group", { name: "Example dish" })
        .getByRole("button", { name: "Momos" })
    ).toHaveAttribute("aria-pressed", "true")

    // Monthly photos links to the guide.
    await page.goto("/staff/tasks/month")
    await expect(
      page.getByRole("link", { name: "How to photograph a dish" })
    ).toHaveAttribute("href", "/staff/tasks/guide")

    // A non-menu task has no guide.
    await page.goto(`/staff/tasks/${setup.requirementId}`)
    await expect(
      page.getByRole("heading", { level: 1, name: setup.title })
    ).toBeVisible()
    await expect(
      page.getByRole("region", { name: "How to photograph it" })
    ).toHaveCount(0)

    // Generic examples are public static files, cached as immutable.
    const image = await request.get("/guide/v1/mixed-grill-45.webp")
    expect(image.status()).toBe(200)
    expect(image.headers()["content-type"]).toBe("image/webp")
    expect(image.headers()["cache-control"]).toBe(
      "public, max-age=31536000, immutable"
    )
    await page.context().close()
  })
})
