import { readFile } from "node:fs/promises"
import { createHash } from "node:crypto"

import { expect, test, type Locator, type Route } from "@playwright/test"

import { provisioner, psql } from "../e2e/helpers/stack"
import {
  STAFF_LANDING,
  libraryList,
  openPortfolio,
  staffTile,
} from "../e2e/helpers/ui"
import {
  CHUNK,
  SIGNED_PUT,
  TUS,
  appDate,
  chooseAndUpload,
  expectSummary,
  fixtureFile,
  isFinalise,
  objectsOf,
  openUploadDialog,
  portfolio,
  rowsOf,
  row,
  signInAs,
  stage,
  tileOf,
  watchStorage,
} from "../fixtures/uploads/support"

/**
 * Media upload interruption and recovery against the real local Supabase
 * stack (real TUS resumable uploads and signed PUTs through the real upload
 * sheet: Me's "Upload photos or videos" opens Add's queue, which starts
 * uploading as soon as files are picked and is titled "Saving N photos" from
 * then on). Every test asserts the CORRECT behaviour; the interruption is made
 * with Playwright routes or the browser's offline switch, never with Docker.
 * Each test name starts with the journey id it belongs to
 * (tests/journeys/media.*.journey.json select them by that prefix).
 */

const sha256 = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex")

const SIZE = async () => (await readFile(fixtureFile("tus-video.mp4"))).length

/**
 * A queue row's state word ("Saved", "Saving…" or "Needs attention", the
 * row's accessible description) and, optionally, the text of its detail line
 * (the failure reason, "Waiting for a signal", "Uploading 40%"…).
 */
async function expectRow(
  dialog: Locator,
  name: string,
  word: "Saved" | "Saving…" | "Needs attention",
  detail?: string,
  timeout?: number
) {
  const item = row(dialog, name)
  await expect(item).toHaveAccessibleDescription(word, { timeout })
  if (detail !== undefined)
    await expect(item).toContainText(detail, { timeout })
}

async function storedHash(path: string) {
  const { data, error } = await provisioner()
    .storage.from("media")
    .download(path)
  if (error) throw error
  return sha256(new Uint8Array(await data.arrayBuffer()))
}

/** Holds the first PATCH at `offset` (never answered) until `release()`. */
async function holdPatchAt(
  page: import("@playwright/test").Page,
  offset: number
) {
  let held: Route | null = null
  let released = false
  await page.route(TUS, async (route) => {
    const req = route.request()
    if (
      !released &&
      !held &&
      req.method() === "PATCH" &&
      req.headers()["upload-offset"] === String(offset)
    ) {
      held = route
      return
    }
    await route.continue()
  })
  return {
    isHeld: () => held !== null,
    async release() {
      released = true
      await held?.continue().catch(() => {})
    },
  }
}

test.describe("media.tus-interrupted-resume", () => {
  test("media.tus-interrupted-resume: a connection reset mid-chunk resumes from the server offset", async ({
    browser,
    baseURL,
  }) => {
    test.setTimeout(240_000)
    const { staff, page } = await stage(browser, baseURL!)
    const storage = watchStorage(page)
    const size = await SIZE()
    const chunks = Math.ceil(size / CHUNK)
    expect(chunks).toBeGreaterThanOrEqual(4)

    let dropped = 0
    await page.route(TUS, async (route) => {
      const req = route.request()
      if (
        !dropped &&
        req.method() === "PATCH" &&
        req.headers()["upload-offset"] === String(2 * CHUNK)
      ) {
        dropped++
        return route.abort("connectionreset")
      }
      await route.continue()
    })
    const dialog = await openUploadDialog(page)
    await chooseAndUpload(dialog, ["tus-video.mp4"])
    await expectSummary(dialog, "1 saved", 90_000)

    expect(dropped).toBe(1)
    const offsets = storage.patchOffsets()
    // The dropped PATCH is the only repeat; the resume continues at the same
    // server offset, not at 0.
    expect(offsets).toEqual([
      0,
      CHUNK,
      2 * CHUNK,
      2 * CHUNK,
      ...Array.from({ length: chunks - 3 }, (_, i) => (i + 3) * CHUNK),
    ])
    const methods = storage.methods()
    expect(methods.filter((m) => m === "POST")).toHaveLength(1)
    const firstDrop = methods.indexOf("PATCH", 2)
    expect(methods.indexOf("HEAD", firstDrop)).toBeGreaterThan(firstDrop)
    // Every byte reached the server exactly once.
    expect(await storage.deliveredPatchBytes()).toBe(size)

    const rows = await rowsOf(staff.id)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      original_filename: "tus-video.mp4",
      upload_state: "ready",
      size_bytes: size,
    })
    expect(await storedHash(rows[0].original_path)).toBe(
      sha256(await readFile(fixtureFile("tus-video.mp4")))
    )
    await page.context().close()
  })

  test("media.tus-interrupted-resume: a short network outage resumes without user action", async ({
    browser,
    baseURL,
  }) => {
    test.setTimeout(240_000)
    const { staff, page } = await stage(browser, baseURL!)
    const storage = watchStorage(page)
    const size = await SIZE()

    // The browser stays "online" but two chunk requests fail, shorter than the
    // client's retry schedule (0, 3, 5, 10, 20 s).
    let cut = 0
    await page.route(TUS, async (route) => {
      const req = route.request()
      if (
        cut < 2 &&
        req.method() === "PATCH" &&
        req.headers()["upload-offset"] === String(CHUNK)
      ) {
        cut++
        return route.abort("internetdisconnected")
      }
      await route.continue()
    })
    const dialog = await openUploadDialog(page)
    await chooseAndUpload(dialog, ["tus-video.mp4"])
    await expectSummary(dialog, "1 saved", 90_000)

    expect(cut).toBe(2)
    expect(storage.methods().filter((m) => m === "POST")).toHaveLength(1)
    expect(storage.methods()).toContain("HEAD")
    expect(await storage.deliveredPatchBytes()).toBe(size)
    const rows = await rowsOf(staff.id)
    expect(rows).toHaveLength(1)
    expect(rows[0].upload_state).toBe("ready")
    await page.context().close()
  })
})

// The retry schedule of the TUS client is 0, 3, 5, 10 and 20 s: the second
// test waits about 40 s for it to run out, then shows Retry. The first goes
// through the browser's offline switch: the file waits for a signal and resumes
// by itself when the browser is back online.
test.describe("media.tus-offline-retry", () => {
  for (const mode of ["browser offline", "outage past the retry schedule"]) {
    test(`media.tus-offline-retry: ${mode} waits or shows Retry, and resumes the same asset`, async ({
      browser,
      baseURL,
    }, testInfo) => {
      test.setTimeout(300_000)
      const { staff, page } = await stage(browser, baseURL!)
      const storage = watchStorage(page)
      const size = await SIZE()
      const context = page.context()
      const offline = mode === "browser offline"

      let down = false
      await page.route(TUS, async (route) => {
        const req = route.request()
        const atCut =
          req.method() === "PATCH" &&
          Number(req.headers()["upload-offset"]) >= CHUNK
        if (!down && !atCut) return route.continue()
        if (!down) {
          down = true
          if (offline) await context.setOffline(true)
        }
        if (offline) return route.continue()
        return route.abort("internetdisconnected")
      })
      const dialog = await openUploadDialog(page)
      await chooseAndUpload(dialog, ["tus-video.mp4"])
      if (offline) {
        // Offline the file waits for a signal instead of failing.
        await expect(
          dialog.getByText(
            "Waiting for a signal. Keep this page open; nothing is sent twice."
          )
        ).toBeVisible({ timeout: 120_000 })
        await expectRow(
          dialog,
          "tus-video.mp4",
          "Saving…",
          "Waiting for a signal",
          120_000
        )
        // The notice above is a status too: the footer is the last one.
        await expect(dialog.getByRole("status").last()).toHaveText(
          "0 saved · 1 waiting"
        )
      } else {
        await expectRow(
          dialog,
          "tus-video.mp4",
          "Needs attention",
          "The connection was interrupted. Check your connection, then retry: the upload continues where it stopped.",
          120_000
        )
        await expect(dialog.getByRole("status")).toHaveText(
          "0 saved · 1 need attention"
        )
      }
      await testInfo.attach(offline ? "offline-waiting" : "offline-failed", {
        body: await dialog.screenshot(),
        contentType: "image/png",
      })
      const interrupted = await rowsOf(staff.id)
      expect(interrupted).toHaveLength(1)
      expect(interrupted[0].upload_state).toBe("uploading")

      down = false
      storage.reset()
      await page.unroute(TUS)
      // Back online the waiting file carries on by itself; a failed one
      // needs its Retry.
      if (offline) await context.setOffline(false)
      else
        await dialog
          .getByRole("button", { name: "Retry tus-video.mp4" })
          .click()
      await expectSummary(dialog, "1 saved", 90_000)
      expect(storage.methods()[0]).toBe("HEAD")
      expect(storage.methods()).not.toContain("POST")
      expect(storage.patchOffsets()[0]).toBe(CHUNK)
      expect(await storage.deliveredPatchBytes()).toBe(size - CHUNK)
      const rows = await rowsOf(staff.id)
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({
        id: interrupted[0].id,
        upload_state: "ready",
      })
      await context.close()
    })
  }
})

test.describe("media.reload-resume", () => {
  test("media.reload-resume: after a reload mid-transfer, choosing the file again resumes the same asset from the stored offset", async ({
    browser,
    baseURL,
  }) => {
    test.setTimeout(240_000)
    const { staff, page } = await stage(browser, baseURL!)
    const storage = watchStorage(page)
    const size = await SIZE()

    const hold = await holdPatchAt(page, 2 * CHUNK)
    let dialog = await openUploadDialog(page)
    await chooseAndUpload(dialog, ["tus-video.mp4"])
    await expect.poll(() => hold.isHeld(), { timeout: 30_000 }).toBe(true)
    page.once("dialog", (d) => void d.accept()) // beforeunload guard
    await page.reload()
    await page.unroute(TUS)

    const unfinished = await rowsOf(staff.id)
    expect(unfinished).toHaveLength(1)
    expect(unfinished[0].upload_state).toBe("uploading")
    await expect(
      // After the reload this tab no longer holds the transfer (B02 UP-01).
      await tileOf(page, staff.id, "tus-video.mp4", "Stopped")
    ).toHaveCount(1)

    storage.reset()
    dialog = await openUploadDialog(page)
    await chooseAndUpload(dialog, ["tus-video.mp4"])
    await expectSummary(dialog, "1 saved", 90_000)
    expect(storage.methods()[0]).toBe("HEAD")
    expect(storage.methods()).not.toContain("POST")
    expect(storage.patchOffsets()[0]).toBe(2 * CHUNK)
    expect(await storage.deliveredPatchBytes()).toBe(size - 2 * CHUNK)
    const rows = await rowsOf(staff.id)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      id: unfinished[0].id,
      upload_state: "ready",
    })
    await dialog.getByRole("button", { name: "Done" }).click()
    await expect(
      await tileOf(page, staff.id, "tus-video.mp4", "ready")
    ).toHaveCount(1)
    await page.context().close()
  })
})

test.describe("media.removed-reservation", () => {
  test("media.removed-reservation: choosing a file whose reservation was removed shows the action to take, and Retry uploads it as a new asset", async ({
    browser,
    baseURL,
  }) => {
    test.setTimeout(240_000)
    const { staff, page } = await stage(browser, baseURL!)

    const hold = await holdPatchAt(page, CHUNK)
    let dialog = await openUploadDialog(page)
    await chooseAndUpload(dialog, ["tus-video.mp4"])
    await expect.poll(() => hold.isHeld(), { timeout: 30_000 }).toBe(true)
    page.once("dialog", (d) => void d.accept())
    await page.reload()
    await page.unroute(TUS)
    const [reserved] = await rowsOf(staff.id)
    expect(reserved.upload_state).toBe("uploading")

    // What the abandoned-upload cleanup does to an expired reservation.
    const removed = await provisioner()
      .from("media_assets")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", reserved.id)
    expect(removed.error).toBeNull()

    dialog = await openUploadDialog(page)
    await chooseAndUpload(dialog, ["tus-video.mp4"])
    await expectRow(
      dialog,
      "tus-video.mp4",
      "Needs attention",
      "This unfinished upload was removed or expired. Retry to upload the file again.",
      60_000
    )
    await dialog.getByRole("button", { name: "Retry tus-video.mp4" }).click()
    await expectSummary(dialog, "1 saved", 90_000)
    const live = (await rowsOf(staff.id)).filter((r) => r.deleted_at === null)
    expect(live).toHaveLength(1)
    expect(live[0].id).not.toBe(reserved.id)
    expect(live[0].upload_state).toBe("ready")
    await dialog.getByRole("button", { name: "Done" }).click()
    await expect(await tileOf(page, staff.id, "tus-video.mp4")).toHaveCount(1)
    await page.context().close()
  })
})

test.describe("media.reopen-states", () => {
  test("media.reopen-states: after a reload the portfolio tells completed, incomplete and failed uploads apart", async ({
    browser,
    baseURL,
  }, testInfo) => {
    test.setTimeout(240_000)
    const { staff, page } = await stage(browser, baseURL!)

    // Completed and failed: one batch through the real dialog.
    let dialog = await openUploadDialog(page)
    await chooseAndUpload(dialog, ["photo.jpg", "disguised.jpg"])
    await expectSummary(dialog, "1 saved · 1 need attention", 90_000)
    // Done hides the sheet; the failed file stays in Add's queue.
    await dialog.getByRole("button", { name: "Done" }).click()
    await expect(dialog).toBeHidden()

    // Incomplete: a video whose transfer is cut by a reload. Add reopens the
    // queue that still holds the failed file; the video joins it.
    const hold = await holdPatchAt(page, CHUNK)
    dialog = await openUploadDialog(page)
    await chooseAndUpload(dialog, ["tus-video.mp4"])
    await expect.poll(() => hold.isHeld(), { timeout: 30_000 }).toBe(true)
    page.once("dialog", (d) => void d.accept())
    await page.reload()
    await page.unroute(TUS)

    const expectStates = async (p: typeof page) => {
      // Tiles, not buttons: the stopped video's tile also carries its own
      // "Open Add" button inside the list (B02 UP-01). Exactly one.
      await expect(portfolio(p).locator("button[data-media-id]")).toHaveCount(3)
      await expect(
        portfolio(p).getByRole("button", { name: "Open Add" })
      ).toHaveCount(1)
      await expect(await tileOf(p, staff.id, "photo.jpg", "ready")).toHaveCount(
        1
      )
      await expect(
        await tileOf(p, staff.id, "disguised.jpg", "Failed")
      ).toHaveCount(1)
      await expect(
        await tileOf(p, staff.id, "tus-video.mp4", "Stopped")
      ).toHaveCount(1)
      // The completed photo has a real thumbnail; the others are not "ready".
      await expect
        .poll(async () =>
          (await tileOf(p, staff.id, "photo.jpg", "ready"))
            .locator("img")
            .evaluate((img: HTMLImageElement) => img.naturalWidth)
        )
        .toBeGreaterThan(0)
    }
    await expectStates(page)
    await testInfo.attach("portfolio-after-reload", {
      body: await page.screenshot({ fullPage: true }),
      contentType: "image/png",
    })

    // Reopening the uploader starts a clean queue and claims nothing.
    // Its title is the picker's, not "Saving N …".
    dialog = await openUploadDialog(page)
    await expect(dialog).toHaveAccessibleName("Upload photos or videos")
    await expect(dialog.getByRole("list", { name: "Files" })).toHaveCount(0)
    await expect(dialog.getByRole("status")).toHaveCount(0)
    await dialog.getByRole("button", { name: "Done" }).click()
    await expect(dialog).toBeHidden()

    // Another device sees the same states from the server.
    const fresh = await signInAs(browser, staff, baseURL!, STAFF_LANDING)
    await openPortfolio(fresh)
    await expectStates(fresh)
    await fresh.context().close()

    const rows = await rowsOf(staff.id)
    expect(
      Object.fromEntries(rows.map((r) => [r.original_filename, r.upload_state]))
    ).toEqual({
      "photo.jpg": "ready",
      "disguised.jpg": "failed",
      "tus-video.mp4": "uploading",
    })
    await page.context().close()
  })
})

test.describe("media.partial-batch", () => {
  test("media.partial-batch: good files stay, the bad file fails with a reason, and Retry of a transient failure leaves one row per file", async ({
    browser,
    baseURL,
  }) => {
    test.setTimeout(300_000)
    const { staff, page } = await stage(browser, baseURL!)
    const files = ["photo.jpg", "photo.png", "extra.jpg", "disguised.jpg"]

    // Cut every attempt of one photo's signed PUT at the network level; the
    // file is recognised by the asset id in the URL, looked up on the server.
    let offline = true
    const names = new Map<string, string>()
    const filenameOf = async (path: string) => {
      const hit = names.get(path)
      if (hit) return hit
      const { data } = await provisioner()
        .from("media_assets")
        .select("original_filename")
        .eq("original_path", path)
        .single()
      if (data) names.set(path, data.original_filename)
      return data?.original_filename
    }
    let aborted = 0
    await page.route(SIGNED_PUT, async (route) => {
      const path = decodeURIComponent(
        new URL(route.request().url()).pathname.replace(
          /^.*\/object\/upload\/sign\/media\//,
          ""
        )
      )
      if (offline && (await filenameOf(path)) === "extra.jpg") {
        aborted++
        return route.abort("internetdisconnected")
      }
      await route.continue()
    })

    const dialog = await openUploadDialog(page)
    await chooseAndUpload(dialog, files)
    await expectSummary(dialog, "2 saved · 2 need attention", 120_000)
    expect(aborted).toBeGreaterThanOrEqual(1)
    await expectRow(dialog, "photo.jpg", "Saved")
    await expectRow(dialog, "photo.png", "Saved")
    // The server refused the disguised file: it can't be used, so no Retry.
    await expectRow(
      dialog,
      "disguised.jpg",
      "Needs attention",
      "This file can't be used: This file type is not supported."
    )
    await expect(
      dialog.getByRole("button", { name: "Retry disguised.jpg" })
    ).toHaveCount(0)
    await expectRow(
      dialog,
      "extra.jpg",
      "Needs attention",
      "The connection was interrupted."
    )

    const before = await rowsOf(staff.id)
    expect(before).toHaveLength(4)
    const state = (rows: typeof before) =>
      Object.fromEntries(rows.map((r) => [r.original_filename, r.upload_state]))
    expect(state(before)).toEqual({
      "photo.jpg": "ready",
      "photo.png": "ready",
      "extra.jpg": "uploading",
      "disguised.jpg": "failed",
    })

    offline = false
    await dialog.getByRole("button", { name: "Retry extra.jpg" }).click()
    await expectSummary(dialog, "3 saved · 1 need attention", 60_000)
    await expectRow(dialog, "extra.jpg", "Saved")

    const after = await rowsOf(staff.id)
    // Exactly one row per file, the successful ones untouched, the retried one
    // reusing its reservation.
    expect(after.map((r) => r.original_filename).sort()).toEqual(
      [...files].sort()
    )
    expect(state(after)).toEqual({
      "photo.jpg": "ready",
      "photo.png": "ready",
      "extra.jpg": "ready",
      "disguised.jpg": "failed",
    })
    for (const r of before) {
      expect(
        after.find((a) => a.original_filename === r.original_filename)?.id
      ).toBe(r.id)
    }
    await page.context().close()
  })
})

test.describe("media.stuck-processing", () => {
  test("media.stuck-processing: an asset left in processing is visible, is failed by cleanup past the window, and its file can be chosen again", async ({
    browser,
    baseURL,
  }, testInfo) => {
    test.setTimeout(240_000)
    const { staff, page } = await stage(browser, baseURL!)
    const service = provisioner()

    // A finalise that never completes: the bytes are stored, the row is not.
    await page.route("**/staff", async (route) => {
      if (isFinalise(route.request())) return route.abort("connectionreset")
      await route.continue()
    })
    let dialog = await openUploadDialog(page)
    await chooseAndUpload(dialog, ["photo.jpg"])
    await expectRow(dialog, "photo.jpg", "Needs attention", undefined, 60_000)
    await page.unroute("**/staff")
    const [claimed] = await rowsOf(staff.id)
    expect(await objectsOf(staff.id, claimed.id)).toContain("original.jpg")

    // The crashed claim: the server marked it processing, then died. Only this
    // row is aged, past the 30 minute window the reaper uses.
    const claim = await service
      .from("media_assets")
      .update({ upload_state: "processing" })
      .eq("id", claimed.id)
    expect(claim.error).toBeNull()
    psql(
      `set session_replication_role = replica; update public.media_assets set updated_at = now() - interval '45 minutes' where id = '${claimed.id}'`
    )

    await page.reload()
    await expect(
      await tileOf(page, staff.id, "photo.jpg", "Processing")
    ).toHaveCount(1)
    await testInfo.attach("stuck-processing", {
      body: await page.screenshot({ fullPage: true }),
      contentType: "image/png",
    })

    // The database half of runMediaCleanup. It only touches rows in
    // `processing` for longer than the window, so other runs' fresh claims
    // are left alone.
    const reaped = await service.rpc("fail_stale_media_processing", {
      p_stale_after: "30 minutes",
    })
    expect(reaped.error).toBeNull()
    expect(reaped.data?.map((r) => r.asset_id)).toContain(claimed.id)
    expect((await rowsOf(staff.id))[0].upload_state).toBe("failed")

    await page.reload()
    await expect(
      await tileOf(page, staff.id, "photo.jpg", "Failed")
    ).toHaveCount(1)
    await expect(
      await tileOf(page, staff.id, "photo.jpg", "Processing")
    ).toHaveCount(0)

    // Recovery: choosing the file again finalises the stored bytes.
    dialog = await openUploadDialog(page)
    await chooseAndUpload(dialog, ["photo.jpg"])
    await expectSummary(dialog, "1 saved", 60_000)
    const rows = await rowsOf(staff.id)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ id: claimed.id, upload_state: "ready" })
    await page.context().close()
  })
})

test.describe("media.leave-warning", () => {
  test("media.leave-warning: leaving the page during an active upload prompts, an idle page does not", async ({
    browser,
    baseURL,
  }) => {
    test.setTimeout(240_000)
    const { page } = await stage(browser, baseURL!)

    const seen: string[] = []
    let accept = false
    page.on("dialog", (d) => {
      seen.push(d.type())
      void (accept ? d.accept() : d.dismiss())
    })

    const hold = await holdPatchAt(page, CHUNK)
    const dialog = await openUploadDialog(page)
    await chooseAndUpload(dialog, ["tus-video.mp4"])
    await expect.poll(() => hold.isHeld(), { timeout: 30_000 }).toBe(true)
    await expectRow(dialog, "tus-video.mp4", "Saving…", "Uploading")

    // Navigation away: the page asks, and staying keeps the upload running.
    await page.goto("/login").catch(() => {})
    expect(seen).toEqual(["beforeunload"])
    expect(new URL(page.url()).pathname).toBe("/staff")
    await expectRow(dialog, "tus-video.mp4", "Saving…", "Uploading")

    // Closing the tab asks too.
    await page.close({ runBeforeUnload: true })
    await expect.poll(() => seen.length, { timeout: 10_000 }).toBe(2)
    expect(seen[1]).toBe("beforeunload")
    expect(page.isClosed()).toBe(false)

    // Idle again: no prompt.
    await hold.release()
    await expectSummary(dialog, "1 saved", 90_000)
    await dialog.getByRole("button", { name: "Done" }).click()
    seen.length = 0
    accept = true
    await page.goto("/login")
    expect(seen).toEqual([])
    await page.context().close()
  })
})

test.describe("media.reload-metadata", () => {
  test("media.reload-metadata: reloaded uploads still show thumbnail, date, contributor and venue", async ({
    browser,
    baseURL,
  }, testInfo) => {
    test.setTimeout(240_000)
    const { world, staff, page } = await stage(browser, baseURL!)

    const dialog = await openUploadDialog(page)
    await chooseAndUpload(dialog, ["photo.jpg", "photo.png"])
    await expectSummary(dialog, "2 saved", 90_000)
    await dialog.getByRole("button", { name: "Done" }).click()
    await page.reload()

    const rows = await rowsOf(staff.id)
    expect(rows).toHaveLength(2)

    // Staff view: thumbnail and upload date on every tile; contributor and
    // venue in the profile header.
    for (const r of rows) {
      const date = appDate(r.created_at)
      const tile = (
        await staffTile(portfolio(page), r.original_filename, staff.id)
      ).and(page.getByRole("button", { name: `Photo, uploaded ${date}` }))
      await expect(tile).toBeVisible()
      await expect
        .poll(() =>
          tile
            .locator("img")
            .evaluate((img: HTMLImageElement) => img.naturalWidth)
        )
        .toBeGreaterThan(0)
    }
    const header = page.getByRole("region", { name: "Profile" })
    await expect(
      header.getByRole("heading", { name: staff.name })
    ).toBeVisible()
    await expect(header.getByText(world.venue1.name)).toBeVisible()
    await testInfo.attach("staff-portfolio", {
      body: await page.screenshot({ fullPage: true }),
      contentType: "image/png",
    })

    // Admin view of the same uploads: contributor, venue and date by name.
    const adminPage = await signInAs(
      browser,
      world.adminA,
      baseURL!,
      /\/admin$/
    )
    await adminPage.goto(`/admin?staff=${staff.id}`)
    const library = libraryList(adminPage)
    for (const r of rows) {
      const date = appDate(r.created_at)
      const tile = library.getByRole("button", {
        name: `Photo, ${r.original_filename}, by ${staff.name}, ${world.venue1.name}, uploaded ${date}`,
      })
      await expect(tile).toBeVisible()
      await expect
        .poll(() =>
          tile
            .locator("img")
            .evaluate((img: HTMLImageElement) => img.naturalWidth)
        )
        .toBeGreaterThan(0)
    }
    await expect(library.getByText(staff.name).first()).toBeVisible()
    await expect(
      library
        .getByText(`${world.venue1.name} · ${appDate(rows[0].created_at)}`)
        .first()
    ).toBeVisible()
    await testInfo.attach("admin-library", {
      body: await adminPage.screenshot({ fullPage: true }),
      contentType: "image/png",
    })
    await adminPage.context().close()
    await page.context().close()
  })
})
