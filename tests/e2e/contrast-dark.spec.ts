import { randomUUID } from "node:crypto"

import AxeBuilder from "@axe-core/playwright"
import { expect, test, type Page } from "@playwright/test"

import { signIn } from "../support/identities"
import {
  provisionCoverageWorld,
  seedImages,
  type CoverageWorld,
} from "./helpers/coverage-world"
import { activateMenu, createMenuDraft, ok } from "./helpers/menus"
import { provisioner, psql } from "./helpers/stack"
import { signedInPage } from "./helpers/world"

/**
 * Dark-theme colour contrast on the main staff, manager and admin pages. The
 * theme follows the system, so a dark colour scheme on the context is what a
 * user with a dark OS sees. Light is covered by responsive.spec.ts. Each
 * failure names the page, width, element and the colours axe measured. The
 * manager's month is prepared first so coverage, team, checklist and task
 * pages carry real chips; a visible closed chip is also measured on hover.
 */

const WIDTHS = [390, 1280] as const

test.skip(({ browserName }) => browserName !== "chromium", "Chromium only")
test.describe.configure({ mode: "serial" })

let world: CoverageWorld
let staff: Page
let manager: Page
let admin: Page
let checklistItemId: string
let taskId: string
let draftId: string
let hovered = 0

test.beforeAll(async ({ browser }) => {
  test.setTimeout(240_000)
  world = await provisionCoverageWorld()
  await seedImages(world.staffA, world.venue1, 3, { prefix: "dark-a" })
  await seedImages(world.staffB, world.venue1, 2, { prefix: "dark-b" })

  const service = provisioner()
  const adminDb = await signIn(service, world.admin.email)
  const managerDb = await signIn(service, world.manager.email)
  await activateMenu(
    adminDb,
    await createMenuDraft(adminDb, world.venue1.id, "Dark menu")
  )
  draftId = await createMenuDraft(adminDb, world.venue1.id, "Dark menu draft")
  await ok(
    adminDb.rpc("grant_venue_manager", {
      p_staff_id: world.manager.id,
      p_venue_id: world.venue1.id,
    })
  )
  await ok(
    managerDb.rpc("prepare_coverage_month", { p_venue_id: world.venue1.id })
  )
  checklistItemId = psql(
    `select id from public.coverage_requirements where venue_id = '${world.venue1.id}'::uuid and status = 'needs_setup' order by title limit 1`
  )
  expect(checklistItemId, "a prepared checklist item").toMatch(/^[0-9a-f-]{36}$/)
  const [task] = await ok(
    managerDb.rpc("save_coverage_requirement", {
      p_venue_id: world.venue1.id,
      p_requirement_id: null as never,
      p_expected_revision: null as never,
      p_kind: "venue_specific",
      p_title: `Dark back bar ${world.tag}`,
      p_guidance: "Bottles facing out, labels readable.",
      p_photo_target: 2,
      p_due_on: null as never,
      p_client_request_key: `dark-${randomUUID()}`,
    })
  )
  taskId = (task as { requirement_id: string }).requirement_id
  await ok(
    managerDb.rpc("set_coverage_requirement_assignees", {
      p_requirement_id: taskId,
      p_staff_ids: [world.staffA.id],
    })
  )

  const dark = { colorScheme: "dark" } as const
  staff = await signedInPage(browser, world.staffA, dark)
  manager = await signedInPage(browser, world.manager, dark)
  admin = await signedInPage(browser, world.admin, dark)
})

test.afterAll(async () => {
  await staff?.context().close()
  await manager?.context().close()
  await admin?.context().close()
})

function describeNodes(
  violations: Awaited<ReturnType<AxeBuilder["analyze"]>>["violations"]
) {
  return violations.flatMap((v) =>
    v.nodes.map((n) => {
      const data = n.any[0]?.data as
        | { fgColor?: string; bgColor?: string; contrastRatio?: number }
        | undefined
      return `${n.target.join(" ")} fg=${data?.fgColor} bg=${data?.bgColor} ratio=${data?.contrastRatio}`
    })
  )
}

async function contrast(page: Page, width: number, path: string) {
  await page.setViewportSize({ width, height: 900 })
  const res = await page.goto(path)
  expect(res?.status(), `${path} status`).toBeLessThan(400)
  await expect(page.locator("html")).toHaveClass(/\bdark\b/)
  await expect(page.locator("h1").first()).toBeVisible()
  await page.waitForFunction(() =>
    document.getAnimations().every((a) => a.playState !== "running")
  )
  const result = await new AxeBuilder({ page })
    .withRules(["color-contrast"])
    .analyze()
  const checked = result.passes.flatMap((v) => v.nodes).length
  expect(checked, `${path}@${width}: axe measured no text`).toBeGreaterThan(5)
  // Text over images or gradients axe cannot resolve; counted, not failed.
  const incomplete = result.incomplete.flatMap((v) => v.nodes).length
  test.info().annotations.push({
    type: "axe-incomplete",
    description: `${path}@${width}: ${incomplete} incomplete, ${checked} passed`,
  })
  expect
    .soft(
      describeNodes(result.violations),
      `${path}@${width} dark colour contrast`
    )
    .toEqual([])

  const closed = page
    .locator('[data-slot="status-chip"][data-tone="closed"]')
    .filter({ visible: true })
    .first()
  if ((await closed.count()) === 0) return
  await closed.scrollIntoViewIfNeeded()
  await closed.hover()
  await closed.evaluate((el) => el.setAttribute("data-e2e-hovered", "1"))
  const onHover = await new AxeBuilder({ page })
    .withRules(["color-contrast"])
    .include("[data-e2e-hovered]")
    .analyze()
  hovered++
  expect
    .soft(
      describeNodes(onHover.violations),
      `${path}@${width} closed chip on hover`
    )
    .toEqual([])
}

const STAFF_PAGES = () => [
  "/staff/tasks",
  `/staff/tasks/${taskId}`,
  "/staff/tasks/month",
  "/staff",
  "/staff/community",
  "/staff/people",
  `/staff/people/${world.staffB.id}`,
]

const MANAGER_PAGES = () => [
  "/staff/manage",
  "/staff/manage/team",
  "/staff/manage/checklist",
  `/staff/manage/checklist/${checklistItemId}`,
  "/staff/manage/review",
  "/staff/manage/menu",
]

const ADMIN_PAGES = () => [
  "/admin",
  "/admin/staff",
  `/admin/staff/${world.staffA.id}`,
  "/admin/coverage",
  "/admin/coverage/managers",
  `/admin/coverage/${world.venue1.id}`,
  `/admin/coverage/${world.venue1.id}/team`,
  `/admin/coverage/${world.venue1.id}/checklist`,
  "/admin/menus",
  `/admin/menus/${world.venue1.id}`,
  `/admin/menus/versions/${draftId}`,
]

for (const width of WIDTHS) {
  test(`staff pages hold 4.5:1 in dark at ${width}px`, async () => {
    for (const path of STAFF_PAGES()) await contrast(staff, width, path)
  })

  test(`manager pages hold 4.5:1 in dark at ${width}px`, async () => {
    for (const path of MANAGER_PAGES()) await contrast(manager, width, path)
  })

  test(`admin pages hold 4.5:1 in dark at ${width}px`, async () => {
    for (const path of ADMIN_PAGES()) await contrast(admin, width, path)
  })
}

test("closed chips measured on hover", () => {
  test.info().annotations.push({
    type: "closed-chip-hover",
    description: `${hovered} page states had a visible closed chip`,
  })
})
