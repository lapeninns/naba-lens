import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

import AxeBuilder from "@axe-core/playwright"
import {
  devices,
  expect,
  test,
  type Browser,
  type Locator,
  type Page,
} from "@playwright/test"

import { supportedMp4, syntheticJpeg } from "./helpers/media"
import { requireIsolatedStack } from "./helpers/stack"
import {
  chooseOption,
  escape,
  portfolioList,
  uploadThroughDialog,
} from "./helpers/ui"
import {
  provisionWorld,
  seedReadyAssets,
  signedInPage,
  type World,
} from "./helpers/world"

/**
 * v0.3 QA (packet J), contract §7 row 14: the new screens at 360, 390, 768 and
 * 1280 CSS px (Chromium emulation, not a phone test). For each state: no
 * horizontal overflow, axe (WCAG 2.x A/AA) without serious/critical findings,
 * the admin nav reachable at phone widths, and a full-page screenshot in
 * .artifacts/screenshots/menus/ (override with QA_SHOTS_DIR) for visual review.
 * Plus keyboard-only label editing and a touch (Pixel 7 emulation) label flow.
 */

test.beforeAll(() => requireIsolatedStack())

const SHOTS =
  process.env.QA_SHOTS_DIR ??
  join(process.cwd(), ".artifacts/screenshots/menus")
const WIDTHS = [360, 390, 768, 1280] as const
const HEIGHT: Record<number, number> = {
  360: 780,
  390: 844,
  768: 1024,
  1280: 800,
}
const RAILWAY = fileURLToPath(
  new URL("../fixtures/menus/the-railway.food.json", import.meta.url)
)

type Finding = {
  width: number
  state: string
  overflowPx: number
  axe: { id: string; impact: string | null | undefined; targets: string[] }[]
}
const findings: Finding[] = []

async function check(
  page: Page,
  width: number,
  state: string,
  scope?: Locator
) {
  await page.evaluate(() => document.fonts.ready)
  // Let dialog open animations (fade/zoom) finish before measuring contrast.
  await page.evaluate(() =>
    Promise.all(
      document.getAnimations().map((a) => a.finished.catch(() => undefined))
    )
  )
  const overflowPx = await page.evaluate(() => {
    let worst = document.documentElement.scrollWidth - window.innerWidth
    for (const el of Array.from(
      document.querySelectorAll('[role="dialog"], [role="alertdialog"]')
    )) {
      worst = Math.max(worst, el.scrollWidth - el.clientWidth)
    }
    return Math.max(0, worst)
  })
  let axe = new AxeBuilder({ page }).withTags([
    "wcag2a",
    "wcag2aa",
    "wcag21a",
    "wcag21aa",
    "wcag22aa",
  ])
  if (scope) {
    const id = await scope.evaluate((el) => {
      el.setAttribute("data-qa-scope", "1")
      return "[data-qa-scope]"
    })
    axe = axe.include(id)
  }
  const result = await axe.analyze()
  if (scope) await scope.evaluate((el) => el.removeAttribute("data-qa-scope"))
  const serious = result.violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => ({
      id: v.id,
      impact: v.impact,
      targets: v.nodes.slice(0, 3).map((n) => n.target.join(" ")),
    }))
  findings.push({ width, state, overflowPx, axe: serious })
  mkdirSync(SHOTS, { recursive: true })
  const shot = await page.screenshot({
    path: join(SHOTS, `${String(width).padStart(4, "0")}-${state}.png`),
    fullPage: true,
  })
  if (width === 360)
    await test.info().attach(`${state}@360`, {
      body: shot,
      contentType: "image/png",
    })
  expect.soft(overflowPx, `${state}@${width}: horizontal overflow`).toBe(0)
  expect
    .soft(
      serious.map((v) => `${v.id} ${v.targets.join(" | ")}`),
      `${state}@${width}: axe serious/critical`
    )
    .toEqual([])
}

test.afterAll(() => {
  mkdirSync(SHOTS, { recursive: true })
  writeFileSync(
    join(SHOTS, "summary.json"),
    JSON.stringify(findings, null, 2) + "\n"
  )
})

let world: World
let draftUrl = ""

test.beforeAll(async ({ browser }) => {
  test.setTimeout(180_000)
  world = await provisionWorld()
  await seedReadyAssets(
    world.staffA.id,
    world.venue1.id,
    2,
    "image",
    `qa-rsp-${world.tag}`
  )
  const admin = await signedInPage(browser, world.adminA)
  await admin.goto(`/admin/menus/${world.venue1.id}`)
  await expect(admin.getByRole("heading", { level: 1 })).toBeVisible()
  await admin.getByLabel("Menu file (JSON or CSV)").setInputFiles(RAILWAY)
  await admin.getByRole("button", { name: "Create draft" }).click()
  await admin.waitForURL(/\/admin\/menus\/versions\//)
  await admin.getByRole("button", { name: "Activate…" }).click()
  await admin
    .getByRole("alertdialog")
    .getByRole("button", { name: "Activate for labelling" })
    .click()
  await expect(
    admin.getByRole("button", { name: "Retire menu…" })
  ).toBeVisible()
  // A second draft (from the active menu) for the editor screens.
  await admin.goto(`/admin/menus/${world.venue1.id}`)
  await admin
    .getByRole("button", { name: "Start a draft from the active menu" })
    .click()
  await admin.waitForURL(/\/admin\/menus\/versions\//)
  draftUrl = new URL(admin.url()).pathname
  await admin.context().close()
})

async function at(browser: Browser, who: World["adminA"], width: number) {
  return signedInPage(browser, who, {
    viewport: { width, height: HEIGHT[width] },
  })
}

for (const width of WIDTHS) {
  test(`admin Menus screens at ${width}px`, async ({ browser }) => {
    test.setTimeout(180_000)
    const page = await at(browser, world.adminA, width)

    await page.goto("/admin/menus")
    await expect(
      page.getByRole("heading", { level: 1, name: "Menus" })
    ).toBeVisible()
    const nav = page.getByRole("navigation", { name: "Admin" })
    for (const name of ["Content", "Staff", "Menus"]) {
      const box = await nav.getByRole("link", { name }).boundingBox()
      expect.soft(box, `nav ${name}@${width}`).not.toBeNull()
      if (box) {
        expect
          .soft(box.x + box.width, `nav ${name} inside viewport@${width}`)
          .toBeLessThanOrEqual(width)
        if (width <= 480)
          expect
            .soft(box.height, `nav ${name} touch height@${width}`)
            .toBeGreaterThanOrEqual(44)
      }
    }
    await check(page, width, "menus-venues")

    await nav.getByRole("link", { name: "Content" }).click()
    await expect(
      page.getByRole("heading", { level: 1, name: "Content" })
    ).toBeVisible()
    await nav.getByRole("link", { name: "Menus" }).click()
    await expect(
      page.getByRole("heading", { level: 1, name: "Menus" })
    ).toBeVisible()

    await page.goto(`/admin/menus/${world.venue1.id}`)
    await expect(
      page.getByRole("heading", { level: 1, name: world.venue1.name })
    ).toBeVisible()
    await check(page, width, "menus-venue")
    await page.getByLabel("Menu file (JSON or CSV)").setInputFiles(RAILWAY)
    await expect(page.getByRole("heading", { name: /^Preview:/ })).toBeVisible()
    await check(page, width, "menus-import-preview")

    await page.goto(draftUrl)
    await expect(page.getByRole("button", { name: "Save draft" })).toBeVisible()
    await page.getByRole("searchbox", { name: "Search items" }).fill("Momo")
    await page
      .getByRole("button", { name: /^Momo Veg · Chicken/, expanded: false })
      .click()
    await check(page, width, "menus-draft-editor")
    await page.getByRole("button", { name: "Activate…" }).click()
    const dialog = page.getByRole("alertdialog")
    await expect(dialog).toBeVisible()
    await check(page, width, "menus-activate-dialog", dialog)
    await page.keyboard.press("Escape")

    await page.goto("/admin")
    await chooseOption(page, page, "Venue", world.venue1.name)
    await page.getByRole("button", { name: "More filters" }).click()
    await page.getByRole("combobox", { name: "Menu item" }).fill("Onion")
    await expect(
      page.getByRole("listbox", { name: "Menu items" })
    ).toBeVisible()
    await check(page, width, "library-filters-open")
    await page.context().close()
  })

  test(`staff label editors at ${width}px`, async ({ browser }) => {
    test.setTimeout(180_000)
    const page = await at(browser, world.staffA, width)
    await page.goto("/staff")
    await portfolioList(page)
      .getByRole("button", {
        name: new RegExp(`^Photo, qa-rsp-${world.tag}-01\\.jpg`),
      })
      .click()
    await page
      .getByRole("dialog")
      .first()
      .getByRole("button", { name: /^(Add|Edit) labels$/ })
      .click()
    const single = page.getByRole("dialog", { name: /^(Add|Edit) labels$/ })
    await single
      .getByRole("combobox", { name: /^Search the menu/ })
      .fill("chicken")
    await expect(
      single.getByRole("listbox", { name: "Matching menu items" })
    ).toBeVisible()
    await check(page, width, "label-editor-single-search", single)
    await single.getByRole("combobox", { name: /^Search the menu/ }).fill("")
    await single.getByRole("button", { name: "Item not on the menu?" }).click()
    await check(page, width, "label-editor-single-missing", single)
    await page.keyboard.press("Escape")
    const discard = page.getByRole("alertdialog")
    if (await discard.isVisible())
      await discard.getByRole("button", { name: /^Discard/ }).click()

    const photo = await syntheticJpeg(`qa-rsp-up-${width}-${world.tag}.jpg`)
    const video = supportedMp4(`qa-rsp-up-${width}-${world.tag}.mp4`)
    await page.keyboard.press("Escape")
    await uploadThroughDialog(page, [photo, video], { close: false })
    await page
      .getByRole("dialog", { name: "Upload photos or videos" })
      .getByRole("button", { name: "Label these files" })
      .click()
    const batch = page.getByRole("dialog", { name: "Label these files" })
    await batch
      .getByRole("combobox", { name: "Search the menu for all files" })
      .fill("momo")
    await batch.getByRole("option", { name: /^Momo in Appetisers/ }).click()
    await check(page, width, "label-editor-batch-variant", batch)
    await batch.getByRole("button", { name: "Chicken" }).click()
    await batch
      .getByRole("button", { name: `Adjust labels for ${video.name}` })
      .click()
    await check(page, width, "label-editor-batch-adjust", batch)
    await batch.getByRole("button", { name: "Save labels for 2 files" }).click()
    await expect(batch).toBeHidden()
    await page.context().close()
  })
}

test("keyboard only: open the editor, pick an item, a content type, a note, save; focus returns", async ({
  browser,
}) => {
  test.setTimeout(120_000)
  const page = await at(browser, world.staffA, 390)
  await page.goto("/staff")
  const tile = portfolioList(page).getByRole("button", {
    name: new RegExp(`^Photo, qa-rsp-${world.tag}-02\\.jpg`),
  })
  await tile.focus()
  await page.keyboard.press("Enter")
  const viewer = page.getByRole("dialog").first()
  const add = viewer.getByRole("button", { name: /^(Add|Edit) labels$/ })
  await tabTo(page, add)
  await page.keyboard.press("Enter")
  const editor = page.getByRole("dialog", { name: /^(Add|Edit) labels$/ })
  await expect(editor).toBeVisible()
  expect(await editor.evaluate((d) => d.contains(document.activeElement))).toBe(
    true
  )

  const search = editor.getByRole("combobox", { name: /^Search the menu/ })
  await tabTo(page, search)
  await page.keyboard.type("onion bhaji")
  await expect(
    editor.getByRole("option", { name: /^Onion Bhaji in Appetisers/ })
  ).toBeVisible()
  await page.keyboard.press("ArrowDown")
  await page.keyboard.press("Enter")
  await expect(
    editor.getByRole("list", { name: /^Selected menu items/ })
  ).toContainText("Onion Bhaji")

  const kitchen = editor.getByRole("button", { name: "Kitchen" })
  await tabTo(page, kitchen)
  await page.keyboard.press("Space")
  await expect(kitchen).toHaveAttribute("aria-pressed", "true")
  await tabTo(page, editor.getByRole("textbox", { name: /^Note/ }))
  await page.keyboard.type("Keyboard only QA note")
  await tabTo(page, editor.getByRole("button", { name: /^Save labels/ }))
  await page.keyboard.press("Enter")
  await expect(editor).toBeHidden()
  const labels = viewer.getByRole("region", { name: "Labels" })
  await expect(labels.getByRole("list", { name: "Menu items" })).toContainText(
    "Onion Bhaji"
  )
  await expect(labels).toContainText("Keyboard only QA note")
  // Focus returns into the viewer (not lost to <body>).
  expect(await viewer.evaluate((d) => d.contains(document.activeElement))).toBe(
    true
  )
  await page.context().close()
})

test("touch (Pixel 7 emulation): upload, label with taps, labels persist", async ({
  browser,
}) => {
  test.setTimeout(120_000)
  const { defaultBrowserType: _ignored, ...pixel } = devices["Pixel 7"]
  void _ignored
  const page = await signedInPage(browser, world.staffA, pixel)
  await page.goto("/staff")
  const photo = await syntheticJpeg(`qa-touch-${world.tag}.jpg`)
  await uploadThroughDialog(page, [photo], { close: false })
  await page
    .getByRole("dialog", { name: "Upload photos or videos" })
    .getByRole("button", { name: "Label this file" })
    .tap()
  const editor = page.getByRole("dialog", {
    name: /^(Label this file|Add labels)$/,
  })
  await editor
    .getByRole("combobox", { name: /^Search the menu/ })
    .fill("garlic")
  await editor
    .getByRole("option", { name: /^Garlic Mushroom in Appetisers/ })
    .tap()
  await editor.getByRole("button", { name: "Plating" }).tap()
  await editor.getByRole("button", { name: /^Save labels/ }).tap()
  await expect(editor).toBeHidden()
  await page.reload()
  await expect(
    portfolioList(page).getByRole("button", {
      name: new RegExp(`^Photo, ${escape(photo.name)}`),
    })
  ).toHaveAccessibleName(/, 2 labels$/)
  await page.context().close()
})

/** Presses Tab (at most 60 times) until `target` has focus. */
async function tabTo(page: Page, target: Locator) {
  for (let i = 0; i < 60; i++) {
    if (
      await target
        .evaluate((el) => el === document.activeElement)
        .catch(() => false)
    )
      return
    await page.keyboard.press("Tab")
  }
  throw new Error("Could not reach the control with Tab")
}
