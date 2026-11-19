import { expect, test, type Locator, type Page } from "@playwright/test"

import { syntheticJpeg } from "./helpers/media"
import {
  adminPages,
  managerPages,
  provisionManagedWorld,
  staffPages,
  type ManagedWorld,
} from "./helpers/managed-world"
import { horizontalOverflow } from "./helpers/overflow"
import { signedInPage } from "./helpers/world"

/**
 * Reflow (WCAG 1.4.10) and forced colours on the main staff, manager and admin
 * pages and one dialog per area. 1280×800 at 200% zoom lays a page out in a
 * 640×400 CSS px viewport, which is what is set here: Chromium's browser zoom
 * is not reachable from Playwright, and CSS `zoom` on the root would not move
 * the md breakpoint the way real zoom does. Each overflow failure names the
 * element or text sticking out furthest.
 *
 * Forced colours drop backgrounds and box-shadows, so a primary button, a
 * StatusChip, the TabBar, a selected segment and the focus ring each need a
 * border, outline or underline to stay visible.
 */

const SIZES = [
  { name: "320", width: 320, height: 640 },
  { name: "1280@200%", width: 640, height: 400 },
] as const

test.skip(({ browserName }) => browserName !== "chromium", "Chromium only")
test.describe.configure({ mode: "serial" })

let m: ManagedWorld
let staff: Page
let manager: Page
let admin: Page
let anon: Page

test.beforeAll(async ({ browser }) => {
  test.setTimeout(240_000)
  m = await provisionManagedWorld("reflow")
  staff = await signedInPage(browser, m.world.staffA)
  manager = await signedInPage(browser, m.world.manager)
  admin = await signedInPage(browser, m.world.admin)
  anon = await (await browser.newContext()).newPage()
})

test.afterAll(async () => {
  await staff?.context().close()
  await manager?.context().close()
  await admin?.context().close()
  await anon?.context().close()
})

async function settle(page: Page) {
  await page.waitForFunction(() =>
    document.getAnimations().every((a) => a.playState !== "running")
  )
}

async function noOverflow(page: Page, label: string) {
  await settle(page)
  const { overflowPx, culprit } = await horizontalOverflow(page)
  expect.soft(overflowPx, `${label}: horizontal overflow (${culprit})`).toBe(0)
}

async function reflow(page: Page, size: (typeof SIZES)[number], path: string) {
  await page.setViewportSize({ width: size.width, height: size.height })
  const res = await page.goto(path)
  expect(res?.status(), `${path} status`).toBeLessThan(400)
  // A redirect (to /login, say) would still show an h1, so pin the page.
  await expect(page).toHaveURL((url) => url.pathname === path)
  await expect(page.locator("h1").first()).toBeVisible()
  await noOverflow(page, `${path}@${size.name}`)
}

async function dialogReflows(
  page: Page,
  size: (typeof SIZES)[number],
  label: string,
  open: () => Promise<void>,
  dialog: Locator
) {
  await open()
  await expect(dialog).toBeVisible()
  await noOverflow(page, `${label} dialog@${size.name}`)
  await page.keyboard.press("Escape")
  await expect(dialog).toBeHidden()
}

for (const size of SIZES) {
  test(`sign-in reflows at ${size.name}`, async () => {
    await reflow(anon, size, "/login")
  })

  test(`staff pages, Add and Match reflow at ${size.name}`, async () => {
    for (const path of staffPages(m)) await reflow(staff, size, path)
    // My photos' Add a video: the upload sheet (DESIGN.md §5e).
    await reflow(staff, size, "/staff/photos")
    await dialogReflows(
      staff,
      size,
      "Upload sheet",
      () =>
        staff
          .getByRole("main")
          .getByRole("button", { name: "Add a video" })
          .first()
          .click(),
      staff.getByRole("dialog", { name: "Add photos or videos" })
    )
    await reflow(staff, size, "/staff/tasks/guide")
    await dialogReflows(
      staff,
      size,
      "Photo guide viewer",
      () =>
        staff.getByRole("button", { name: "45° angle. Open example" }).click(),
      staff.getByRole("dialog", { name: "45° angle" })
    )
    // Add: the phone's photos, then Match (DESIGN.md §6.1).
    await reflow(staff, size, "/staff/album")
    const photo = await syntheticJpeg(`reflow-${size.name}-${Date.now()}.jpg`)
    const tab = staff
      .locator('[data-slot="tabbar"], header')
      .getByRole("button", { name: /^Add photos/ })
      .filter({ visible: true })
      .first()
    const chooser = staff.waitForEvent("filechooser")
    await tab.click()
    await (await chooser).setFiles(photo.path)
    await dialogReflows(
      staff,
      size,
      "Match",
      async () => undefined,
      staff.getByRole("dialog", { name: /^Photo 1 of 1$/ })
    )
    // Closing sent it to Match later; let it finish before the next size
    // navigates (a running upload holds navigation at the leave guard).
    await expect(tab).toHaveAccessibleName("Add photos", { timeout: 60_000 })
  })

  // The /manager workspace (decision D3) has no checklist screen, so the
  // old Add a checklist item dialog is gone with it.
  test(`manager pages reflow at ${size.name}`, async () => {
    for (const path of managerPages(m)) await reflow(manager, size, path)
  })

  test(`admin pages and Invite staff reflow at ${size.name}`, async () => {
    for (const path of adminPages(m)) await reflow(admin, size, path)
    await reflow(admin, size, "/admin/staff")
    await dialogReflows(
      admin,
      size,
      "Invite staff",
      () => admin.getByRole("button", { name: "Invite staff" }).first().click(),
      admin.getByRole("dialog", { name: "Invite staff" })
    )
  })
}

/**
 * Every staff target is 48px or more at every width (DESIGN.md §8, §11 rule
 * 6; V2-4): v2's 40px compact size is only for manager and admin shells, so
 * a staff page at a phone and a touch laptop (1366, past bp-desktop) has no
 * visible control under 48px tall. Each failure names the control. Skipped:
 * visually hidden inputs (their label is the target), focus guards and the
 * skip link (sr-only until focused).
 */
async function smallTargets(page: Page) {
  await settle(page)
  return page.evaluate(() => {
    const sel = [
      "a[href]",
      "button",
      "input:not([type=hidden])",
      "select",
      "textarea",
      "summary",
      "[role=button]",
      "[role=link]",
      "[role=tab]",
      "[role=checkbox]",
      "[role=radio]",
      "[role=switch]",
      '[tabindex]:not([tabindex="-1"])',
    ].join(",")
    const out: string[] = []
    for (const el of Array.from(document.querySelectorAll<HTMLElement>(sel))) {
      if (el.closest("[aria-hidden=true], [inert], .sr-only")) continue
      const r = el.getBoundingClientRect()
      if (r.width <= 1 || r.height <= 1) continue
      const s = getComputedStyle(el)
      if (s.visibility === "hidden" || s.display === "none") continue
      // A visually hidden radio or checkbox: its label is the target.
      const target =
        el.offsetWidth <= 1 ? (el.closest("label") ?? el) : (el as Element)
      const box = target.getBoundingClientRect()
      if (Math.round(box.height) < 48)
        out.push(
          `${target.tagName.toLowerCase()}${target.getAttribute("data-slot") ? `[data-slot=${target.getAttribute("data-slot")}]` : ""} "${(target.textContent || target.getAttribute("aria-label") || "").trim().slice(0, 30)}" ${Math.round(box.width)}x${Math.round(box.height)}`
        )
    }
    return out
  })
}

test("staff targets are 48px at 390 and 1366 (review Z1)", async () => {
  test.setTimeout(240_000)
  let measured = 0
  // Album's place lens (DESIGN.md §5d): the first place Album links to.
  await staff.setViewportSize({ width: 390, height: 844 })
  await staff.goto("/staff/album")
  const place = await staff
    .locator('main a[href^="/staff/album?place="]')
    .first()
    .getAttribute("href", { timeout: 2_000 })
    .catch(() => null)
  const paths = [...staffPages(m), ...(place ? [place] : [])]
  for (const width of [390, 1366]) {
    await staff.setViewportSize({ width, height: 900 })
    for (const path of paths) {
      await staff.goto(path)
      await expect(staff.locator("h1").first()).toBeVisible()
      measured++
      expect
        .soft(await smallTargets(staff), `${path}@${width} under 48px`)
        .toEqual([])
    }
  }
  expect(measured).toBeGreaterThan(8)
})

test("the staff TabBar is --spacing-tabbar tall at 320 (review Z8)", async () => {
  await staff.setViewportSize({ width: 320, height: 640 })
  await staff.goto("/staff/home")
  const bar = staff.locator('[data-slot="tabbar"]')
  await expect(bar).toBeVisible()
  await settle(staff)
  const { height, token } = await bar.evaluate((el) => {
    const probe = document.createElement("div")
    probe.style.height = "var(--spacing-tabbar)"
    document.body.append(probe)
    const token = probe.getBoundingClientRect().height
    probe.remove()
    return { height: el.getBoundingClientRect().height, token }
  })
  expect(token).toBe(64)
  expect(height).toBe(token)
})

type Mark = {
  border: boolean
  outline: boolean
  underline: boolean
  signature: string
}

/**
 * What still marks an element once forced colours have replaced its fill: a
 * border or outline whose colour differs from the element's own background,
 * or an underline. `signature` is everything but the background, so two
 * states that only differ in fill compare equal.
 */
function markOf(el: Element): Mark {
  const s = getComputedStyle(el)
  const visibleColour = (c: string) =>
    c !== "transparent" &&
    !/rgba\(.*,\s*0\)$/.test(c) &&
    c !== s.backgroundColor
  const border = (["Top", "Right", "Bottom", "Left"] as const).some(
    (side) =>
      s[`border${side}Style`] !== "none" &&
      s[`border${side}Style`] !== "hidden" &&
      parseFloat(s[`border${side}Width`]) >= 1 &&
      visibleColour(s[`border${side}Color`])
  )
  const outline =
    s.outlineStyle !== "none" &&
    parseFloat(s.outlineWidth) >= 1 &&
    visibleColour(s.outlineColor)
  const underline = s.textDecorationLine.includes("underline")
  return {
    border,
    outline,
    underline,
    signature: [
      s.borderTopStyle,
      s.borderTopWidth,
      s.borderTopColor,
      s.outlineStyle,
      s.outlineWidth,
      s.outlineColor,
      s.textDecorationLine,
    ].join(" "),
  }
}

const describeEl = (el: Element) =>
  `${el.tagName.toLowerCase()}${el.getAttribute("data-slot") ? `[data-slot=${el.getAttribute("data-slot")}]` : ""} "${(el.textContent ?? el.getAttribute("aria-label") ?? "").trim().slice(0, 30)}"`

test.describe("forced colours", () => {
  let fcStaff: Page
  let fcManager: Page
  let fcAdmin: Page

  test.beforeAll(async ({ browser }) => {
    const forced = { forcedColors: "active" } as const
    fcStaff = await signedInPage(browser, m.world.staffA, forced)
    fcManager = await signedInPage(browser, m.world.manager, forced)
    fcAdmin = await signedInPage(browser, m.world.admin, forced)
  })

  test.afterAll(async () => {
    await fcStaff?.context().close()
    await fcManager?.context().close()
    await fcAdmin?.context().close()
  })

  async function visit(page: Page, width: number, path: string) {
    await page.setViewportSize({ width, height: 900 })
    await page.goto(path)
    await expect(page.locator("h1").first()).toBeVisible()
    await settle(page)
    expect(
      await page.evaluate(() => matchMedia("(forced-colors: active)").matches),
      "forced colours are on"
    ).toBe(true)
  }

  async function unmarked(scope: Locator, max = 25) {
    return scope.evaluateAll(
      (els, { max, markSrc, describeSrc }) => {
        const mark = new Function(`return (${markSrc})`)() as (
          el: Element
        ) => Mark
        const describe = new Function(`return (${describeSrc})`)() as (
          el: Element
        ) => string
        return els
          .filter((el) => (el as HTMLElement).offsetParent !== null)
          .slice(0, max)
          .flatMap((el) => {
            const k = mark(el)
            return k.border || k.outline || k.underline
              ? []
              : [`${describe(el)} ${k.signature}`]
          })
      },
      { max, markSrc: markOf.toString(), describeSrc: describeEl.toString() }
    )
  }

  test("primary buttons and status chips keep an edge", async () => {
    let buttons = 0
    let chips = 0
    const pages: [Page, string][] = [
      [fcStaff, "/staff/home"],
      [fcStaff, `/staff/tasks/${m.taskId}`],
      [fcManager, "/manager"],
      [fcManager, "/manager/team"],
      [fcAdmin, "/admin/staff"],
      [fcAdmin, `/admin/menus/${m.world.venue1.id}`],
    ]
    for (const [page, path] of pages) {
      for (const width of [390, 1280]) {
        await visit(page, width, path)
        const primary = page.locator(
          '[data-slot="button"][data-variant="primary"]'
        )
        const chip = page.locator('[data-slot="status-chip"]')
        buttons += await primary.filter({ visible: true }).count()
        chips += await chip.filter({ visible: true }).count()
        expect
          .soft(await unmarked(primary), `${path}@${width} primary buttons`)
          .toEqual([])
        expect
          .soft(await unmarked(chip), `${path}@${width} status chips`)
          .toEqual([])
      }
    }
    expect(buttons, "primary buttons measured").toBeGreaterThan(0)
    expect(chips, "status chips measured").toBeGreaterThan(0)
  })

  test("the TabBar keeps its edge and current tab", async () => {
    // Me is a tab (DESIGN.md §15), so one tab is current.
    await visit(fcStaff, 390, "/staff/me")
    const bar = fcStaff.locator('[data-slot="tabbar"]')
    const current = bar.locator('[aria-current="page"]')
    // Measured, never vacuous: the bar has Today, Album, Add, My photos and
    // Me, and Me is current. Add is a plain tab, with no disc to mark.
    await expect(bar.locator("a, button")).toHaveCount(5)
    await expect(current).toHaveCount(1)
    await expect(bar.locator('[data-slot="album-add"]')).toHaveCount(1)
    expect(await unmarked(bar)).toEqual([])
    expect(await unmarked(current), "current tab").toEqual([])
  })

  test("a selected segment differs from the others by more than its fill", async () => {
    // [page, path, selected, unselected, dialog that holds the group]
    const groups: [Page, string, string, string, string?][] = [
      // Library filters (SegmentedControl)
      [
        fcAdmin,
        "/admin",
        '[data-slot="segmented-control-item"][aria-checked="true"]',
        '[data-slot="segmented-control-item"][aria-checked="false"]',
      ],
      // Photos filter (SegmentedControl), inside the Filters dialog
      [
        fcStaff,
        "/staff/community",
        '[data-slot="segmented-control-item"][aria-checked="true"]',
        '[data-slot="segmented-control-item"][aria-checked="false"]',
        "Filters",
      ],
    ]
    for (const [page, path, on, off, dialog] of groups) {
      for (const width of [390, 1280]) {
        await visit(page, width, path)
        if (dialog) {
          await page
            .getByRole("button", { name: new RegExp(`^${dialog}`) })
            .click()
          await expect(page.getByRole("dialog", { name: dialog })).toBeVisible()
          await settle(page)
        }
        const selected = page.locator(on).filter({ visible: true }).first()
        const other = page.locator(off).filter({ visible: true }).first()
        await expect(selected, `${path}@${width} ${on}`).toBeVisible()
        await expect(other, `${path}@${width} ${off}`).toBeVisible()
        const a = await selected.evaluate(
          (el, src) => (new Function(`return (${src})`)() as typeof markOf)(el),
          markOf.toString()
        )
        const b = await other.evaluate(
          (el, src) => (new Function(`return (${src})`)() as typeof markOf)(el),
          markOf.toString()
        )
        expect
          .soft(
            a.border || a.outline || a.underline,
            `${path}@${width} selected has a mark (${a.signature})`
          )
          .toBe(true)
        expect
          .soft(
            a.signature,
            `${path}@${width} selected vs unselected differ beyond fill`
          )
          .not.toBe(b.signature)
      }
    }
  })

  test("every control shows a focus outline from the keyboard", async () => {
    const pages: [Page, string, number][] = [
      [fcAdmin, "/admin", 1280],
      [fcAdmin, "/admin/staff", 390],
      [fcStaff, "/staff/community", 390],
      [fcManager, "/manager/team", 1280],
    ]
    let measured = 0
    for (const [page, path, width] of pages) {
      await visit(page, width, path)
      const missing: string[] = []
      for (let i = 0; i < 30; i++) {
        await page.keyboard.press("Tab")
        const result = await page.evaluate(
          ({ markSrc, describeSrc }) => {
            const mark = new Function(`return (${markSrc})`)() as (
              el: Element
            ) => Mark
            const describe = new Function(`return (${describeSrc})`)() as (
              el: Element
            ) => string
            const el = document.activeElement
            if (!el || el === document.body) return null
            // A visually hidden radio or checkbox shows focus on its label.
            const shown =
              (el as HTMLElement).offsetWidth <= 1
                ? (el.closest("label") ?? el)
                : el
            return { ok: mark(shown).outline, what: describe(shown) }
          },
          { markSrc: markOf.toString(), describeSrc: describeEl.toString() }
        )
        if (!result) continue
        measured++
        if (!result.ok) missing.push(result.what)
      }
      expect
        .soft(missing, `${path}@${width} focus without an outline`)
        .toEqual([])
    }
    expect(measured, "focused controls measured").toBeGreaterThan(20)
  })
})
