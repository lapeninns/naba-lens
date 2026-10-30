import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import AxeBuilder from "@axe-core/playwright"
import {
  expect,
  test,
  type Browser,
  type Locator,
  type Page,
  type TestInfo,
} from "@playwright/test"
import sharp from "sharp"

import { serviceClient } from "../support/identities"
import { seedVisualFixtures, type VisualFixtures } from "../visual/fixtures"

/**
 * Visual and accessibility regression pass (spec §4). For every screen and
 * dialog state it saves a full-page screenshot to
 * .artifacts/screenshots/visual/<project>/ and checks, at each QA width:
 *
 * - axe (WCAG 2.2 A/AA): no serious or critical violations;
 * - no horizontal overflow of the page or of any visible element;
 * - on phone widths, touch targets of at least 44 × 44 CSS px.
 *
 * Keyboard checks: every tab stop on the main screens shows a visible focus
 * indicator, and focus returns to the opener when a dialog closes. Media checks:
 * the viewer shows the whole image (no crop) inside the viewport, and video never
 * autoplays. Light and dark colour schemes are both covered.
 *
 * Chromium runs 360/390/768/1280/1440 px; other browsers run their project
 * viewport (1280 in playwright.visual.config.ts). Fixtures are DEV FIXTURE data
 * created per run (tests/visual/fixtures.ts), so the spec runs on any LOCAL stack.
 */

const QA_WIDTHS = [360, 390, 768, 1280, 1440] as const
const HEIGHT: Record<number, number> = {
  360: 740,
  390: 844,
  768: 1024,
  1280: 800,
  1440: 900,
}
const PHONE_MAX = 480
const MIN_TOUCH = 44

test.skip(
  !process.env.NABALENS_VISUAL,
  "Visual pass runs with `pnpm test:visual <workdir>` (production build)."
)

const db = serviceClient()
let fx: VisualFixtures

// Seed once per `playwright test` run: workers restart after a failing test and
// per project, and they share the runner as parent process.
const fixtureCache = join(
  tmpdir(),
  `nabalens-visual-fixtures-${createHash("sha1")
    .update(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "")
    .digest("hex")
    .slice(0, 8)}-${process.ppid}.json`
)

test.beforeAll(async () => {
  test.setTimeout(180_000)
  if (existsSync(fixtureCache)) {
    fx = JSON.parse(readFileSync(fixtureCache, "utf8"))
    return
  }
  fx = await seedVisualFixtures()
  writeFileSync(fixtureCache, JSON.stringify(fx))
})

function widthsFor(page: Page, browserName: string): number[] {
  if (browserName === "chromium") return [...QA_WIDTHS]
  return [page.viewportSize()?.width ?? 1280]
}

async function signIn(browser: Browser, email: string, baseURL: string) {
  // The local auth server times out ("please retry") when several stacks share
  // this machine. Retry only errors auth-js marks retryable, in this fixture
  // step (as tests/e2e/slice.spec.ts does); no assertion is ever retried.
  let link = await db.auth.admin.generateLink({ type: "magiclink", email })
  for (
    let i = 0;
    link.error?.name === "AuthRetryableFetchError" && i < 3;
    i++
  ) {
    await new Promise((resolve) => setTimeout(resolve, 2000))
    link = await db.auth.admin.generateLink({ type: "magiclink", email })
  }
  const { data, error } = link
  if (error) throw error
  const context = await browser.newContext({ baseURL })
  const page = await context.newPage()
  await page.goto(
    `/auth/confirm?token_hash=${data.properties.hashed_token}&type=email`
  )
  return page
}

/** Waits until visible images are decoded and fonts are ready. */
async function settle(page: Page) {
  await page.waitForLoadState("domcontentloaded")
  await page.evaluate(async () => {
    await document.fonts.ready
    const pending = Array.from(document.images).filter((img) => {
      const r = img.getBoundingClientRect()
      return !img.complete && r.height > 0 && r.top < window.innerHeight
    })
    const loaded = (img: HTMLImageElement) =>
      new Promise<void>((resolve) => {
        img.addEventListener("load", () => resolve(), { once: true })
        img.addEventListener("error", () => resolve(), { once: true })
      })
    await Promise.race([
      Promise.all(pending.map(loaded)),
      new Promise((resolve) => setTimeout(resolve, 5000)),
    ])
  })
  // Dialog open/close animations are 100–200 ms.
  await page.waitForTimeout(250)
}

type Offender = { what: string; detail: string }

/** Elements that stick out of the viewport horizontally, and page overflow. */
async function horizontalOverflow(page: Page): Promise<Offender[]> {
  return page.evaluate(() => {
    const vw = document.documentElement.clientWidth
    const out: { what: string; detail: string }[] = []
    if (document.documentElement.scrollWidth > vw + 1) {
      out.push({
        what: "document",
        detail: `scrollWidth ${document.documentElement.scrollWidth} > ${vw}`,
      })
    }
    for (const el of Array.from(document.body.querySelectorAll("*"))) {
      const style = getComputedStyle(el)
      if (style.visibility === "hidden" || style.display === "none") continue
      const rect = el.getBoundingClientRect()
      if (rect.width === 0 || rect.height === 0) continue
      // Clipped by an ancestor that scrolls or hides overflow? Then it is fine.
      let clipped = false
      for (let p = el.parentElement; p; p = p.parentElement) {
        const ps = getComputedStyle(p)
        if (/(hidden|auto|scroll|clip)/.test(ps.overflowX)) {
          const pr = p.getBoundingClientRect()
          if (pr.right <= vw + 1 && pr.left >= -1) clipped = true
          break
        }
      }
      if (clipped) continue
      if (rect.right > vw + 1 || rect.left < -1) {
        const name =
          el.tagName.toLowerCase() +
          (el.id ? `#${el.id}` : "") +
          (typeof el.className === "string"
            ? "." + el.className.split(/\s+/).slice(0, 3).join(".")
            : "")
        out.push({
          what: name,
          detail: `left ${Math.round(rect.left)} right ${Math.round(rect.right)} > ${vw}: "${(el.textContent ?? "").trim().slice(0, 40)}"`,
        })
      }
    }
    return out.slice(0, 10)
  })
}

/** Visible interactive controls smaller than 44 × 44 CSS px. */
async function smallTouchTargets(page: Page): Promise<Offender[]> {
  return page.evaluate((min) => {
    const selector = [
      "button",
      "a[href]",
      "input:not([type=hidden])",
      "select",
      "textarea",
      "[role=button]",
      "[role=combobox]",
      "[role=menuitem]",
      "[role=option]",
      "[role=radio]",
      "[role=switch]",
      "[role=checkbox]",
      "[role=tab]",
    ].join(",")
    // Inside an open modal only the modal is reachable.
    const modal = document.querySelector(
      "[role=dialog][data-open], [role=alertdialog][data-open], [role=menu][data-open], [role=listbox][data-open]"
    )
    const scope = modal ?? document.body
    const out: { what: string; detail: string }[] = []
    for (const el of Array.from(
      scope.querySelectorAll<HTMLElement>(selector)
    )) {
      const rect = el.getBoundingClientRect()
      if (rect.width <= 1 || rect.height <= 1) continue // sr-only inputs
      const style = getComputedStyle(el)
      if (style.visibility === "hidden" || style.pointerEvents === "none")
        continue
      if (el.closest("[aria-hidden=true], [inert]")) continue
      // Skip link is visible only on keyboard focus.
      if (el.getAttribute("href") === "#main") continue
      // An absolutely positioned ::after with negative insets extends the hit area.
      let { width, height } = rect
      const after = getComputedStyle(el, "::after")
      if (after.content !== "none" && after.position === "absolute") {
        const px = (v: string) => (v.endsWith("px") ? parseFloat(v) : 0)
        width = Math.max(width, width - px(after.left) - px(after.right))
        height = Math.max(height, height - px(after.top) - px(after.bottom))
      }
      if (width + 0.5 < min || height + 0.5 < min) {
        const label =
          el.getAttribute("aria-label") ||
          (el.textContent ?? "").trim().slice(0, 40) ||
          el.tagName.toLowerCase()
        out.push({
          what: label,
          detail: `${Math.round(rect.width)}×${Math.round(rect.height)}`,
        })
      }
    }
    return out
  }, MIN_TOUCH)
}

async function axeSerious(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags([
      "wcag2a",
      "wcag2aa",
      "wcag21a",
      "wcag21aa",
      "wcag22aa",
      "best-practice",
    ])
    .analyze()
  return results.violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => ({
      what: `${v.id} (${v.impact})`,
      detail: v.nodes
        .slice(0, 3)
        .map(
          (n) =>
            `${n.target.join(" ")}: ${n.failureSummary?.split("\n")[1] ?? ""}`
        )
        .join(" | "),
    }))
}

function shotDir(testInfo: TestInfo) {
  const dir = join(
    process.cwd(),
    ".artifacts/screenshots/visual",
    testInfo.project.name
  )
  mkdirSync(dir, { recursive: true })
  return dir
}

type CaptureOptions = {
  /** Default: every width for this browser. */
  widths?: number[]
  /** Re-run after the viewport changes, e.g. to re-open a closed popup. */
  restore?: () => Promise<void>
}

/**
 * Screenshot + axe + overflow (+ touch targets on phones) for the current state
 * at each width. Failures are soft so one run reports every defect.
 */
async function capture(
  page: Page,
  testInfo: TestInfo,
  name: string,
  options: CaptureOptions = {}
) {
  const widths =
    options.widths ??
    widthsFor(page, testInfo.project.use.browserName ?? "chromium")
  const scheme = (await page.evaluate(() =>
    document.documentElement.classList.contains("dark") ? "dark" : "light"
  )) as string
  for (const width of widths) {
    await page.setViewportSize({ width, height: HEIGHT[width] ?? 800 })
    if (options.restore) await options.restore()
    await settle(page)
    const label = `${name}-${scheme}-${width}`
    await page.screenshot({
      path: join(shotDir(testInfo), `${label}.png`),
      fullPage: true,
    })
    const overflow = await horizontalOverflow(page)
    expect.soft(overflow, `${label}: horizontal overflow`).toEqual([])
    if (width <= PHONE_MAX) {
      const small = await smallTouchTargets(page)
      expect.soft(small, `${label}: touch targets < 44px`).toEqual([])
    }
    const axe = await axeSerious(page)
    expect.soft(axe, `${label}: axe serious/critical`).toEqual([])
  }
}

/**
 * Tabs through the page and reports tab stops without a visible focus
 * indicator (outline or box-shadow ring).
 */
async function focusWalk(page: Page, maxStops = 40) {
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.evaluate(() => {
    ;(document.activeElement as HTMLElement | null)?.blur()
    window.scrollTo(0, 0)
  })
  await page.locator("body").focus()
  const missing: Offender[] = []
  const seen = new Set<string>()
  for (let i = 0; i < maxStops; i++) {
    await page.keyboard.press("Tab")
    await page.waitForTimeout(120) // let ring transitions finish
    const info = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null
      if (!el || el === document.body) return null
      const s = getComputedStyle(el)
      const outline =
        s.outlineStyle !== "none" && parseFloat(s.outlineWidth) > 0
      const ring = s.boxShadow !== "none" && s.boxShadow !== ""
      const key =
        el.tagName +
        (el.getAttribute("aria-label") ?? el.textContent ?? "").slice(0, 60) +
        el.getBoundingClientRect().top
      return {
        key,
        visible: outline || ring,
        label:
          el.getAttribute("aria-label") ||
          (el.textContent ?? "").trim().slice(0, 40) ||
          el.tagName.toLowerCase(),
      }
    })
    if (!info) break
    if (seen.has(info.key)) break
    seen.add(info.key)
    if (!info.visible)
      missing.push({ what: info.label, detail: "no focus indicator" })
  }
  return { stops: seen.size, missing }
}

async function expectFocusVisibleEverywhere(page: Page, label: string) {
  const { stops, missing } = await focusWalk(page)
  expect.soft(stops, `${label}: tab stops`).toBeGreaterThan(0)
  expect.soft(missing, `${label}: focus indicators`).toEqual([])
}

async function activeElementMatches(page: Page, target: Locator) {
  const handle = await target.elementHandle()
  return page.evaluate((el) => document.activeElement === el, handle)
}

async function useDark(page: Page) {
  await page.emulateMedia({ colorScheme: "dark" })
  await page.reload()
  await expect(page.locator("html")).toHaveClass(/dark/)
}

async function useLight(page: Page) {
  await page.emulateMedia({ colorScheme: "light" })
  await page.reload()
  await expect(page.locator("html")).not.toHaveClass(/dark/)
}

/** The previewed image keeps its aspect ratio and fits inside the viewport. */
async function expectWholeImage(page: Page, label: string) {
  const img = page.getByRole("dialog").locator("img").first()
  await expect(img).toBeVisible()
  await img.evaluate((el: HTMLImageElement) =>
    el.complete ? null : new Promise((r) => (el.onload = r))
  )
  const box = await img.evaluate((el: HTMLImageElement) => {
    const r = el.getBoundingClientRect()
    return {
      ratio: r.width / r.height,
      natural: el.naturalWidth / el.naturalHeight,
      fit: el.style.objectFit || getComputedStyle(el).objectFit,
      inside:
        r.left >= -1 &&
        r.right <= document.documentElement.clientWidth + 1 &&
        r.top >= -1 &&
        r.bottom <= window.innerHeight + 1,
    }
  })
  expect
    .soft(
      Math.abs(box.ratio - box.natural) / box.natural < 0.03 ||
        box.fit === "contain",
      `${label}: viewer image is not cropped (${JSON.stringify(box)})`
    )
    .toBe(true)
  expect.soft(box.inside, `${label}: viewer image fits the viewport`).toBe(true)
}

async function tile(page: Page, filename: string) {
  return page.getByRole("button", {
    name: new RegExp(filename.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
  })
}

// ---------------------------------------------------------------------------

test("login: idle, validation error, sent, expired link, signed out", async ({
  page,
}, testInfo) => {
  await page.goto("/login")
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible()
  await capture(page, testInfo, "login")
  await expectFocusVisibleEverywhere(page, "login")

  await page.getByRole("button", { name: "Send sign-in link" }).click()
  await expect(page.getByText("Enter the email address")).toBeVisible()
  await expect(page.getByLabel("Email")).toHaveAttribute("aria-invalid", "true")
  await capture(page, testInfo, "login-error")

  await page
    .getByLabel("Email")
    .fill(`visual-unknown-${fx.suffix}@nabalens.test`)
  await page.getByRole("button", { name: "Send sign-in link" }).click()
  // The server action waits on the local auth server, which is slow under load.
  await expect(
    page.getByRole("heading", { name: "Check your email" })
  ).toBeVisible({ timeout: 30_000 })
  await capture(page, testInfo, "login-sent")

  await page.goto("/login?error=link_invalid")
  await expect(page.getByText("That sign-in link has expired")).toBeVisible()
  await capture(page, testInfo, "login-expired")

  await page.goto("/login?signed_out=1")
  await expect(page.getByText("You have signed out.")).toBeVisible()
  await capture(page, testInfo, "login-signed-out")

  await useDark(page)
  await capture(page, testInfo, "login-signed-out")
})

test("blocked: deactivated account", async ({ browser, baseURL }, testInfo) => {
  const page = await signIn(browser, fx.inactive.email, baseURL!)
  await expect(page).toHaveURL(/\/auth\/blocked/)
  await expect(
    page.getByRole("heading", { name: "Account unavailable" })
  ).toBeVisible()
  await capture(page, testInfo, "blocked")
  await expectFocusVisibleEverywhere(page, "blocked")
  await useDark(page)
  await capture(page, testInfo, "blocked", { widths: [390, 1280] })
  await page.context().close()
})

test("staff: empty portfolio", async ({ browser, baseURL }, testInfo) => {
  const page = await signIn(browser, fx.empty.email, baseURL!)
  await expect(page).toHaveURL(/\/staff$/)
  await expect(page.getByText("Your portfolio starts here")).toBeVisible()
  await capture(page, testInfo, "staff-empty")
  await expectFocusVisibleEverywhere(page, "staff-empty")
  await page.context().close()
})

test("staff: upload dialog states and focus return", async ({
  browser,
  baseURL,
}, testInfo) => {
  // A separate account, so the upload never fills the empty portfolio above.
  const page = await signIn(browser, fx.uploader.email, baseURL!)
  await expect(page).toHaveURL(/\/staff$/)

  // Open by keyboard so focus return is meaningful.
  const uploadButton = page
    .getByRole("button", { name: "Upload photos or videos" })
    .first()
  await uploadButton.focus()
  await page.keyboard.press("Enter")
  const dialog = page.getByRole("dialog", { name: "Upload photos or videos" })
  await expect(dialog).toBeVisible()
  await capture(page, testInfo, "upload-dialog")

  // A valid photo plus a rejected file.
  const dir = await mkdtemp(join(tmpdir(), "nabalens-visual-"))
  const jpg = join(
    dir,
    "staff-meal-with-a-rather-long-filename-from-a-phone.jpg"
  )
  await writeFile(
    jpg,
    await sharp({
      create: { width: 800, height: 600, channels: 3, background: "#b85a28" },
    })
      .jpeg()
      .toBuffer()
  )
  const txt = join(dir, "notes.txt")
  await writeFile(txt, "not media")
  await dialog.locator("input[type=file][multiple]").setInputFiles([jpg, txt])
  await expect(dialog.getByText("1 file was not added")).toBeVisible()
  await capture(page, testInfo, "upload-selected")

  // Hold the storage transfer so the uploading state is visible, then fail
  // it (and every retry). One handler: unroute() would let held requests through.
  let release: () => void = () => {}
  const held = new Promise<void>((r) => (release = r))
  await page.route("**/storage/v1/**", async (route) => {
    await held
    await route.abort("failed")
  })
  await dialog.getByRole("button", { name: /^Upload 1 file$/ }).click()
  await expect(dialog.getByText(/Uploading \d+%/)).toBeVisible({
    timeout: 30_000,
  })
  await capture(page, testInfo, "upload-uploading")

  release()
  await expect(
    dialog.getByRole("button", { name: /^Retry staff-meal/ })
  ).toBeVisible({ timeout: 90_000 })
  await capture(page, testInfo, "upload-failed")

  await page.keyboard.press("Escape")
  await expect(dialog).toBeHidden()
  await page.waitForTimeout(300)
  expect
    .soft(
      await activeElementMatches(
        page,
        page.getByRole("button", { name: "Upload photos or videos" }).first()
      ),
      "focus returns to the Upload button after the upload dialog closes"
    )
    .toBe(true)
  await page.context().close()
})

const some = (page: Page, testInfo: TestInfo, wanted: number[]) =>
  widthsFor(page, testInfo.project.use.browserName ?? "chromium").filter((w) =>
    wanted.includes(w)
  )

/** Re-opens a popup after each resize (popups close when the viewport changes). */
function reopen(page: Page, trigger: Locator, popup: Locator) {
  return async () => {
    if (await popup.isVisible()) {
      await page.keyboard.press("Escape")
      await expect(popup).toBeHidden()
    }
    await trigger.click()
    await expect(popup).toBeVisible()
  }
}

async function populatedStaff(browser: Browser, baseURL: string) {
  const page = await signIn(browser, fx.populated.email, baseURL)
  await expect(page).toHaveURL(/\/staff$/)
  await expect(page.getByRole("list", { name: "Your portfolio" })).toBeVisible()
  return page
}

test("staff: populated portfolio and photo viewer", async ({
  browser,
  baseURL,
}, testInfo) => {
  const page = await populatedStaff(browser, baseURL!)
  await capture(page, testInfo, "staff-populated")
  await expectFocusVisibleEverywhere(page, "staff-populated")

  // Viewer: every photo shows whole, in every width; focus returns to the tile.
  for (const name of [
    "landscape-dish.jpg",
    "portrait-plating.jpg",
    "panorama-dining-room.jpg",
  ]) {
    const opener = await tile(page, name)
    await opener.focus()
    await page.keyboard.press("Enter")
    await expect(page.getByRole("dialog")).toBeVisible()
    for (const width of widthsFor(
      page,
      testInfo.project.use.browserName ?? "chromium"
    )) {
      await page.setViewportSize({ width, height: HEIGHT[width] ?? 800 })
      await settle(page)
      await expectWholeImage(page, `${name} @${width}`)
    }
    if (name === "portrait-plating.jpg") {
      await capture(page, testInfo, "viewer-photo-portrait")
    }
    if (name === "panorama-dining-room.jpg") {
      await capture(page, testInfo, "viewer-photo-panorama", {
        widths: some(page, testInfo, [360, 1280]),
      })
    }
    await page.keyboard.press("Escape")
    await expect(page.getByRole("dialog")).toBeHidden()
    await page.waitForTimeout(300)
    expect
      .soft(
        await activeElementMatches(page, opener),
        `focus returns to the ${name} tile`
      )
      .toBe(true)
  }
  await page.context().close()
})

test("staff: video and non-ready viewer states", async ({
  browser,
  baseURL,
}, testInfo) => {
  const page = await populatedStaff(browser, baseURL!)
  // Video: controls, no autoplay.
  await (await tile(page, "kitchen-pass.mp4")).click()
  const video = page.getByRole("dialog").locator("video")
  await expect(video).toBeVisible()
  expect(await video.evaluate((v: HTMLVideoElement) => v.autoplay)).toBe(false)
  expect(await video.evaluate((v: HTMLVideoElement) => v.controls)).toBe(true)
  await capture(page, testInfo, "viewer-video")
  await page.keyboard.press("Escape")
  await expect(page.getByRole("dialog")).toBeHidden()

  // Non-ready states explain themselves.
  for (const [name, text] of [
    ["failed-upload.mov", "could not be processed"],
    ["still-processing.jpg", "Still processing"],
  ] as const) {
    await (await tile(page, name)).click()
    await expect(page.getByRole("dialog").getByText(text)).toBeVisible()
    await capture(page, testInfo, `viewer-${name.split(".")[0]}`, {
      widths: some(page, testInfo, [390, 1280]),
    })
    await page.keyboard.press("Escape")
    await expect(page.getByRole("dialog")).toBeHidden()
  }
  await page.context().close()
})

test("staff: delete confirmation and edit profile", async ({
  browser,
  baseURL,
}, testInfo) => {
  const page = await populatedStaff(browser, baseURL!)
  // Long filename in the viewer, then delete confirmation and keep.
  await (await tile(page, "IMG_20261030_dessert")).click()
  const viewer = page.getByRole("dialog")
  await expect(viewer).toBeVisible()
  await capture(page, testInfo, "viewer-photo-long-filename")
  const deleteButton = viewer.getByRole("button", { name: "Delete" })
  await deleteButton.focus()
  await page.keyboard.press("Enter")
  const confirm = page.getByRole("alertdialog")
  await expect(confirm).toBeVisible()
  await expect(confirm).toContainText(
    "Previously downloaded copies cannot be recalled"
  )
  await capture(page, testInfo, "delete-confirm")
  await confirm.getByRole("button", { name: "Keep file" }).click()
  await expect(confirm).toBeHidden()
  await page.waitForTimeout(300)
  expect
    .soft(
      await activeElementMatches(
        page,
        page.getByRole("dialog").getByRole("button", { name: "Delete" })
      ),
      "focus returns to Delete after keeping the file"
    )
    .toBe(true)
  await page.keyboard.press("Escape")
  await expect(page.getByRole("dialog")).toBeHidden()

  // Edit profile: open, validation error, close.
  const edit = page.getByRole("button", { name: "Edit profile" })
  await edit.focus()
  await page.keyboard.press("Enter")
  const editDialog = page.getByRole("dialog", { name: "Edit profile" })
  await expect(editDialog).toBeVisible()
  await capture(page, testInfo, "edit-profile")
  // An empty name cannot be submitted: Save is disabled, not silently ignored.
  await editDialog.getByLabel("Display name").fill("")
  await expect(
    editDialog.getByRole("button", { name: "Save changes" })
  ).toBeDisabled()
  await capture(page, testInfo, "edit-profile-empty-name")
  await page.keyboard.press("Escape")
  await expect(editDialog).toBeHidden()
  await page.waitForTimeout(300)
  expect
    .soft(
      await activeElementMatches(page, edit),
      "focus returns to Edit profile"
    )
    .toBe(true)
  await page.context().close()
})

test("staff: dark mode portfolio, viewer, upload dialog", async ({
  browser,
  baseURL,
}, testInfo) => {
  const page = await populatedStaff(browser, baseURL!)
  await useDark(page)
  await capture(page, testInfo, "staff-populated")
  await (await tile(page, "landscape-dish.jpg")).click()
  await expect(page.getByRole("dialog")).toBeVisible()
  await capture(page, testInfo, "viewer-photo-landscape", {
    widths: some(page, testInfo, [390, 1280]),
  })
  await page.keyboard.press("Escape")
  await expect(page.getByRole("dialog")).toBeHidden()
  await page.getByRole("button", { name: "Upload photos or videos" }).click()
  await expect(page.getByRole("dialog")).toBeVisible()
  await capture(page, testInfo, "upload-dialog", {
    widths: some(page, testInfo, [390, 1280]),
  })
  await page.context().close()
})

test("staff: long name and paused venue", async ({
  browser,
  baseURL,
}, testInfo) => {
  const long = await signIn(browser, fx.longName.email, baseURL!)
  await expect(long).toHaveURL(/\/staff$/)
  await capture(long, testInfo, "staff-long-name")
  await long.getByRole("button", { name: "Edit profile" }).click()
  await capture(long, testInfo, "edit-profile-long-name", {
    widths: [360, 1280].filter((w) =>
      widthsFor(long, testInfo.project.use.browserName ?? "chromium").includes(
        w
      )
    ),
  })
  await long.context().close()

  const paused = await signIn(browser, fx.pausedVenue.email, baseURL!)
  await expect(paused).toHaveURL(/\/staff$/)
  await expect(paused.getByText("uploads are paused")).toBeVisible()
  await expect(
    paused.getByRole("button", { name: "Upload photos or videos" })
  ).toHaveCount(0)
  await capture(paused, testInfo, "staff-paused-venue")
  await paused.context().close()
})

test("admin: library and filters", async ({ browser, baseURL }, testInfo) => {
  const page = await signIn(browser, fx.admin.email, baseURL!)
  await expect(page).toHaveURL(/\/admin$/)
  await expect(page.getByRole("list", { name: "Library" })).toBeVisible()
  await capture(page, testInfo, "admin-library")
  await expectFocusVisibleEverywhere(page, "admin-library")

  // Venue select open (popup listbox).
  const venueSelect = page.getByRole("combobox", { name: "Venue" })
  await capture(page, testInfo, "admin-filter-venue-open", {
    widths: some(page, testInfo, [360, 768, 1280]),
    restore: reopen(page, venueSelect, page.getByRole("listbox")),
  })
  await page.getByRole("option", { name: fx.venue.name }).click()
  await expect(page).toHaveURL(/venue=/)
  await page.getByRole("button", { name: "Videos" }).click()
  await expect(page).toHaveURL(/type=video/)
  await expect(
    page.getByRole("button", { name: /kitchen-pass\.mp4/ })
  ).toBeVisible()
  await capture(page, testInfo, "admin-filtered")

  // Staff member with no uploads: empty filter result, then clear.
  await page.goto(`/admin?staff=${fx.empty.id}`)
  await expect(page.getByText("Nothing matches these filters.")).toBeVisible()
  await capture(page, testInfo, "admin-filter-empty")
  await page.getByRole("button", { name: "Clear filters" }).click()
  await expect(page).toHaveURL(/\/admin$/)
  await page.context().close()
})

test("admin: viewer, download, dark mode", async ({
  browser,
  baseURL,
}, testInfo) => {
  const page = await signIn(browser, fx.admin.email, baseURL!)
  // Viewer with admin actions; download is an attachment of the original.
  await page.goto(`/admin?staff=${fx.populated.id}`)
  const opener = await tile(page, "landscape-dish.jpg")
  await opener.focus()
  await page.keyboard.press("Enter")
  const viewer = page.getByRole("dialog")
  await expect(
    viewer.getByRole("link", { name: "Download original" })
  ).toBeVisible()
  await capture(page, testInfo, "admin-viewer")
  await expectWholeImage(page, "admin viewer")
  const href = await viewer
    .getByRole("link", { name: "Download original" })
    .getAttribute("href")
  const response = await page.request.get(href!)
  expect(response.status()).toBe(200)
  expect(response.headers()["content-disposition"]).toMatch(/^attachment/)
  await page.keyboard.press("Escape")
  await expect(viewer).toBeHidden()
  await page.waitForTimeout(300)
  expect
    .soft(
      await activeElementMatches(page, opener),
      "admin: focus returns to the tile"
    )
    .toBe(true)

  await useDark(page)
  await capture(page, testInfo, "admin-library-filtered")
  await capture(page, testInfo, "admin-filter-staff-open", {
    widths: some(page, testInfo, [390, 1280]),
    restore: reopen(
      page,
      page.getByRole("combobox", { name: "Staff member" }),
      page.getByRole("listbox")
    ),
  })
  await page.context().close()
})

test("admin: staff directory and invite", async ({
  browser,
  baseURL,
}, testInfo) => {
  const page = await signIn(browser, fx.admin.email, baseURL!)
  await page.goto("/admin/staff")
  await expect(page.getByRole("heading", { name: "Staff" })).toBeVisible()
  await capture(page, testInfo, "admin-staff")
  await expectFocusVisibleEverywhere(page, "admin-staff")

  // Invite: open, validation errors, existing email.
  const invite = page.getByRole("button", { name: "Invite staff" })
  await invite.focus()
  await page.keyboard.press("Enter")
  const inviteDialog = page.getByRole("dialog", { name: "Invite staff" })
  await expect(inviteDialog).toBeVisible()
  await capture(page, testInfo, "invite")
  await inviteDialog.getByRole("button", { name: "Send invitation" }).click()
  await expect(inviteDialog.getByText("Enter their name.")).toBeVisible()
  await capture(page, testInfo, "invite-errors")
  await inviteDialog.getByLabel("Name").fill("DEV FIXTURE Existing Person")
  await inviteDialog.getByLabel("Email").fill(fx.populated.email)
  await inviteDialog.getByRole("combobox", { name: "Venue" }).click()
  await page.getByRole("option", { name: fx.venue.name }).click()
  await inviteDialog.getByRole("button", { name: "Send invitation" }).click()
  await expect(
    inviteDialog
      .getByRole("alert")
      .filter({ hasText: "already has an account" })
  ).toBeVisible({
    timeout: 30_000,
  })
  await capture(page, testInfo, "invite-existing-email")
  await page.keyboard.press("Escape")
  await expect(inviteDialog).toBeHidden()
  await page.waitForTimeout(300)
  expect
    .soft(
      await activeElementMatches(page, invite),
      "focus returns to Invite staff"
    )
    .toBe(true)

  await useDark(page)
  await capture(page, testInfo, "admin-staff", {
    widths: some(page, testInfo, [390, 1280]),
  })
  await page.context().close()
})

test("admin: row actions, edit, deactivate confirm", async ({
  browser,
  baseURL,
}, testInfo) => {
  const page = await signIn(browser, fx.admin.email, baseURL!)
  await page.goto("/admin/staff")
  const more = page
    .getByRole("button", { name: `More actions for ${fx.longName.name}` })
    .locator("visible=true")
    .first()
  await capture(page, testInfo, "admin-staff-menu", {
    restore: reopen(page, more, page.getByRole("menu")),
  })
  await page.getByRole("menuitem", { name: "Edit details" }).click()
  const editDialog = page.getByRole("dialog", { name: "Edit staff account" })
  await expect(editDialog).toBeVisible()
  await capture(page, testInfo, "admin-edit-staff")
  await page.keyboard.press("Escape")
  await expect(editDialog).toBeHidden()

  await more.click()
  await page.getByRole("menuitem", { name: "Deactivate" }).click()
  const confirm = page.getByRole("alertdialog")
  await expect(confirm).toBeVisible()
  await capture(page, testInfo, "admin-deactivate-confirm")
  await confirm.getByRole("button", { name: "Cancel" }).click()
  await expect(confirm).toBeHidden()
  await page.context().close()
})

test("admin: individual portfolios", async ({ browser, baseURL }, testInfo) => {
  const page = await signIn(browser, fx.admin.email, baseURL!)
  for (const [who, label] of [
    [fx.populated, "admin-portfolio"],
    [fx.longName, "admin-portfolio-long-name"],
    [fx.empty, "admin-portfolio-empty"],
  ] as const) {
    await page.goto(`/admin/staff/${who.id}`)
    await expect(page.getByRole("heading", { name: who.name })).toBeVisible()
    await capture(page, testInfo, label)
  }
  await expectFocusVisibleEverywhere(page, "admin-portfolio-empty")

  await useDark(page)
  await page.goto(`/admin/staff/${fx.populated.id}`)
  await capture(page, testInfo, "admin-portfolio", {
    widths: some(page, testInfo, [390, 1280]),
  })
  await page.context().close()
})
