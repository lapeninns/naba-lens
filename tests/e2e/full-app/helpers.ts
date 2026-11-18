import {
  devices,
  expect,
  test,
  type Browser,
  type BrowserContextOptions,
  type Page,
} from "@playwright/test"

import sharp from "sharp"

import { signIn } from "../../support/identities"
import { horizontalOverflow } from "../helpers/overflow"
import { provisioner } from "../helpers/stack"
import { signedInPage, type Person } from "../helpers/world"

/**
 * Shared pieces for the Full App v1 acceptance journeys (Sprint 3, S3-E2E-2).
 * Each spec in this folder names its acceptance criterion (AC15 to AC39 in
 * docs/spec/NabaLens-Full-App-Specification-v1.0.md §22) in every test
 * title. Specs run on the `chromium` project; each test opens its own
 * contexts at the sizes below, so one run covers phone and desktop.
 */

export const PHONE: BrowserContextOptions = {
  viewport: { width: 390, height: 844 },
  userAgent: devices["Pixel 7"].userAgent,
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
}

/** The narrowest supported phone (WCAG reflow width). */
export const NARROW: BrowserContextOptions = {
  ...PHONE,
  viewport: { width: 320, height: 640 },
}

export const DESKTOP: BrowserContextOptions = {
  viewport: { width: 1280, height: 800 },
}

export const SIZES = [
  ["phone 390", PHONE],
  ["desktop 1280", DESKTOP],
] as const

/** A page signed in as `who` at `size` (admins pass MFA, helpers/mfa.ts). */
export function as(
  browser: Browser,
  who: Person,
  size: BrowserContextOptions = DESKTOP
): Promise<Page> {
  return signedInPage(browser, who, size)
}

/** A full-page screenshot kept in the test's output folder, pass or fail. */
export async function evidence(page: Page, name: string) {
  const path = test.info().outputPath(`${name}.png`)
  await page.screenshot({ path, fullPage: true })
  await test.info().attach(name, { path, contentType: "image/png" })
  return path
}

/** Records a behaviour the spec pins on purpose (deferred AC, decision). */
export function note(type: string, description: string) {
  test.info().annotations.push({ type, description })
}

/** Nothing scrolls sideways at this width (WCAG 1.4.10). */
export async function expectNoSidewaysScroll(page: Page, what: string) {
  const { overflowPx, culprit } = await horizontalOverflow(page)
  expect(
    overflowPx,
    `${what} scrolls sideways: ${culprit}`
  ).toBeLessThanOrEqual(0)
}

/** Closes every context the test opened and keeps a final screenshot. */
export async function closeAll(browser: Browser) {
  let n = 0
  for (const context of browser.contexts()) {
    for (const page of context.pages()) {
      n += 1
      const body = await page.screenshot().catch(() => null)
      if (body)
        await test
          .info()
          .attach(`final-page-${n}`, { body, contentType: "image/png" })
    }
    await context.close().catch(() => undefined)
  }
}

export const sql = (v: string) => `'${v.replace(/'/g, "''")}'`

/**
 * Stores real JPEG bytes as a seeded photo's original (`seedImages` stores
 * only the thumb and preview), so an export can render it. Fixture setup by
 * the service role, as the upload worker would have written it.
 */
export async function storeOriginal(
  uploaderId: string,
  assetId: string,
  colour = "#7a9a4b"
) {
  const bytes = await sharp({
    create: { width: 320, height: 240, channels: 3, background: colour },
  })
    .jpeg()
    .toBuffer()
  const { error } = await provisioner()
    .storage.from("media")
    .upload(`${uploaderId}/${assetId}/original.jpg`, bytes, {
      contentType: "image/jpeg",
      upsert: true,
    })
  if (error) throw error
}

/**
 * Accepts a labelled dish photo for public use as the venue's manager, in the
 * manager's own session (the review RPC the Review page calls). Used where
 * an accepted photo is the starting point of a journey, not what it checks.
 */
export async function acceptAsManager(
  manager: Pick<Person, "email">,
  assetId: string,
  itemId: string,
  expectedRevision = 1
) {
  const db = await signIn(provisioner(), manager.email)
  const { error } = await db.rpc("review_menu_item_photo", {
    p_asset_id: assetId,
    p_item_id: itemId,
    p_variant_id: null as unknown as string,
    p_decision: "accepted",
    p_expected_revision: expectedRevision,
    p_make_primary: false,
  })
  if (error) throw new Error(`fixture accept failed: ${error.message}`)
}
