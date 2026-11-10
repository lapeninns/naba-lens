import { expect, test, type Page } from "@playwright/test"

import { signIn } from "../support/identities"
import {
  provisionCoverageWorld,
  type CoverageWorld,
} from "./helpers/coverage-world"
import { supportedMp4, syntheticJpeg } from "./helpers/media"
import { provisioner, requireIsolatedStack } from "./helpers/stack"
import {
  activateSmallMenu,
  activeItemId,
  activeVersionId,
  addFromLibrary,
  addOutsideLink,
  addTab,
  assetIdFor,
  assetIdsNamed,
  assignedTask,
  chooseDish,
  COMMON_FIELD,
  COMMON_FIELD_SEVERAL,
  corruptJpeg,
  countModals,
  doneButton,
  fileRow,
  gate,
  importRailway,
  isFinalise,
  isLabelPost,
  isReserve,
  isSignedPut,
  isTusTransfer,
  keptInput,
  keptLabels,
  labelItems,
  labelsOn,
  modalsOpened,
  phone,
  pickFiles,
  resetModals,
  savingSheet,
  seedUploadingAsset,
  TapCounter,
  uploadState,
} from "./helpers/upload-label-flow"
import { portfolioList, staffTile } from "./helpers/ui"
import { signedInPage } from "./helpers/world"

/**
 * Acceptance regression for the staff upload + labelling flow (audit
 * 2026-11-07, journeys J4b/J5 and failures F2/F3/F10, findings on taps and
 * failed files; contract C1-C5). Uploads start on pick in one "Saving N
 * photos" sheet; labels go to the server by asset id and finalise puts them on
 * the photo. Where a label lands is checked in the database (service role,
 * read-only); every action runs as a signed-in person in a phone-sized
 * context. Taps and modals are counted explicitly, as the audit did.
 *
 * Venue 1 has The Railway food menu (Onion Bhaji, Momo with Veg/Chicken,
 * Spring Roll, Chicken Wings); venue 2 gets small menus of its own for the
 * menu-change case, so venue 1's menu never changes under other tests.
 */

test.describe.configure({ mode: "serial" })

let world: CoverageWorld

test.beforeAll(async ({ browser }) => {
  test.setTimeout(180_000)
  requireIsolatedStack()
  world = await provisionCoverageWorld()
  const admin = await signedInPage(browser, world.admin)
  await importRailway(admin, world.venue1.id)
  await admin.context().close()
})

test.afterEach(async ({ browser }, testInfo) => {
  let n = 0
  for (const context of browser.contexts()) {
    for (const page of context.pages()) {
      n += 1
      const body = await page.screenshot().catch(() => null)
      if (body)
        await testInfo.attach(`final-page-${n}`, {
          body,
          contentType: "image/png",
        })
    }
    await context.close()
  }
})

const unique = (label: string) => `flow-${label}-${world.tag}`
const SAVED_BHAJI = "Saved · Onion Bhaji · waiting for manager review"

/** beforeunload prompts (reload, log out) are accepted, as a person would. */
function acceptPrompts(page: Page) {
  page.on("dialog", (dialog) => void dialog.accept().catch(() => {}))
}

// ---------------------------------------------------------------------------
// a. Labels survive log out and reload; the guard counts unsaved labels
// ---------------------------------------------------------------------------

test("a1 log out while the photo is still saving: its labels land on it with no staff action (F2)", async ({
  browser,
}) => {
  test.setTimeout(180_000)
  const page = await signedInPage(browser, world.staffA, phone(360))
  acceptPrompts(page)
  // Finalise is held until the labels are kept on the server, then runs on
  // the server while its answer is held: the phone still says "Saving…".
  const finalise = await gate(page, isFinalise, { holdResponse: true })
  await page.goto("/staff")
  const photo = await syntheticJpeg(`${unique("a1")}.jpg`)
  const sheet = await addFromLibrary(page, [photo.path])
  await chooseDish(sheet, COMMON_FIELD, "bhaji", /^Onion Bhaji/)

  const id = await assetIdFor(photo.name)
  await finalise.seen
  await expect.poll(() => keptLabels(id), { timeout: 30_000 }).toBe("pending")
  finalise.forward()
  await finalise.answered
  await expect(fileRow(sheet, photo.name)).toContainText("Saving…")

  await doneButton(sheet).click()
  await expect(sheet).toBeHidden()
  await page.getByRole("button", { name: "Log out", exact: true }).click()
  const guard = page.getByRole("alertdialog", { name: "Log out now?" })
  await expect(guard).toContainText("1 upload stops")
  // The server already keeps the labels, so they are not counted as unsaved.
  await expect(guard).not.toContainText("haven't saved yet")
  await guard.getByRole("button", { name: "Log out anyway" }).click()
  // Log out is a Server Action too, queued behind finalise's held answer.
  finalise.deliver()
  await page.waitForURL(/\/login/)

  expect(labelsOn(id)).toBe("Onion Bhaji")
  expect(keptLabels(id)).toBe("")
  expect(uploadState(id)).toBe("ready")
})

test("a2 leaving or logging out warns while labels are not on the server yet; they then save on their own (F2)", async ({
  browser,
}) => {
  test.setTimeout(180_000)
  const page = await signedInPage(browser, world.staffA, phone(360))
  acceptPrompts(page)
  const labelPost = await gate(page, isLabelPost)
  await page.goto("/staff")
  const photo = await syntheticJpeg(`${unique("a2")}.jpg`)
  const sheet = await addFromLibrary(page, [photo.path])
  await chooseDish(sheet, COMMON_FIELD, "bhaji", /^Onion Bhaji/)
  await labelPost.seen
  // The photo itself is saved; only its labels are still on the way.
  await expect(fileRow(sheet, photo.name)).toContainText("Saving labels", {
    timeout: 90_000,
  })
  await doneButton(sheet).click()
  await expect(sheet).toBeHidden()

  await page.getByRole("button", { name: "Log out", exact: true }).click()
  const logoutGuard = page.getByRole("alertdialog", { name: "Log out now?" })
  await expect(logoutGuard).toContainText(
    "Labels for 1 photo haven't saved yet."
  )
  await expect(logoutGuard).not.toContainText("upload stops")
  await logoutGuard.getByRole("button", { name: "Stay" }).click()
  await expect(logoutGuard).toBeHidden()
  await expect(page).toHaveURL(/\/staff$/)

  await (await addOutsideLink(page)).click()
  const leaveGuard = page.getByRole("alertdialog", { name: "Leave now?" })
  await expect(leaveGuard).toContainText(
    "Labels for 1 photo haven't saved yet."
  )
  await leaveGuard.getByRole("button", { name: "Stay" }).click()
  await expect(page).toHaveURL(/\/staff$/)

  const id = assetIdsNamed(photo.name)[0]!
  expect(labelsOn(id)).toBe("")
  labelPost.forward()
  await expect.poll(() => labelsOn(id), { timeout: 30_000 }).toBe("Onion Bhaji")

  // Nothing is left unsaved, so log out goes straight through.
  await expect(addTab(page)).toHaveAccessibleName("Add")
  await page.getByRole("button", { name: "Log out", exact: true }).click()
  await page.waitForURL(/\/login/)
  await expect(page.getByRole("alertdialog")).toHaveCount(0)
})

test("a3 reload mid-upload: picking the same file again puts the kept labels on it, same asset (F3)", async ({
  browser,
}) => {
  test.setTimeout(240_000)
  const page = await signedInPage(browser, world.staffA, phone(360))
  acceptPrompts(page)
  const transfer = await gate(page, isTusTransfer)
  await page.goto("/staff/tasks")
  const video = supportedMp4(`${unique("a3")}.mp4`)
  const sheet = await addFromLibrary(page, [video.path])
  await expect(sheet).toHaveAccessibleName("Saving 1 file")
  await chooseDish(sheet, COMMON_FIELD, "bhaji", /^Onion Bhaji/)
  const id = await assetIdFor(video.name)
  await transfer.seen
  await expect.poll(() => keptLabels(id), { timeout: 30_000 }).toBe("pending")

  await page.reload()
  await expect(savingSheet(page)).toHaveCount(0)
  transfer.forward()

  // The same file again (same name, size and date: the account's resume key
  // reserves the same asset). Staff choose no labels this time.
  const again = await addFromLibrary(page, [video.path])
  await expect(fileRow(again, video.name)).toContainText("Saved", {
    timeout: 120_000,
  })
  // A video is never reviewed for its dish.
  await expect(fileRow(again, video.name)).not.toContainText(
    "waiting for manager review"
  )
  expect(assetIdsNamed(video.name)).toEqual([id])
  await expect.poll(() => labelsOn(id), { timeout: 30_000 }).toBe("Onion Bhaji")
  expect(keptLabels(id)).toBe("")
})

// ---------------------------------------------------------------------------
// b. A dish with variants and none picked saves as "Not specified" (J4b)
// ---------------------------------------------------------------------------

test("b Momo with no variant picked saves as Momo (Not specified)", async ({
  browser,
}) => {
  test.setTimeout(180_000)
  const page = await signedInPage(browser, world.staffA, phone(360))
  await page.goto("/staff/tasks")
  const photo = await syntheticJpeg(`${unique("b")}.jpg`)
  const sheet = await addFromLibrary(page, [photo.path])
  await chooseDish(sheet, COMMON_FIELD, "momo", /^Momo/)

  const question = sheet.getByRole("group", { name: /^Which Momo\?/ })
  await expect(
    question.getByRole("button", { name: "Not specified" })
  ).toHaveAttribute("aria-pressed", "true")
  await expect(
    sheet.getByRole("button", { name: "Remove Momo (Not specified)" })
  ).toBeVisible()
  // No variant chosen: Done straight away.
  await doneButton(sheet).click()
  await expect(sheet).toBeHidden()

  const id = await assetIdFor(photo.name)
  await expect
    .poll(() => labelItems(id), { timeout: 90_000 })
    .toBe("Momo|null|null")

  // Named the same way once saved: Me's photo says Not specified (A2).
  await page.goto("/staff")
  await (await staffTile(portfolioList(page), photo.name)).click()
  const viewer = page.getByRole("dialog").first()
  await expect(
    viewer
      .getByRole("region", { name: "Labels" })
      .getByRole("list", { name: "Menu items" })
      .getByRole("listitem")
  ).toHaveText(["Momo (Not specified) · Appetisers"])
})

// ---------------------------------------------------------------------------
// c. Menu changed mid-upload (F10): Needs attention, Fix labels, no re-upload
// ---------------------------------------------------------------------------

test("c menu changed mid-upload: Needs attention, Fix labels re-picks and saves on the same asset", async ({
  browser,
}) => {
  test.setTimeout(240_000)
  const admin = await signIn(provisioner(), world.admin.email)
  await activateSmallMenu(admin, world.venue2.id, `Flow before ${world.tag}`, {
    Starters: ["Soup", "Salad"],
  })
  const page = await signedInPage(browser, world.staffC, phone(360))
  const transfer = await gate(page, isSignedPut)
  await page.goto("/staff/tasks")
  const photo = await syntheticJpeg(`${unique("c")}.jpg`)
  const sheet = await addFromLibrary(page, [photo.path])
  await chooseDish(sheet, COMMON_FIELD, "soup", /^Soup/)
  const id = await assetIdFor(photo.name)
  await transfer.seen
  await expect.poll(() => keptLabels(id), { timeout: 30_000 }).toBe("pending")

  // The admin activates a menu without Soup before the photo finishes.
  await activateSmallMenu(admin, world.venue2.id, `Flow after ${world.tag}`, {
    Starters: ["Salad"],
    Mains: ["Pie"],
  })
  transfer.forward()

  const row = fileRow(sheet, photo.name)
  await expect(row).toContainText("Needs attention", { timeout: 90_000 })
  await expect(row).toContainText("The menu changed. Check the dish.")
  expect(uploadState(id)).toBe("ready")
  expect(keptLabels(id)).toBe("needs_attention|catalogue_changed")

  const transfers: string[] = []
  page.on("request", (r) => {
    if (isSignedPut(r) || isTusTransfer(r) || isFinalise(r) || isReserve(r))
      transfers.push(`${r.method()} ${r.url()}`)
  })
  await row
    .getByRole("button", { name: `Fix labels for ${photo.name}` })
    .click()
  const fix = page.getByRole("dialog", { name: "Fix labels" })
  const gone = fix.locator('li[data-unavailable="true"]')
  await expect(gone).toContainText("No longer on the menu")
  await gone.getByRole("button", { name: /^Remove / }).click()
  await chooseDish(fix, /^Menu item at /, "pie", /^Pie/)
  await fix.getByRole("button", { name: "Save labels" }).click()
  await expect(fix).toBeHidden()
  await expect(fileRow(savingSheet(page), photo.name)).toContainText(
    "Saved · Pie"
  )

  expect(labelsOn(id)).toBe("Pie")
  expect(keptLabels(id)).toBe("")
  expect(assetIdsNamed(photo.name)).toEqual([id])
  // No reserve, transfer or finalise after the fix: labels only.
  expect(transfers).toEqual([])
})

// ---------------------------------------------------------------------------
// d, e. Taps and modals at phone widths (J5, J1, J3)
// ---------------------------------------------------------------------------

for (const width of [360, 412]) {
  test(`d @${width}: known dish from Our menu in at most 2 taps and 1 modal (J5)`, async ({
    browser,
  }) => {
    test.setTimeout(180_000)
    const page = await signedInPage(browser, world.staffA, phone(width))
    await countModals(page)
    await page.goto("/staff/menu")
    const dish = page.getByRole("article", { name: "Onion Bhaji", exact: true })
    await expect(dish).toBeVisible()
    await resetModals(page)
    const taps = new TapCounter()
    const photo = await syntheticJpeg(`${unique(`d${width}`)}.jpg`)

    const input = await pickFiles(
      page,
      dish.getByRole("button", { name: "Take a photo of this dish" }),
      [photo.path],
      taps
    )
    expect(input.capture).toBe("environment")
    const sheet = savingSheet(page, "Saving 1 photo")
    await expect(sheet).toBeVisible()
    // The dish is already applied, as a chip staff could remove.
    await expect(
      sheet.getByRole("button", { name: "Remove Onion Bhaji" })
    ).toBeVisible()
    await taps.tap(doneButton(sheet), "Done")
    await expect(sheet).toBeHidden()

    const modals = await modalsOpened(page)
    expect(taps.taps, taps.steps.join(" > ")).toBeLessThanOrEqual(2)
    expect(modals.count, modals.names.join(", ")).toBeLessThanOrEqual(1)
    const id = await assetIdFor(photo.name)
    await expect
      .poll(() => labelsOn(id), { timeout: 90_000 })
      .toBe("Onion Bhaji")
  })

  test(`d2 @${width}: Choose from photos on a dish opens the photo library, photos only`, async ({
    browser,
  }) => {
    test.setTimeout(180_000)
    const page = await signedInPage(browser, world.staffA, phone(width))
    await page.goto("/staff/menu")
    const dish = page.getByRole("article", { name: "Onion Bhaji", exact: true })
    await expect(dish).toBeVisible()
    const photo = await syntheticJpeg(`${unique(`d2-${width}`)}.jpg`)

    // The OS picker is the only feedback the tap gives: it must open.
    const input = await pickFiles(
      page,
      dish.getByRole("button", { name: "Choose from photos" }),
      [photo.path]
    )
    expect(input.capture).toBeNull()
    expect(input.multiple).toBe(true)
    expect(input.accept).toContain("image/jpeg")
    expect(input.accept).not.toMatch(/video/)
    const sheet = savingSheet(page, "Saving 1 photo")
    await expect(sheet).toBeVisible()
    await expect(
      sheet.getByRole("button", { name: "Remove Onion Bhaji" })
    ).toBeVisible()
    await doneButton(sheet).click()
    await expect(sheet).toBeHidden()
    const id = await assetIdFor(photo.name)
    await expect
      .poll(() => labelsOn(id), { timeout: 90_000 })
      .toBe("Onion Bhaji")
  })

  test(`e1 @${width}: Add with one dish in at most 5 taps and 2 modals`, async ({
    browser,
  }) => {
    test.setTimeout(180_000)
    const page = await signedInPage(browser, world.staffA, phone(width))
    await countModals(page)
    await page.goto("/staff/tasks")
    await expect(addTab(page)).toBeVisible()
    await resetModals(page)
    const taps = new TapCounter()
    const photo = await syntheticJpeg(`${unique(`e1-${width}`)}.jpg`)

    const sheet = await addFromLibrary(page, [photo.path], taps)
    await chooseDish(sheet, COMMON_FIELD, "bhaji", /^Onion Bhaji/, taps)
    await taps.tap(doneButton(sheet), "Done")
    await expect(sheet).toBeHidden()

    const modals = await modalsOpened(page)
    expect(taps.taps, taps.steps.join(" > ")).toBeLessThanOrEqual(5)
    expect(modals.count, modals.names.join(", ")).toBeLessThanOrEqual(2)
    const id = await assetIdFor(photo.name)
    await expect
      .poll(() => labelsOn(id), { timeout: 90_000 })
      .toBe("Onion Bhaji")
  })

  test(`e2 @${width}: batch of 3 with one exception in at most 8 taps`, async ({
    browser,
  }) => {
    test.setTimeout(240_000)
    const page = await signedInPage(browser, world.staffA, phone(width))
    await countModals(page)
    await page.goto("/staff/tasks")
    await expect(addTab(page)).toBeVisible()
    await resetModals(page)
    const taps = new TapCounter()
    const photos = await Promise.all(
      [1, 2, 3].map((n) => syntheticJpeg(`${unique(`e2-${width}`)}-${n}.jpg`))
    )

    const sheet = await addFromLibrary(
      page,
      photos.map((p) => p.path),
      taps
    )
    await expect(sheet).toHaveAccessibleName("Saving 3 photos")
    await chooseDish(
      sheet,
      COMMON_FIELD_SEVERAL,
      "spring roll",
      /^Spring Roll/,
      taps
    )
    await taps.tap(
      sheet.getByRole("button", { name: "Adjust labels for photo 3" }),
      "Adjust photo 3"
    )
    await chooseDish(
      sheet,
      /for photo 3$/,
      "chicken wings",
      /^Chicken Wings/,
      taps
    )
    await taps.tap(doneButton(sheet), "Done")
    await expect(sheet).toBeHidden()

    const modals = await modalsOpened(page)
    expect(taps.taps, taps.steps.join(" > ")).toBeLessThanOrEqual(8)
    expect(modals.count, modals.names.join(", ")).toBeLessThanOrEqual(2)
    const ids = await Promise.all(photos.map((p) => assetIdFor(p.name)))
    await expect
      .poll(() => ids.map(labelsOn), { timeout: 120_000 })
      .toEqual(["Spring Roll", "Spring Roll", "Chicken Wings,Spring Roll"])
  })
}

// ---------------------------------------------------------------------------
// f. A photo is labelled and selectable on its task before a slow video ends
// ---------------------------------------------------------------------------

test("f photo batched with a slow video is labelled and selectable on the task screen before the video finishes", async ({
  browser,
}) => {
  test.setTimeout(240_000)
  const title = `Flow back bar ${world.tag}`
  // Staff B: no earlier uploads, so the task screen lists only this photo.
  const taskId = await assignedTask(world, world.staffB, title)
  const page = await signedInPage(browser, world.staffB, phone(412))
  // The audit's 25-second video: its transfer waits until the photo checks
  // are done, so "before the video finishes" never depends on timing.
  const transfer = await gate(page, isTusTransfer)
  await page.goto(`/staff/tasks/${taskId}`)
  await expect(
    page.getByRole("heading", { level: 1, name: title })
  ).toBeVisible()
  const photo = await syntheticJpeg(`${unique("f")}.jpg`)
  const video = supportedMp4(`${unique("f")}.mp4`)

  const sheet = await addFromLibrary(page, [photo.path, video.path])
  await expect(sheet).toHaveAccessibleName("Saving 2 files")
  await chooseDish(sheet, COMMON_FIELD_SEVERAL, "bhaji", /^Onion Bhaji/)
  await expect(fileRow(sheet, photo.name)).toContainText(SAVED_BHAJI, {
    timeout: 90_000,
  })
  await expect(fileRow(sheet, video.name)).toContainText("Saving…")
  const photoId = await assetIdFor(photo.name)
  const videoId = await assetIdFor(video.name)
  expect(labelsOn(photoId)).toBe("Onion Bhaji")

  await doneButton(sheet).click()
  await expect(sheet).toBeHidden()
  const tile = page
    .getByRole("list", { name: "Your photos" })
    .getByRole("button", { name: /^Photo uploaded/ })
  await expect(tile).toHaveCount(1, { timeout: 30_000 })
  await expect(tile).not.toHaveAttribute("aria-disabled", "true")
  await tile.click()
  await expect(tile).toHaveAttribute("aria-pressed", "true")
  await expect(page.getByText("1 selected · up to 10")).toBeVisible()
  expect(uploadState(videoId)).toBe("uploading")

  transfer.forward()
  await expect
    .poll(() => labelsOn(videoId), { timeout: 120_000 })
    .toBe("Onion Bhaji")
})

// ---------------------------------------------------------------------------
// g. A file that can't be processed: reason and Remove only
// ---------------------------------------------------------------------------

test("g a file that can't be processed shows its reason with Remove only", async ({
  browser,
}) => {
  test.setTimeout(180_000)
  const page = await signedInPage(browser, world.staffA, phone(360))
  // Finalise waits until the labels are kept, so the file fails with labels.
  const finalise = await gate(page, isFinalise)
  await page.goto("/staff/tasks")
  const bad = await corruptJpeg(`${unique("g")}.jpg`)
  const sheet = await addFromLibrary(page, [bad.path])
  await chooseDish(sheet, COMMON_FIELD, "bhaji", /^Onion Bhaji/)
  const id = await assetIdFor(bad.name)
  await finalise.seen
  await expect.poll(() => keptLabels(id), { timeout: 30_000 }).toBe("pending")
  finalise.forward()

  const row = fileRow(sheet, bad.name)
  await expect(row).toContainText(/This file can't be used: .+\./, {
    timeout: 60_000,
  })
  await expect(row).toContainText("Needs attention")
  // On the row or in the label panel's photo list, wherever the sheet puts it.
  await expect(
    sheet.getByText("Not saved (photo not saved)").first()
  ).toBeVisible()
  await expect(
    row.getByRole("button", { name: `Remove ${bad.name}` })
  ).toBeVisible()
  await expect(row.getByRole("button", { name: /^Retry/ })).toHaveCount(0)
  await expect(sheet).not.toContainText("Labels will save")
  expect(uploadState(id)).toBe("failed")
  expect(keptLabels(id)).toBe("")
  expect(labelsOn(id)).toBe("")
})

// ---------------------------------------------------------------------------
// h. Kept labels are the uploader's own over HTTP (row 9 isolation)
// ---------------------------------------------------------------------------

test("h another staff account cannot read, apply or delete someone else's kept labels via /api/upload-labels", async ({
  browser,
}) => {
  test.setTimeout(180_000)
  const venueId = world.venue1.id
  const assetId = await seedUploadingAsset(
    world.staffA.id,
    venueId,
    `${unique("h")}.jpg`
  )
  const input = (items: { itemId: string; variantId: null }[]) => ({
    venueId,
    input: {
      assetId,
      expectedRevision: 0,
      catalogueVersionId: activeVersionId(venueId),
      contentTypes: [],
      note: null,
      items,
      missingItem: null,
    },
  })
  const bhaji = activeItemId(venueId, "appetisers--onion-bhaji")
  const wings = activeItemId(venueId, "appetisers--chicken-wings")

  const owner = await signedInPage(browser, world.staffA)
  const stored = await owner.request.post("/api/upload-labels", {
    data: input([{ itemId: bhaji, variantId: null }]),
  })
  expect(stored.status()).toBe(200)
  expect(await stored.json()).toEqual({ ok: true, assetId, state: "pending" })
  const ownList = await owner.request.get("/api/upload-labels?attention=1")
  expect(
    ((await ownList.json()).items as { assetId: string }[]).map(
      (i) => i.assetId
    )
  ).toContain(assetId)
  const before = keptInput(assetId)
  expect(before).toContain(bhaji)

  // Staff B shares the venue; staff C works at another venue.
  for (const other of [world.staffB, world.staffC]) {
    const page = await signedInPage(browser, other)
    const list = await page.request.get("/api/upload-labels?attention=1")
    expect(list.status()).toBe(200)
    const body = await list.json()
    expect(body.ok).toBe(true)
    expect(
      (body.items as { assetId: string }[]).map((i) => i.assetId)
    ).not.toContain(assetId)

    const apply = await page.request.post("/api/upload-labels", {
      data: input([{ itemId: wings, variantId: null }]),
    })
    expect(apply.status()).toBe(404)
    expect(await apply.json()).toMatchObject({
      ok: false,
      code: "not_found",
    })

    const discard = await page.request.delete(
      `/api/upload-labels?assetId=${assetId}`
    )
    expect(discard.status()).toBe(200)
    // Exactly "none": not their draft and not their photo, so never
    // already_applied and never the owner's labels.
    expect(await discard.json()).toEqual({ ok: true, state: "none" })
    expect(keptLabels(assetId)).toBe("pending")
    expect(keptInput(assetId)).toBe(before)
    await page.context().close()
  }

  const anon = await browser.newContext()
  const anonList = await anon.request.get("/api/upload-labels?attention=1")
  expect(anonList.status()).toBe(401)
  expect((await anonList.json()).items).toBeUndefined()

  // The owner can still discard their own.
  const own = await owner.request.delete(
    `/api/upload-labels?assetId=${assetId}`
  )
  expect(own.status()).toBe(200)
  expect(await own.json()).toEqual({ ok: true, state: "discarded" })
  expect(keptLabels(assetId)).toBe("")
  expect(labelsOn(assetId)).toBe("")
})
