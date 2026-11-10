import { randomUUID } from "node:crypto"

import { expect, test, type Page } from "@playwright/test"

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
import { escape, STAFF_LANDING } from "./helpers/ui"
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

/** Visits each page and returns the accessible name of `link` there. */
async function namesAcross(
  page: Page,
  paths: string[],
  link: (page: Page) => ReturnType<typeof homeTab>
) {
  const names: string[] = []
  for (const path of paths) {
    await page.goto(path)
    await expect(link(page)).toBeVisible()
    names.push((await link(page).textContent())?.replace(/\s+/g, " ") ?? "")
  }
  return names
}

test.describe("Home: truthful To do and badges", () => {
  test.setTimeout(300_000)

  test("390: an amenity check is in To do, the sent finding is confirmed, and the Home badge follows", async ({
    browser,
  }) => {
    const w = await provisionAmenitiesWorld()
    // Two checks, both photo evidence; no coverage task or target.
    await readyCheck(w, w.venueA, "darts", w.staffA)
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
    const todo = page.getByRole("region", { name: /^To do/ })
    await expect(todo).toHaveAccessibleName(/^To do, 2 things to do$/)
    await expect(page.getByText("Nothing to do right now.")).toHaveCount(0)

    // The lead card starts the first check in one tap.
    await todo.getByRole("link", { name: /^Start check: / }).tap()
    await expect(page).toHaveURL(/\/staff\/tasks\/amenities\/[0-9a-f-]+$/)
    const sent = page.url().split("/").pop()!
    const left = sent === toilets ? checkId(w.venueA, "darts") : toilets
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
    const sentKey = sent === toilets ? "guest_toilets" : "darts"
    await expect(notice).toContainText(question(sentKey))
    await expect(todo).toHaveAccessibleName(/^To do, 1 things? to do$/)
    await expect(
      todo.getByRole("link", { name: /^Start check: / })
    ).toHaveAttribute("href", staffCaptureHref(left))

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
    const names = await namesAcross(page, BADGE_PAGES, homeTab)
    expect(
      names.every((n) => /^Home, ?1 thing to do$/.test(n)),
      names.join(" | ")
    ).toBe(true)
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
    const todo = page.getByRole("region", { name: /^To do/ })
    await expect(todo.getByText(reason)).toBeVisible()
    await expect(
      todo.getByRole("link", { name: `Send another photo for ${title}` })
    ).toBeVisible()
    const staffNames = await namesAcross(
      page,
      [...BADGE_PAGES, `/staff/people/${w.staffB.id}`, "/staff/profile"],
      homeTab
    )
    expect(new Set(staffNames).size, staffNames.join(" | ")).toBe(1)
    expect(staffNames[0]).toMatch(/^Home, ?\d+ things? to do$/)

    // A staff-held venue manager at 1280: the same Manage badge everywhere.
    const desk = await signedInPage(browser, w.manager, DESKTOP)
    const managerNames = await namesAcross(
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
      manageLink
    )
    expect(new Set(managerNames).size, managerNames.join(" | ")).toBe(1)
    // 101 photos wait for review; the number itself is the summary's.
    expect(managerNames[0]).toMatch(/^Manage, ?[1-9]\d* to review$/)
  })
})
