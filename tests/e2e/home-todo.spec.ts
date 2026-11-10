import { randomUUID } from "node:crypto"

import { expect, test, type Locator, type Page } from "@playwright/test"

import { staffCaptureHref } from "../../lib/amenities/contract"
import { signIn, type Db } from "../support/identities"
import {
  amenityOk,
  captureForm,
  checkId,
  checkState,
  provisionAmenitiesWorld,
  question,
  readyCheck,
  seedPhoto,
  sessionOf,
  submitAndComplete,
} from "./helpers/amenities-world"
import {
  legacyStaffGrant,
  provisionCoverageWorld,
  seedImages,
} from "./helpers/coverage-world"
import { provisioner, psql } from "./helpers/stack"
import {
  escape,
  expectTodoCheck,
  STAFF_LANDING,
  startTodoCheck,
  todoRegion,
} from "./helpers/ui"
import { signedInPage } from "./helpers/world"

/**
 * Home tells the truth about what is left to do (flows register batch A):
 * an amenity check counts in To do and in the Home badge, a sent finding is
 * confirmed on Home, an old request for another photo is never lost behind
 * newer photos, and the badges and avatar are the same on every staff page.
 * Chromium at 390 px (phone, touch) and 1280 px. Emulation, not a device.
 */

const PHONE = {
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
}
const DESKTOP = { viewport: { width: 1280, height: 800 } }

/** Staff pages whose phone TabBar shows the Home badge (Home itself does not). */
const BADGE_PAGES = [
  "/staff/community",
  "/staff/people",
  "/staff/menu",
  "/staff",
]

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

const key = () => `home-todo-${randomUUID()}`
const none = null as never

/** The phone TabBar's Home link; its name carries the badge. */
const homeTab = (page: Page) =>
  page
    .getByRole("navigation", { name: "Staff" })
    .getByRole("link", { name: /^Home\b/ })

/** The AppBar's Manage link (md up); its name carries the review badge. */
const manageLink = (page: Page) =>
  page
    .getByRole("navigation", { name: "Staff" })
    .getByRole("link", { name: /^Manage\b/ })

/** "Home , 103 things to do": browsers may put a space either side of the comma. */
const homeName = (count: string) =>
  new RegExp(`^Home ?, ?${count} ${count === "1" ? "thing" : "things"} to do$`)
const manageName = (count: string) =>
  new RegExp(`^Manage ?, ?${count} to review$`)

/** The link's accessible name, as Playwright's accessibility snapshot has it. */
async function accessibleName(link: Locator) {
  const quoted = /^- link ("(?:[^"\\]|\\.)*")/.exec(await link.ariaSnapshot())
  expect(quoted, "the link has an accessible name").not.toBeNull()
  return JSON.parse(quoted![1]!) as string
}

/**
 * Visits each page and asserts `link` there has the same accessible name,
 * `name(count)` for the full count read on the first page. A badge over 9
 * shows "9+" (aria-hidden) and keeps the full count in assistive text, so
 * the DOM text is not the name. With `visible`, each page's badge also shows
 * exactly that.
 */
async function sameCountAcross(
  page: Page,
  paths: string[],
  link: (page: Page) => Locator,
  name: (count: string) => RegExp,
  visible?: string
) {
  let count: string | undefined
  for (const path of paths) {
    await page.goto(path)
    await expect(link(page)).toBeVisible()
    if (count === undefined) {
      const first = await accessibleName(link(page))
      expect(first).toMatch(name("\\d+"))
      count = name("(\\d+)").exec(first)![1]!
    }
    await expect(link(page), path).toHaveAccessibleName(name(count))
    if (visible !== undefined)
      await expect(
        link(page).getByText(visible, { exact: true }),
        path
      ).toBeVisible()
  }
  return Number(count)
}

test.describe("Home: truthful To do and badges", () => {
  test.setTimeout(300_000)

  test("390: an amenity check is in To do, the sent finding is confirmed, and the Home badge follows", async ({
    browser,
  }) => {
    const w = await provisionAmenitiesWorld()
    // Two checks, both photo evidence; no coverage task or target.
    const darts = await readyCheck(w, w.venueA, "darts", w.staffA)
    const toilets = checkId(w.venueA, "guest_toilets")
    await amenityOk(await sessionOf(w.admin), "amenity_assign_check", {
      p_check_id: toilets,
      p_assignee_id: w.staffA.id,
      p_revision: checkState(toilets).revision,
    })
    // Amenity evidence, as a capture upload is: never labelled, so the B02
    // Home's labels card (R1 counts general photos only) doesn't join these
    // counts, which follow the checks alone.
    const photo = await seedPhoto(w.staffA, w.venueA, `home-todo-${w.tag}`, {
      purpose: "amenity",
    })

    const page = await signedInPage(browser, w.staffA, PHONE)
    await expect(page).toHaveURL(STAFF_LANDING)
    const todo = todoRegion(page)
    await expect(todo).toHaveAccessibleName(/^To do, 2 things to do$/)
    await expect(page.getByText("Nothing to do right now.")).toHaveCount(0)
    // Each check has its own card and exact action, opening that check.
    const checks = new Map([
      [darts, question("darts")],
      [toilets, question("guest_toilets")],
    ])
    for (const [id, q] of checks) await expectTodoCheck(page, q, id)

    // The lead card starts the first check in one tap.
    const leadHref = await todo
      .getByRole("listitem")
      .first()
      .getByRole("link", { name: /^Start check: / })
      .getAttribute("href")
    const sent = [...checks.keys()].find(
      (id) => staffCaptureHref(id) === leadHref
    )
    if (!sent) throw new Error(`The lead card opens ${leadHref}, not a check`)
    await startTodoCheck(page, checks.get(sent)!, sent, "tap")
    const left = sent === toilets ? darts : toilets
    const form = captureForm(page)
    await form.answer("yes")
    await form.attach(photo)
    await submitAndComplete(page, sent)

    // Home confirms the sent check by name until dismissed.
    await expect(page).toHaveURL(
      new RegExp(`/staff/tasks\\?finding_sent=${escape(sent)}$`)
    )
    const notice = page.getByRole("status").filter({ hasText: "Finding sent" })
    await expect(notice).toBeVisible()
    await expect(notice).toBeFocused()
    await expect(notice).toContainText(checks.get(sent)!)
    await expect(todo).toHaveAccessibleName(/^To do, 1 things? to do$/)
    await expect(
      todo.getByRole("link", { name: /^Start check: / })
    ).toHaveCount(1)
    await expectTodoCheck(page, checks.get(left)!, left)

    await page.reload()
    await expect(notice).toBeVisible()
    await notice.getByRole("button", { name: "Dismiss" }).tap()
    await expect(notice).toHaveCount(0)
    await expect(
      page.getByRole("heading", { level: 2, name: /^To do/ })
    ).toBeFocused()
    await expect(page).toHaveURL(STAFF_LANDING)
    await page.reload()
    await expect(
      page.getByRole("status").filter({ hasText: "Finding sent" })
    ).toHaveCount(0)

    // The remaining check keeps the Home badge on every other tab.
    expect(await sameCountAcross(page, BADGE_PAGES, homeTab, homeName)).toBe(1)
  })

  test("an old request for another photo stays in To do, and badges match on every page at 390 and 1280", async ({
    browser,
  }) => {
    const w = await provisionCoverageWorld()
    const service = provisioner()
    const manager: Db = await signIn(service, w.manager.email)
    const staff: Db = await signIn(service, w.staffA.email)
    await legacyStaffGrant(w.admin, w.manager, w.venue1)
    const title = `Home todo shelf ${w.tag}`
    const [task] = await ok(
      manager.rpc("save_coverage_requirement", {
        p_venue_id: w.venue1.id,
        p_requirement_id: none,
        p_expected_revision: none,
        p_kind: "venue_specific",
        p_title: title,
        p_guidance: "Bottles facing out.",
        p_photo_target: 2,
        p_due_on: none,
        p_client_request_key: key(),
      })
    )
    await ok(
      manager.rpc("set_coverage_requirement_assignees", {
        p_requirement_id: task!.requirement_id,
        p_staff_ids: [w.staffA.id],
      })
    )
    const send = (assetIds: string[]) =>
      ok(
        staff.rpc("submit_coverage_photos", {
          p_asset_ids: assetIds,
          p_requirement_id: task!.requirement_id,
          p_client_request_key: key(),
        })
      ) as Promise<{ item_id: string; revision: number }[]>

    // The request is made first; then 101 newer photos are sent.
    const [first] = await send(await seedImages(w.staffA, w.venue1, 1))
    const reason = `Home todo: shelf out of focus (${w.tag})`
    await ok(
      manager.rpc("review_coverage_item", {
        p_item_id: first!.item_id,
        p_expected_revision: first!.revision,
        p_decision: "needs_another_photo",
        p_reason: reason,
        p_client_request_key: key(),
      })
    )
    const newer = await seedImages(w.staffA, w.venue1, 101)
    for (let i = 0; i < newer.length; i += 10)
      await send(newer.slice(i, i + 10))
    expect(
      Number(
        psql(
          `select count(*) from public.coverage_submission_items where author_id = '${w.staffA.id}'::uuid and submitted_at > (select submitted_at from public.coverage_submission_items where id = '${first!.item_id}'::uuid)`
        )
      )
    ).toBeGreaterThanOrEqual(101)

    const page = await signedInPage(browser, w.staffA, PHONE)
    await expect(page).toHaveURL(STAFF_LANDING)
    const todo = todoRegion(page)
    await expect(todo.getByText(reason)).toBeVisible()
    await expect(
      todo.getByRole("link", { name: `Send another photo for ${title}` })
    ).toBeVisible()
    // Over 9: the phone badge shows "9+" and reads the full count.
    const staffCount = await sameCountAcross(
      page,
      [...BADGE_PAGES, `/staff/people/${w.staffB.id}`, "/staff/profile"],
      homeTab,
      homeName,
      "9+"
    )
    expect(staffCount).toBeGreaterThan(9)

    // A staff-held venue manager at 1280: the same Manage badge everywhere.
    const desk = await signedInPage(browser, w.manager, DESKTOP)
    const reviewCount = await sameCountAcross(
      desk,
      [
        "/staff/tasks",
        ...BADGE_PAGES,
        `/staff/people/${w.staffA.id}`,
        "/staff/profile",
        "/staff/tasks/guide",
        "/staff/tasks/month",
        `/staff/tasks/${task!.requirement_id}`,
      ],
      manageLink,
      manageName
    )
    // 101 photos wait for review; the number itself is the summary's.
    expect(reviewCount).toBeGreaterThan(0)
  })
})
