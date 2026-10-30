import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import AxeBuilder from "@axe-core/playwright"
import { expect, test, type Locator, type Page } from "@playwright/test"

import { supportedMp4, syntheticJpeg, type SourceFile } from "./helpers/media"
import {
  libraryList,
  portfolioList,
  tile,
  uploadThroughDialog,
} from "./helpers/ui"
import { provisionWorld, signedInPage, type World } from "./helpers/world"

/**
 * Viewport, accessibility and keyboard checks (spec §4) on Chromium: every
 * screen and dialog at 360/390/768/1280/1440 CSS px. Each state must have no
 * horizontal overflow, its primary action visible inside the viewport, and zero
 * serious/critical axe-core violations. Screenshots go to .artifacts/screenshots
 * (gitignored) for human review; a JSON summary sits next to them.
 */

const WIDTHS = [360, 390, 768, 1280, 1440] as const
const SHOTS = join(".artifacts", "screenshots")
mkdirSync(SHOTS, { recursive: true })

type Finding = {
  width: number
  state: string
  overflowPx: number
  primaryVisible: boolean
  axe: {
    id: string
    impact: string | null | undefined
    nodes: number
    targets: string[]
  }[]
}

test.describe.configure({ mode: "serial" })
test.skip(({ browserName }) => browserName !== "chromium", "Chromium only")

let world: World
let staff: Page
let admin: Page
let anon: Page
let jpeg: SourceFile
let mp4: SourceFile
const findings: Finding[] = []

test.beforeAll(async ({ browser }) => {
  test.setTimeout(180_000)
  world = await provisionWorld()
  jpeg = await syntheticJpeg(`viewport-${world.tag}.jpg`)
  mp4 = supportedMp4(`viewport-${world.tag}.mp4`)
  staff = await signedInPage(browser, world.staffA)
  await expect(staff).toHaveURL(/\/staff$/)
  await uploadThroughDialog(staff, [jpeg, mp4])
  admin = await signedInPage(browser, world.adminA)
  await expect(admin).toHaveURL(/\/admin$/)
  anon = await (await browser.newContext()).newPage()
})

test.afterAll(async () => {
  writeFileSync(
    join(SHOTS, "summary.json"),
    JSON.stringify(findings, null, 2) + "\n"
  )
  await staff?.context().close()
  await admin?.context().close()
  await anon?.context().close()
})

async function check(
  page: Page,
  width: number,
  state: string,
  primary: Locator,
  scope?: Locator
) {
  await expect(primary).toBeVisible()
  // Let entry animations settle before measuring and capturing.
  await page.waitForFunction(() =>
    document.getAnimations().every((a) => a.playState !== "running")
  )
  // Signed thumbnails/previews are lazy; wait until every image has settled
  // (loaded or failed) so the capture shows what a user would see.
  await page.waitForFunction(
    () =>
      Array.from(document.images).every((img) => {
        const r = img.getBoundingClientRect()
        const offscreen = r.bottom < 0 || r.top > window.innerHeight
        return img.complete || offscreen
      }),
    undefined,
    { timeout: 20_000 }
  )
  const overflowPx = await page.evaluate(() => {
    const doc = document.documentElement
    let worst = doc.scrollWidth - window.innerWidth
    for (const el of Array.from(
      document.querySelectorAll('[role="dialog"], [role="alertdialog"]')
    )) {
      worst = Math.max(worst, el.scrollWidth - el.clientWidth)
    }
    return Math.max(0, worst)
  })
  const box = await primary.boundingBox()
  const primaryVisible =
    !!box && box.x >= 0 && box.x + box.width <= width + 0.5 && box.width > 0
  let axe = new AxeBuilder({ page }).withTags([
    "wcag2a",
    "wcag2aa",
    "wcag21a",
    "wcag21aa",
    "wcag22aa",
  ])
  if (scope) axe = axe.include(await selectorFor(scope))
  const result = await axe.analyze()
  const serious = result.violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => ({
      id: v.id,
      impact: v.impact,
      nodes: v.nodes.length,
      targets: v.nodes
        .slice(0, 3)
        .map(
          (n) =>
            `${n.target.join(" ")} :: ${n.failureSummary?.split("\n")[1]?.trim() ?? ""}`
        ),
    }))
  findings.push({ width, state, overflowPx, primaryVisible, axe: serious })
  await page.screenshot({
    path: join(SHOTS, `${String(width).padStart(4, "0")}-${state}.png`),
    fullPage: !scope,
  })
  expect.soft(overflowPx, `${state}@${width}: horizontal overflow`).toBe(0)
  expect.soft(primaryVisible, `${state}@${width}: primary action`).toBe(true)
  expect
    .soft(
      serious.map((v) => v.id),
      `${state}@${width}: axe serious/critical`
    )
    .toEqual([])
}

/** A unique CSS selector for a dialog locator (axe include). */
async function selectorFor(scope: Locator) {
  const id = await scope.evaluate((el) => {
    el.setAttribute("data-e2e-scope", "1")
    return "[data-e2e-scope]"
  })
  return id
}

async function closeDialog(page: Page) {
  await page.keyboard.press("Escape")
  await expect(
    page.getByRole("dialog").or(page.getByRole("alertdialog"))
  ).toHaveCount(0)
}

for (const width of WIDTHS) {
  test(`screens and dialogs at ${width}px`, async () => {
    test.setTimeout(240_000)
    for (const page of [staff, admin, anon]) {
      await page.setViewportSize({ width, height: width < 768 ? 800 : 900 })
    }

    // --- /login
    await anon.goto("/login")
    await check(
      anon,
      width,
      "login",
      anon.getByRole("button", { name: "Send sign-in link" })
    )
    await anon.goto("/login?error=link_invalid")
    await check(
      anon,
      width,
      "login-expired",
      anon.getByRole("button", { name: "Send sign-in link" })
    )

    // --- /staff and its dialogs
    await staff.goto("/staff")
    const portfolio = portfolioList(staff)
    await expect(tile(portfolio, "Photo", jpeg.name)).toBeVisible()
    const upload = staff
      .getByRole("button", { name: "Upload photos or videos" })
      .first()
    await check(staff, width, "staff-portfolio", upload)

    await upload.click()
    const uploadDialog = staff.getByRole("dialog")
    await uploadDialog
      .getByLabel("Choose photos or videos")
      .setInputFiles(jpeg.path)
    await check(
      staff,
      width,
      "staff-upload-dialog",
      uploadDialog.getByRole("button", { name: "Upload 1 file" }),
      uploadDialog
    )
    await uploadDialog.getByRole("button", { name: "Cancel" }).click()
    await expect(uploadDialog).toBeHidden()

    await staff.getByRole("button", { name: "Edit profile" }).click()
    const edit = staff.getByRole("dialog")
    await check(
      staff,
      width,
      "staff-edit-profile",
      edit.getByRole("button", { name: /^Save/ }),
      edit
    )
    await closeDialog(staff)

    await tile(portfolio, "Photo", jpeg.name).click()
    const viewer = staff.getByRole("dialog")
    await check(
      staff,
      width,
      "staff-viewer-photo",
      viewer.getByRole("button", { name: "Delete" }),
      viewer
    )
    await viewer.getByRole("button", { name: "Delete" }).click()
    const confirm = staff.getByRole("alertdialog")
    await check(
      staff,
      width,
      "staff-delete-confirm",
      confirm.getByRole("button", { name: "Delete" }),
      confirm
    )
    await confirm.getByRole("button", { name: "Keep file" }).click()
    await closeDialog(staff)

    // --- /admin library, filters and viewer
    await admin.goto(`/admin?staff=${world.staffA.id}`)
    const library = libraryList(admin)
    await expect(tile(library, "Video", mp4.name)).toBeVisible()
    await check(
      admin,
      width,
      "admin-library",
      admin.getByRole("group", { name: "Filter library" })
    )
    await tile(library, "Video", mp4.name).click()
    const adminViewer = admin.getByRole("dialog")
    await check(
      admin,
      width,
      "admin-viewer-video",
      adminViewer.getByRole("link", { name: "Download original" }),
      adminViewer
    )
    await closeDialog(admin)
    await admin.getByRole("combobox", { name: "Venue" }).click()
    await check(
      admin,
      width,
      "admin-venue-filter-open",
      admin.getByRole("option").first()
    )
    await admin.keyboard.press("Escape")

    // --- /admin/staff directory and dialogs
    await admin.goto("/admin/staff")
    const invite = admin.getByRole("button", { name: "Invite staff" })
    await check(admin, width, "admin-staff-directory", invite)
    await invite.click()
    const inviteDialog = admin.getByRole("dialog")
    await check(
      admin,
      width,
      "admin-invite-dialog",
      inviteDialog.getByRole("button", { name: "Send invitation" }),
      inviteDialog
    )
    await closeDialog(admin)
    await admin
      .getByRole("button", { name: `More actions for ${world.staffA.name}` })
      .click()
    await check(
      admin,
      width,
      "admin-row-actions-menu",
      admin.getByRole("menuitem", { name: "Edit details" })
    )
    await admin.keyboard.press("Escape")

    // --- /admin/staff/[id] and its dialogs
    await admin.goto(`/admin/staff/${world.staffA.id}`)
    await check(
      admin,
      width,
      "admin-staff-portfolio",
      admin.getByRole("button", { name: "Edit details" })
    )
    await admin.getByRole("button", { name: "Edit details" }).click()
    const details = admin.getByRole("dialog")
    await check(
      admin,
      width,
      "admin-edit-details",
      details.getByRole("button", { name: "Save changes" }),
      details
    )
    await closeDialog(admin)
    await admin.getByRole("button", { name: "Deactivate" }).click()
    const deactivate = admin.getByRole("alertdialog")
    await check(
      admin,
      width,
      "admin-deactivate-confirm",
      deactivate.getByRole("button", { name: "Deactivate" }),
      deactivate
    )
    await deactivate.getByRole("button", { name: "Cancel" }).click()
    await expect(deactivate).toBeHidden()
  })
}

/** Presses Tab until the focused element's accessible name matches. */
async function tabTo(page: Page, name: RegExp, max = 60) {
  for (let i = 0; i < max; i++) {
    await page.keyboard.press("Tab")
    const focused = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null
      return (el?.getAttribute("aria-label") ?? el?.innerText ?? "").trim()
    })
    if (name.test(focused)) return
  }
  throw new Error(`Tab never reached ${name}`)
}

test("keyboard only: upload, open the viewer, download", async () => {
  test.setTimeout(120_000)
  const extra = await syntheticJpeg(`keyboard-${world.tag}.jpg`)
  await staff.setViewportSize({ width: 390, height: 800 })
  await staff.goto("/staff")
  await tabTo(staff, /^Upload photos or videos$/)
  await staff.keyboard.press("Enter")
  const dialog = staff.getByRole("dialog")
  await expect(dialog).toBeVisible()
  await tabTo(staff, /^Choose files$/)
  const [chooser] = await Promise.all([
    staff.waitForEvent("filechooser"),
    staff.keyboard.press("Enter"),
  ])
  await chooser.setFiles(extra.path)
  await tabTo(staff, /^Upload 1 file$/)
  await staff.keyboard.press("Enter")
  await expect(dialog.getByRole("status")).toHaveText("1 uploaded", {
    timeout: 90_000,
  })
  await tabTo(staff, /^Done$/)
  await staff.keyboard.press("Enter")
  await expect(dialog).toBeHidden()

  // Viewer: open from the grid, focus is trapped in it, Escape returns focus.
  const keyboardTile = tile(portfolioList(staff), "Photo", extra.name)
  await expect(keyboardTile).toBeVisible()
  await tabTo(staff, new RegExp(`^Photo, ${extra.name.replace(".", "\\.")}`))
  await staff.keyboard.press("Enter")
  const viewer = staff.getByRole("dialog")
  await expect(viewer).toBeVisible()
  expect(
    await viewer.evaluate((el) => el.contains(document.activeElement))
  ).toBe(true)
  await staff.keyboard.press("Escape")
  await expect(viewer).toBeHidden()
  await expect(keyboardTile).toBeFocused()

  // Admin: reach a tile and download its original with the keyboard only.
  await admin.setViewportSize({ width: 1280, height: 900 })
  await admin.goto(`/admin?staff=${world.staffA.id}&type=image`)
  await expect(tile(libraryList(admin), "Photo", extra.name)).toBeVisible()
  await tabTo(admin, new RegExp(`^Photo, ${extra.name.replace(".", "\\.")}`))
  await admin.keyboard.press("Enter")
  await tabTo(admin, /^Download original$/)
  const [download] = await Promise.all([
    admin.waitForEvent("download"),
    admin.keyboard.press("Enter"),
  ])
  expect(download.suggestedFilename()).toBe(extra.name)
  expect(await download.failure()).toBeNull()
})
