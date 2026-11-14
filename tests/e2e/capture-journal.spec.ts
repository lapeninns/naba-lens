import {
  devices,
  expect,
  test,
  type BrowserContextOptions,
  type Page,
  type Route,
  type TestInfo,
} from "@playwright/test"

import { CAPTURE_COPY } from "../../components/nabalens/shell/capture-resume"
import {
  fixtureFile,
  MiB,
  rowsOf,
  TUS,
  watchStorage,
} from "../fixtures/uploads/support"
import { addJustPhotos } from "./helpers/add-entry"
import { openEmailLink } from "./helpers/email-link"
import { provisioner, requireIsolatedStack } from "./helpers/stack"
import { STAFF_LANDING } from "./helpers/ui"
import { addSheet, addTab, savingSheet } from "./helpers/upload-label-flow"
import { provisionWorld, signedInPage, type Person } from "./helpers/world"

/**
 * B05-05 capture journal in the built app (contracts/b05-05-journal-wiring-
 * scope.md, b05-design §5.2 and §5.9), at phone width in Chromium and in
 * WebKit emulation (webkit-phone: Playwright's WebKit, never iPhone
 * evidence; X3 stays outstanding). Four journeys:
 *
 *   1. close the page mid-TUS and reopen: a kept photo continues with one tap,
 *      the same media_assets row, from a nonzero offset;
 *   2. a video shows the re-pick copy and keeps no bytes;
 *   3. sign out mid-upload: the journal, the upload keys and the tus resume
 *      URLs are gone, and account B sees nothing of account A;
 *   4. offline then online: the entry keeps its state, then completes.
 *
 * Nothing in the app is mocked: transfers are held or cut with routes and the
 * offline switch; the journal is read back from IndexedDB in the page; server
 * rows with the service client. `page.close()` may not fire pagehide, so each
 * journey waits for the journal to have the entry before closing.
 */

test.describe.configure({ mode: "serial" })
test.beforeAll(() => requireIsolatedStack())
test.setTimeout(240_000)

const PROJECTS = ["mobile-chromium", "webkit-phone"]
test.beforeEach(({}, testInfo) => {
  test.skip(
    !PROJECTS.includes(testInfo.project.name),
    "The capture journal runs at phone width in Chromium and WebKit emulation"
  )
})

const webkit = (info: TestInfo) => info.project.name === "webkit-phone"
const phone = (device: string): BrowserContextOptions => {
  const d = devices[device]!
  return {
    viewport: d.viewport,
    userAgent: d.userAgent,
    deviceScaleFactor: d.deviceScaleFactor,
    isMobile: d.isMobile,
    hasTouch: d.hasTouch,
  }
}
const view = (info: TestInfo): BrowserContextOptions =>
  webkit(info) ? phone("iPhone 13") : phone("Pixel 7")

const PHOTO = "photo-8mib.jpg"
const VIDEO = "clip-h264.mp4"

type Entry = {
  state: string
  assetId: string | null
  bytes: number
  name: string
  mediaType: string
}

/**
 * The journal's entries, read in the page. Opens the database only if it
 * exists: opening a missing one would create it without its store.
 */
function journal(page: Page): Promise<Entry[]> {
  return page.evaluate(async () => {
    const name = "nabalens-capture-journal"
    const dbs = await indexedDB.databases?.().catch(() => null)
    if (dbs && !dbs.some((d) => d.name === name)) return []
    return new Promise<Entry[]>((resolve) => {
      const req = indexedDB.open(name)
      req.onerror = () => resolve([])
      req.onsuccess = () => {
        const db = req.result
        db.onversionchange = () => db.close()
        if (!db.objectStoreNames.contains("entries")) {
          db.close()
          return resolve([])
        }
        const all = db
          .transaction("entries", "readonly")
          .objectStore("entries")
          .getAll()
        all.onsuccess = () => {
          db.close()
          resolve(
            (all.result as Record<string, unknown>[]).map((e) => ({
              state: e.state as string,
              assetId: (e.assetId as string | null) ?? null,
              bytes: (e.bytes as Blob | undefined)?.size ?? 0,
              name: e.displayName as string,
              mediaType: e.mediaType as string,
            }))
          )
        }
        all.onerror = () => {
          db.close()
          resolve([])
        }
      }
    })
  })
}

/** What this browser's storage reports (recorded, never asserted on WebKit). */
async function recordProbe(page: Page, info: TestInfo) {
  const probe = await page.evaluate(async () => ({
    estimate: await navigator.storage?.estimate?.().catch(() => null),
    persisted: await navigator.storage?.persisted?.().catch(() => null),
  }))
  info.annotations.push({
    type: "capture-probe",
    description: `${info.project.name}: ${JSON.stringify(probe)}`,
  })
}

/** Phone Add while idle: tab, Just photos, then the library in the Add sheet. */
async function pickFromAdd(page: Page, files: string[]) {
  await addJustPhotos(page, addTab(page))
  const sheet = addSheet(page)
  await expect(sheet).toBeVisible()
  const chooser = page.waitForEvent("filechooser")
  await sheet.getByRole("button", { name: /^Choose from your photos/ }).click()
  await (await chooser).setFiles(files)
}

/** Holds every TUS PATCH from `offset` on (never answered); returns the held. */
async function holdPatchesFrom(page: Page, offset: number) {
  const held: Route[] = []
  await page.route(TUS, (route) => {
    const req = route.request()
    if (
      req.method() === "PATCH" &&
      Number(req.headers()["upload-offset"] ?? 0) >= offset
    ) {
      held.push(route)
      return
    }
    return route.continue()
  })
  return held
}

async function openStaff(page: Page) {
  await page.goto("/staff/tasks")
  await expect(page).toHaveURL(STAFF_LANDING)
}

/** Signs `who` in on this page (same browser context: same device). */
async function signInHere(page: Page, who: Pick<Person, "email">) {
  const { data, error } = await provisioner().auth.admin.generateLink({
    type: "magiclink",
    email: who.email,
  })
  if (error) throw error
  await openEmailLink(
    page,
    `/auth/confirm?token_hash=${data.properties.hashed_token}&type=email`
  )
}

const deviceStores = (page: Page) =>
  page.evaluate(() => ({
    keys: Object.keys(localStorage).filter(
      (k) =>
        k === "nabalens-upload-keys" ||
        k.startsWith("tus::nabalens-media:") ||
        k === "nabalens-capture-account"
    ),
  }))

test("capture-journal: a photo closed mid-TUS continues with one tap, the same asset from its offset", async ({
  browser,
}, info) => {
  const world = await provisionWorld()
  const page = await signedInPage(browser, world.staffA, view(info))
  await openStaff(page)
  await recordProbe(page, info)
  // The first 6 MiB chunk lands; the second never does.
  const held = await holdPatchesFrom(page, 6 * MiB)
  await pickFromAdd(page, [fixtureFile(PHOTO)])
  await expect(savingSheet(page)).toBeVisible()
  await expect.poll(() => held.length, { timeout: 90_000 }).toBeGreaterThan(0)
  await expect
    .poll(async () => (await journal(page))[0]?.assetId ?? null, {
      timeout: 30_000,
    })
    .not.toBeNull()
  const [entry] = await journal(page)
  const [row] = await rowsOf(world.staffA.id)
  expect(entry).toMatchObject({ name: PHOTO, assetId: row!.id })
  expect(row!.upload_state).toBe("uploading")

  // The tab goes (no beforeunload); the same device opens the app again.
  const context = page.context()
  await page.close()
  const again = await context.newPage()
  await openStaff(again)
  await addJustPhotos(again, addTab(again))
  const sheet = addSheet(again)
  await expect(sheet).toBeVisible()

  const storage = watchStorage(again)
  if (entry!.bytes === 0) {
    // J1: this browser keeps the journal but refuses Blob writes (WebKit
    // private-mode behaviour; Playwright's WebKit does the same). Without
    // bytes the screen names the file and where to pick it again, and the
    // same file picked again continues the same asset (OD-B5-05-12).
    expect(webkit(info)).toBe(true)
    info.annotations.push({
      type: "capture-journal",
      description: "WebKit emulation kept no photo bytes: re-pick path",
    })
    expect(["reserved", "transferring"]).toContain(entry!.state)
    await expect(sheet).toContainText(CAPTURE_COPY.reselectLine(PHOTO))
    await expect(sheet).toContainText(CAPTURE_COPY.keepOpen)
    await expect(
      sheet.getByRole("button", { name: CAPTURE_COPY.continueLabel(PHOTO) })
    ).toHaveCount(0)
    const chooser = again.waitForEvent("filechooser")
    await sheet
      .getByRole("button", { name: /^Choose from your photos/ })
      .click()
    await (await chooser).setFiles([fixtureFile(PHOTO)])
  } else {
    expect(entry!.bytes).toBe(8 * MiB)
    await expect(sheet).toContainText(CAPTURE_COPY.continueLine(PHOTO))
    await sheet
      .getByRole("button", { name: CAPTURE_COPY.continueLabel(PHOTO) })
      .click()
  }
  const queue = savingSheet(again, "Saving 1 photo")
  await expect(queue).toBeVisible()
  await expect(
    queue.getByRole("listitem").filter({ hasText: PHOTO })
  ).toContainText("Saved", { timeout: 120_000 })
  // One asset, the same row, continued from where the first tab stopped.
  const rows = await rowsOf(world.staffA.id)
  expect(rows.map((r) => [r.id, r.upload_state])).toEqual([[row!.id, "ready"]])
  const offsets = storage.patchOffsets()
  expect(offsets.length).toBeGreaterThan(0)
  expect(offsets[0]).toBeGreaterThan(0)
  // Finished: its journal entry is gone.
  await expect.poll(() => journal(again)).toEqual([])
  await again.context().close()
})

test("capture-journal: a video that didn't finish shows the re-pick copy, keeps no bytes and can be dismissed", async ({
  browser,
}, info) => {
  const world = await provisionWorld()
  const page = await signedInPage(browser, world.staffA, view(info))
  await openStaff(page)
  const held = await holdPatchesFrom(page, 0)
  await pickFromAdd(page, [fixtureFile(VIDEO)])
  await expect.poll(() => held.length, { timeout: 90_000 }).toBeGreaterThan(0)
  await expect
    .poll(async () => (await journal(page))[0]?.assetId ?? null)
    .not.toBeNull()
  const [entry] = await journal(page)
  expect(entry).toMatchObject({ name: VIDEO, mediaType: "video", bytes: 0 })

  const context = page.context()
  await page.close()
  const again = await context.newPage()
  await openStaff(again)
  await addJustPhotos(again, addTab(again))
  const sheet = addSheet(again)
  await expect(sheet).toContainText(CAPTURE_COPY.reselectLine(VIDEO))
  await expect(
    sheet.getByRole("button", { name: CAPTURE_COPY.continueLabel(VIDEO) })
  ).toHaveCount(0)
  // B05-05 follow-up: Dismiss drops it from the block and the journal.
  await sheet
    .getByRole("button", { name: CAPTURE_COPY.dismissLabel(VIDEO) })
    .tap()
  await expect(sheet).not.toContainText(CAPTURE_COPY.reselectLine(VIDEO))
  await expect.poll(async () => (await journal(again)).length).toBe(0)
  await again.context().close()
})

test("capture-journal: sign-out mid-upload empties the journal and keys; account B sees nothing", async ({
  browser,
}, info) => {
  const world = await provisionWorld()
  const page = await signedInPage(browser, world.staffA, view(info))
  // Me, where phones log out; a page load later would meet beforeunload.
  await page.goto("/staff")
  await expect(page).toHaveURL(/\/staff$/)
  const held = await holdPatchesFrom(page, 6 * MiB)
  await pickFromAdd(page, [fixtureFile(PHOTO)])
  await expect.poll(() => held.length, { timeout: 90_000 }).toBeGreaterThan(0)
  await expect
    .poll(async () => (await journal(page)).length, { timeout: 30_000 })
    .toBe(1)
  expect((await deviceStores(page)).keys.length).toBeGreaterThan(0)
  await page.keyboard.press("Escape")
  await expect(savingSheet(page)).toBeHidden()

  // Log out from Me, past the leave guard.
  await page.getByRole("main").getByRole("button", { name: "Log out" }).click()
  const confirm = page.getByRole("alertdialog", { name: "Log out now?" })
  await expect(confirm).toBeVisible()
  await confirm.getByRole("button", { name: "Log out anyway" }).click()
  await expect(page).toHaveURL(/\/login\?signed_out=1$/)
  for (const route of held.splice(0)) await route.abort().catch(() => {})
  await page.unrouteAll({ behavior: "ignoreErrors" })

  // Everything of account A on this device is gone.
  await expect.poll(() => journal(page)).toEqual([])
  await expect.poll(() => deviceStores(page)).toEqual({ keys: [] })

  // Account B on the same device: nothing of A is shown.
  await signInHere(page, world.staffB)
  await expect(page).toHaveURL(STAFF_LANDING)
  await addJustPhotos(page, addTab(page))
  const sheet = addSheet(page)
  await expect(sheet).toBeVisible()
  await expect(sheet.locator("[data-capture-resume]")).toHaveCount(0)
  await expect(sheet).not.toContainText(PHOTO)
  expect(await journal(page)).toEqual([])
  await page.context().close()
})

test("capture-journal: offline then online keeps the entry's state, then completes", async ({
  browser,
}, info) => {
  const world = await provisionWorld()
  const page = await signedInPage(browser, world.staffA, view(info))
  const context = page.context()
  await openStaff(page)
  // Hold the second chunk until the device is offline.
  const held = await holdPatchesFrom(page, 6 * MiB)
  await pickFromAdd(page, [fixtureFile(PHOTO)])
  await expect.poll(() => held.length, { timeout: 90_000 }).toBeGreaterThan(0)
  await expect
    .poll(async () => (await journal(page))[0]?.assetId ?? null)
    .not.toBeNull()
  await context.setOffline(true)
  await page.unroute(TUS)
  for (const route of held.splice(0))
    await route.abort("internetdisconnected").catch(() => {})
  const queue = savingSheet(page)
  await expect(queue).toContainText("Waiting for a signal", { timeout: 60_000 })
  // Offline is not a failure: the entry keeps its state.
  const offline = await journal(page)
  expect(offline).toHaveLength(1)
  expect(["reserved", "transferring"]).toContain(offline[0]!.state)

  await context.setOffline(false)
  await expect(
    queue.getByRole("listitem").filter({ hasText: PHOTO })
  ).toContainText("Saved", { timeout: 120_000 })
  await expect.poll(() => journal(page)).toEqual([])
  const rows = await rowsOf(world.staffA.id)
  expect(rows.map((r) => r.upload_state)).toEqual(["ready"])
  await context.close()
})
