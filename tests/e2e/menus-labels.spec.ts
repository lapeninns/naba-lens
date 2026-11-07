import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

import { expect, test, type Locator, type Page } from "@playwright/test"

import { isFinalise } from "../fixtures/uploads/support"
import { signIn, type Db } from "../support/identities"
import {
  sha256,
  supportedMp4,
  syntheticJpeg,
  type SourceFile,
} from "./helpers/media"
import { provisioner, psql, requireIsolatedStack } from "./helpers/stack"
import {
  chooseOption,
  escape,
  libraryList,
  portfolioList,
  savingTitle,
  staffTile,
  uploadSheet,
  uploadThroughDialog,
  openPortfolio,
} from "./helpers/ui"
import {
  provisionWorld,
  seedReadyAssets,
  signedInPage,
  type Person,
  type World,
} from "./helpers/world"

/**
 * v0.3 QA (packet J): staff labelling and admin library discovery on the
 * isolated stack. Contract §7 rows 5 (photo + video labelled with several
 * items), 6 (skip, label later), 7 (batch + per-file override persists),
 * 8 (missing item; catalogue changed while editing), 9 (own-only through the
 * real Server Function), 11 (transfer: old asset uses the old venue's menu),
 * 12 (admin correction, combined filters, search, dates, stable pagination)
 * and 13 (original bytes unchanged).
 *
 * Menus come from the DEV FIXTURE files; media is synthetic. Bulk fixture
 * labels for the library checks go through the real `save_media_labels` RPC
 * as each uploader (their own session).
 */

test.describe.configure({ mode: "serial" })
test.beforeAll(() => requireIsolatedStack())

// Journey evidence: the final state of every page the test left open.
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
  }
})

const fixture = (name: string) =>
  fileURLToPath(new URL(`../fixtures/menus/${name}`, import.meta.url))
const RAILWAY = fixture("the-railway.food.json")
const PRINCE = fixture("the-prince-of-wales.food.json")
const RAILWAY_TITLE = "The Railway food (DEV FIXTURE)"
const PRINCE_TITLE = "The Prince of Wales food (DEV FIXTURE)"

const sql = (v: string) => `'${v.replace(/'/g, "''")}'`
const activeVersionId = (venueId: string) =>
  psql(
    `select id from public.menu_versions where venue_id = ${sql(venueId)} and status = 'active'`
  )
function activeItemId(venueId: string, sourceKey: string) {
  const id = psql(`select e.item_id from public.menu_entries e
    join public.menu_versions v on v.id = e.version_id
    where v.venue_id = ${sql(venueId)} and v.status = 'active' and e.source_key = ${sql(sourceKey)}`)
  if (!id) throw new Error(`No active item ${sourceKey}`)
  return id
}
const activeVariantId = (venueId: string, sourceKey: string, name: string) =>
  psql(`select ev.variant_id from public.menu_entry_variants ev
    join public.menu_entries e on e.id = ev.entry_id
    join public.menu_versions v on v.id = e.version_id
    where v.venue_id = ${sql(venueId)} and v.status = 'active'
      and e.source_key = ${sql(sourceKey)} and lower(ev.name) = lower(${sql(name)})`)

const sessions = new Map<string, Db>()
async function labelAsUploader(
  who: Person,
  venueId: string,
  assetId: string,
  items: { itemId: string; variantId?: string | null }[],
  contentTypes: string[] = [],
  note: string | null = null
) {
  let client = sessions.get(who.email)
  if (!client) {
    client = await signIn(provisioner(), who.email)
    sessions.set(who.email, client)
  }
  const { error } = await client.rpc("save_media_labels", {
    p_asset_id: assetId,
    p_expected_revision: 0,
    p_content_types: contentTypes,
    p_note: note as string,
    p_items: items.map((i) => ({
      itemId: i.itemId,
      variantId: i.variantId ?? null,
    })),
    p_missing_item: null as unknown as string,
    p_catalogue_version_id: activeVersionId(venueId),
  })
  if (error) throw new Error(`fixture label save failed: ${error.message}`)
}

async function importAndActivate(
  page: Page,
  venue: { id: string; name: string },
  path: string,
  title: string
) {
  await page.goto(`/admin/menus/${venue.id}`)
  await expect(
    page.getByRole("heading", { level: 1, name: venue.name })
  ).toBeVisible()
  await page.getByRole("button", { name: "Import a menu" }).click()
  await page.getByLabel("Menu file (JSON or CSV)").setInputFiles(path)
  await expect(
    page.getByRole("region", { name: "Changes from the active menu" })
  ).toBeVisible()
  await page.getByRole("button", { name: "Create draft" }).click()
  await page.waitForURL(/\/admin\/menus\/versions\//)
  await expect(
    page.getByRole("heading", { level: 1, name: title })
  ).toBeVisible()
  await page.getByRole("button", { name: "Activate for labelling" }).click()
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Activate for labelling" })
    .click()
  await expectActive(page, `More actions for ${title}`)
}

/** An active version offers a new draft from it, and Retire under More actions. */
async function expectActive(page: Page, moreActions: string | RegExp) {
  await expect(
    page.getByRole("button", { name: "Start a draft from this version" })
  ).toBeVisible()
  await page.getByRole("button", { name: moreActions }).click()
  await expect(page.getByRole("menuitem", { name: "Retire" })).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(page.getByRole("menuitem", { name: "Retire" })).toBeHidden()
}

async function withRailway(
  browser: import("@playwright/test").Browser,
  world: World
) {
  const admin = await signedInPage(browser, world.adminA)
  await importAndActivate(admin, world.venue1, RAILWAY, RAILWAY_TITLE)
  return admin
}

const tileName = (kind: "Photo" | "Video", file: string) =>
  new RegExp(`^${kind}, ${escape(file)}`)

async function openOwn(page: Page, file: string) {
  await (await staffTile(portfolioList(page), file)).click()
  const viewer = page.getByRole("dialog").first()
  await expect(viewer.getByRole("region", { name: "Labels" })).toBeVisible()
  return viewer
}

async function openEditorFromViewer(page: Page, viewer: Locator) {
  await viewer.getByRole("button", { name: /^(Add|Edit) labels$/ }).click()
  const editor = page.getByRole("dialog", { name: /^(Labels|Edit labels)$/ })
  await expect(editor).toBeVisible()
  return editor
}

async function pick(
  editor: Locator,
  comboName: RegExp | string,
  query: string,
  option: RegExp
) {
  await editor.getByRole("combobox", { name: comboName }).fill(query)
  await editor.getByRole("option", { name: option }).click()
}

const tileLabels = (list: Locator) =>
  list
    .getByRole("button")
    .evaluateAll((els) => els.map((el) => el.getAttribute("aria-label") ?? ""))

/**
 * Opens the upload sheet from My portfolio and picks the files: they start
 * saving at once, and the sheet becomes "Saving N photos/files" with the
 * optional labels ("What's in these photos?") inline.
 */
async function pickInSheet(page: Page, files: SourceFile[]) {
  await page
    .getByRole("button", { name: "Upload photos or videos" })
    .first()
    .click()
  const sheet = uploadSheet(page)
  await expect(sheet).toBeVisible()
  await sheet
    .getByLabel("Choose photos or videos")
    .setInputFiles(files.map((f) => f.path))
  await expect(sheet).toHaveAccessibleName(savingTitle(files))
  await expect(sheet.getByRole("list", { name: "Files" })).toBeVisible()
  return sheet
}

/**
 * Holds every finalise Server Function call of the page until `release()`, so
 * the files stay unfinished (uploading) while labels are chosen: the labels
 * are then kept on the server and finalise puts them on the photo.
 */
async function holdFinalise(page: Page) {
  let open!: () => void
  const held = new Promise<void>((resolve) => (open = resolve))
  await page.route("**/staff", async (route) => {
    if (isFinalise(route.request())) await held
    await route.continue()
  })
  return {
    release: () => open(),
    stop: () => page.unroute("**/staff"),
  }
}

test("rows 5+7: photo + video uploaded, batch-labelled with per-file overrides; persists after reload", async ({
  browser,
}) => {
  test.setTimeout(240_000)
  const world = await provisionWorld()
  await withRailway(browser, world)
  const staff = await signedInPage(browser, world.staffA)
  await openPortfolio(staff)
  const photo = await syntheticJpeg(`qa-batch-photo-${world.tag}.jpg`)
  const video = supportedMp4(`qa-batch-video-${world.tag}.mp4`)
  const note = `QA common note ${world.tag}`
  const videoNote = `QA video-only note ${world.tag}`

  // The files start saving as soon as they are picked; finalise is held so
  // they are still unfinished while the labels are chosen in the sheet.
  const finalise = await holdFinalise(staff)
  const editor = await pickInSheet(staff, [photo, video])
  await expect(
    editor.getByRole("combobox", {
      name: "What's in these photos? (optional) for all files",
    })
  ).toBeVisible()

  await test.step("common selection: two items (one with a variant), a content type, a note", async () => {
    await pick(
      editor,
      "What's in these photos? (optional) for all files",
      "momo",
      /^Momo Appetisers/
    )
    await editor
      .getByRole("group", { name: /^Which Momo\?/ })
      .getByRole("button", { name: "Chicken" })
      .click()
    await pick(
      editor,
      "What's in these photos? (optional) for all files",
      "onion bhaji",
      /^Onion Bhaji Appetisers/
    )
    await expect(
      editor
        .getByRole("list", { name: "Selected menu items for all files" })
        .getByRole("listitem")
    ).toHaveCount(2)
    await editor
      .getByRole("button", { name: "More details for all photos" })
      .click()
    const types = editor.getByRole("group", {
      name: /^What's in the photo .* for all files$/,
    })
    await types.getByRole("button", { name: "Finished dish" }).click()
    await expect(
      types.getByRole("button", { name: "Finished dish" })
    ).toHaveAttribute("aria-pressed", "true")
    await editor
      .getByRole("textbox", { name: "Note (optional) for all files" })
      .fill(note)
  })

  await test.step("per-file override on the video: drop an item, add a type, own note", async () => {
    await editor
      .getByRole("button", { name: "Adjust labels for video 2" })
      .click()
    // The file's own fields search this venue's menu.
    await expect(
      editor.getByRole("combobox", {
        name: `Menu item at ${world.venue1.name} (optional) for video 2`,
      })
    ).toBeVisible()
    const items = editor.getByRole("list", {
      name: "Selected menu items for video 2",
    })
    await items
      .getByRole("button", { name: "Remove Onion Bhaji for video 2" })
      .click()
    await editor
      .getByRole("group", { name: /^What's in the video .* for video 2$/ })
      .getByRole("button", { name: "Preparation" })
      .click()
    await editor
      .getByRole("textbox", { name: "Note (optional) for video 2" })
      .fill(videoNote)
    const files = editor.getByRole("list", { name: "Your photos" })
    await expect(
      files.getByRole("listitem").filter({ hasText: "Photo 1" })
    ).toContainText(
      /(Momo \(Chicken\), Onion Bhaji|Onion Bhaji, Momo \(Chicken\)) · 1 content type · note/
    )
    await expect(
      files.getByRole("listitem").filter({ hasText: "Video 2" })
    ).toContainText("Momo (Chicken) · 2 content types · note")
  })

  await test.step("labels are kept on the server while the files are unfinished, then saved with them", async () => {
    // No Save button: each file's labels go to the server by asset id.
    await expect
      .poll(
        () =>
          psql(`select string_agg(a.original_filename || ':' || jsonb_array_length(p.input->'items')
              || ':' || jsonb_array_length(p.input->'contentTypes') || ':' || coalesce(p.input->>'note', ''),
              '|' order by a.original_filename)
            from public.media_pending_labels p join public.media_assets a on a.id = p.asset_id
            where a.uploader_id = ${sql(world.staffA.id)}`),
        { timeout: 30_000 }
      )
      .toBe(`${photo.name}:2:1:${note}|${video.name}:1:2:${videoNote}`)
    finalise.release()
    // A row shows "Saved" only once its labels are on the file.
    await expect(editor.getByRole("status")).toHaveText("2 saved", {
      timeout: 90_000,
    })
    await finalise.stop()
    for (const name of [photo.name, video.name])
      await expect(
        editor
          .getByRole("list", { name: "Files" })
          .getByRole("listitem")
          .filter({ has: staff.getByText(name, { exact: true }) })
      ).toContainText(
        /Saved · .*Momo \(Chicken\).* · waiting for manager review/
      )
    await editor.getByRole("button", { name: "Done" }).click()
    await expect(editor).toBeHidden()
  })

  await test.step("reload: both files keep exactly what was saved", async () => {
    await staff.goto("/staff")
    const list = portfolioList(staff)
    await expect(await staffTile(list, photo.name)).toHaveAccessibleName(
      /, 3 labels$/
    )
    await expect(await staffTile(list, video.name)).toHaveAccessibleName(
      /, 3 labels$/
    )

    const p = await openOwn(staff, photo.name)
    const pl = p.getByRole("region", { name: "Labels" })
    await expect(
      pl.getByRole("list", { name: "Menu items" }).getByRole("listitem")
    ).toHaveText([
      /Onion Bhaji · Appetisers|Momo \(Chicken\) · Appetisers/,
      /Onion Bhaji · Appetisers|Momo \(Chicken\) · Appetisers/,
    ])
    await expect(pl.getByRole("list", { name: "Menu items" })).toContainText(
      "Momo (Chicken)"
    )
    await expect(
      pl.getByRole("list", { name: "Content types" }).getByRole("listitem")
    ).toHaveText(["Finished dish"])
    await expect(pl).toContainText(note)
    await staff.keyboard.press("Escape")

    const v = await openOwn(staff, video.name)
    const vl = v.getByRole("region", { name: "Labels" })
    await expect(
      vl.getByRole("list", { name: "Menu items" }).getByRole("listitem")
    ).toHaveText(["Momo (Chicken) · Appetisers"])
    await expect(
      vl.getByRole("list", { name: "Content types" }).getByRole("listitem")
    ).toHaveText(["Finished dish", "Preparation"])
    await expect(vl).toContainText(videoNote)
    await expect(vl).not.toContainText(note)
  })

  // One asset per file, one label row each, first revision; no duplicates.
  expect(
    psql(`select count(*) || '/' || count(distinct l.asset_id) || '/' || max(l.revision)
      from public.media_assets a join public.media_labels l on l.asset_id = a.id
      where a.uploader_id = ${sql(world.staffA.id)} and a.deleted_at is null`)
  ).toBe("2/2/1")
})

test("row 6: skip labelling at upload, label later from the viewer; the asset is in the admin library either way", async ({
  browser,
}) => {
  test.setTimeout(180_000)
  const world = await provisionWorld()
  const admin = await withRailway(browser, world)
  const staff = await signedInPage(browser, world.staffA)
  await openPortfolio(staff)
  const photo = await syntheticJpeg(`qa-later-${world.tag}.jpg`)

  // Labels are offered in the sheet ("What's in these photos?") but optional:
  // the photo saves without them and Done closes the sheet.
  await uploadThroughDialog(staff, [photo], { close: false })
  const upload = uploadSheet(staff)
  await expect(
    upload.getByRole("combobox", {
      name: "What's in these photos? (optional)",
    })
  ).toBeVisible()
  await expect(upload.getByRole("status")).toHaveText("1 saved")
  await upload.getByRole("button", { name: "Done" }).click()
  await expect(upload).toBeHidden()

  await expect(
    await staffTile(portfolioList(staff), photo.name)
  ).toHaveAccessibleName(/, Needs labels$/)
  await admin.goto("/admin")
  await expect(
    libraryList(admin).getByRole("button", {
      name: tileName("Photo", photo.name),
    })
  ).toBeVisible()

  const viewer = await openOwn(staff, photo.name)
  await expect(viewer.getByRole("region", { name: "Labels" })).toContainText(
    "None yet. Labels are optional."
  )
  const later = await openEditorFromViewer(staff, viewer)
  await pick(later, /^Menu item at /, "sherpali", /^Sherpali Chicken/)
  const which = later.getByRole("group", { name: /^Which Sherpali Chicken\?/ })
  if (await which.isVisible())
    await which.getByRole("button", { name: "Not specified" }).click()
  await later.getByRole("button", { name: "Plating" }).click()
  await later.getByRole("button", { name: /^Save labels/ }).click()
  await expect(later).toBeHidden()
  const labels = viewer.getByRole("region", { name: "Labels" })
  await expect(labels.getByRole("list", { name: "Menu items" })).toContainText(
    "Sherpali Chicken"
  )
  await expect(labels.getByRole("list", { name: "Content types" })).toHaveText(
    "Plating"
  )
  await staff.keyboard.press("Escape")
  await staff.reload()
  await expect(
    await staffTile(portfolioList(staff), photo.name)
  ).toHaveAccessibleName(/, 2 labels$/)
})

test("row 8: missing-item suggestion reaches the admin; catalogue changed while editing is recoverable", async ({
  browser,
}) => {
  test.setTimeout(240_000)
  const world = await provisionWorld()
  const admin = await withRailway(browser, world)
  const prefix = `qa-miss-${world.tag}`
  await seedReadyAssets(world.staffA.id, world.venue1.id, 2, "image", prefix)
  const staff = await signedInPage(browser, world.staffA)
  const missing = `QA lamb shank special ${world.tag}`

  await test.step("staff suggests an item not on the menu", async () => {
    await staff.goto("/staff")
    const viewer = await openOwn(staff, `${prefix}-01.jpg`)
    const editor = await openEditorFromViewer(staff, viewer)
    await editor.getByRole("button", { name: "Item not on the menu?" }).click()
    await editor
      .getByRole("textbox", { name: "Missing menu item" })
      .fill(missing)
    await editor.getByRole("button", { name: /^Save labels/ }).click()
    await expect(editor).toBeHidden()
    await expect(viewer.getByRole("region", { name: "Labels" })).toContainText(
      `Suggested missing item: ${missing}`
    )
    await staff.keyboard.press("Escape")
  })

  await test.step("admin sees it on the venue's Menus page and links it to an item", async () => {
    await admin.goto(`/admin/menus/${world.venue1.id}`)
    await expect(
      admin.getByRole("region", { name: "Missing-item suggestions" })
    ).toContainText("1 · typed by staff while labelling")
    const list = admin.getByRole("list", { name: "Missing-item suggestions" })
    await expect(list).toContainText(missing)
    await expect(list).toContainText(`Suggested by ${world.staffA.name}`)
    const link = list.getByRole("button", {
      name: `Link to an item: “${missing}”`,
    })
    // The first press opens the item picker; the second links.
    await link.click()
    await chooseOption(
      admin,
      list,
      `Menu item for “${missing}”`,
      "Lamb Chops (Appetisers)"
    ).catch(async () => {
      await list
        .getByRole("combobox", { name: `Menu item for “${missing}”` })
        .click()
      await admin
        .getByRole("option", { name: /^Lamb Chops/ })
        .first()
        .click()
    })
    await link.click()
    await expect(
      admin.getByRole("region", { name: "Missing-item suggestions" })
    ).toContainText("0 · typed by staff while labelling")
    expect(
      psql(
        `select status from public.menu_item_suggestions where suggested_name = ${sql(missing)}`
      )
    ).toBe("resolved")
  })

  await test.step("a new menu is activated while staff are editing: recoverable, nothing lost", async () => {
    await staff.goto("/staff")
    const viewer = await openOwn(staff, `${prefix}-02.jpg`)
    const editor = await openEditorFromViewer(staff, viewer)
    await pick(
      editor,
      /^Menu item at /,
      "onion bhaji",
      /^Onion Bhaji Appetisers/
    )
    await editor.getByRole("button", { name: "Kitchen" }).click()

    // Another page: a new version of the same menu becomes active.
    await admin.goto(`/admin/menus/${world.venue1.id}`)
    await admin
      .getByRole("button", { name: "Start a draft from the active menu" })
      .click()
    await admin.waitForURL(/\/admin\/menus\/versions\//)
    await admin.getByRole("button", { name: "Activate for labelling" }).click()
    await admin
      .getByRole("alertdialog")
      .getByRole("button", { name: "Activate for labelling" })
      .click()
    await expectActive(admin, /^More actions for /)

    await editor.getByRole("button", { name: /^Save labels/ }).click()
    await expect(editor).toContainText(
      "The menu for this venue was updated while you were editing"
    )
    // Nothing was saved and the choices are still on screen.
    expect(
      psql(`select count(*) from public.media_labels l join public.media_assets a on a.id = l.asset_id
        where a.original_filename = ${sql(`${prefix}-02.jpg`)}`)
    ).toBe("0")
    await expect(
      editor.getByRole("list", { name: /^Selected menu items/ })
    ).toContainText("Onion Bhaji")
    await editor.getByRole("button", { name: "Reload the menu" }).click()
    // Save only once the reloaded menu is back (saving earlier is refused
    // again, recoverably, because it still names the old menu version).
    await expect(editor.getByText("Loading the menu…")).toHaveCount(0)
    await expect(
      editor.getByRole("combobox", { name: /^Menu item at / })
    ).toBeVisible()
    await editor.getByRole("button", { name: /^Save labels/ }).click()
    await expect(editor).toBeHidden()
    const labels = viewer.getByRole("region", { name: "Labels" })
    await expect(
      labels.getByRole("list", { name: "Menu items" })
    ).toContainText("Onion Bhaji")
    await expect(
      labels.getByRole("list", { name: "Content types" })
    ).toHaveText("Kitchen")
  })
})

test("row 9: staff B cannot label staff A's asset, even by rewriting the Server Function call", async ({
  browser,
}) => {
  test.setTimeout(180_000)
  const world = await provisionWorld()
  await withRailway(browser, world)
  const [assetA] = await seedReadyAssets(
    world.staffA.id,
    world.venue1.id,
    1,
    "image",
    `qa-own-a-${world.tag}`
  )
  const [assetB] = await seedReadyAssets(
    world.staffB.id,
    world.venue1.id,
    1,
    "image",
    `qa-own-b-${world.tag}`
  )
  const staffB = await signedInPage(browser, world.staffB)

  await test.step("UI: staff B's portfolio never lists A's file", async () => {
    await staffB.goto("/staff")
    await expect(portfolioList(staffB).getByRole("button")).toHaveCount(1)
    await expect(
      await staffTile(portfolioList(staffB), `qa-own-a-${world.tag}-01.jpg`)
    ).toHaveCount(0)
  })

  await test.step("Server Function: B's save rewritten to A's asset id is refused", async () => {
    const viewer = await openOwn(staffB, `qa-own-b-${world.tag}-01.jpg`)
    const editor = await openEditorFromViewer(staffB, viewer)
    await pick(
      editor,
      /^Menu item at /,
      "onion bhaji",
      /^Onion Bhaji Appetisers/
    )
    let rewritten = 0
    await staffB.route("**/*", async (route) => {
      const req = route.request()
      const body = req.postData()
      if (
        req.method() === "POST" &&
        req.headers()["next-action"] &&
        body?.includes(assetB)
      ) {
        rewritten++
        return route.continue({ postData: body.replaceAll(assetB, assetA) })
      }
      return route.continue()
    })
    await editor.getByRole("button", { name: /^Save labels/ }).click()
    await expect.poll(() => rewritten).toBeGreaterThan(0)
    await expect(
      editor
        .getByText(
          /not saved|could not be saved|couldn't be saved|not confirmed/i
        )
        .first()
    ).toBeVisible()
    await staffB.unroute("**/*")
    expect(
      psql(
        `select count(*) from public.media_labels where asset_id in (${sql(assetA)}, ${sql(assetB)})`
      )
    ).toBe("0")
  })

  await test.step("RPC as staff B (own session) on A's asset: refused", async () => {
    const client = await signIn(provisioner(), world.staffB.email)
    const { error } = await client.rpc("save_media_labels", {
      p_asset_id: assetA,
      p_expected_revision: 0,
      p_content_types: ["dish"],
      p_note: null as unknown as string,
      p_items: [],
      p_missing_item: null as unknown as string,
      p_catalogue_version_id: null as unknown as string,
    })
    expect(error, "staff B must not label staff A's asset").not.toBeNull()
    expect(
      psql(
        `select count(*) from public.media_labels where asset_id = ${sql(assetA)}`
      )
    ).toBe("0")
  })

  await test.step("RPC: staff C (venue 2) cannot attach a venue 1 item to their own asset", async () => {
    const [assetC] = await seedReadyAssets(
      world.staffC.id,
      world.venue2.id,
      1,
      "image",
      `qa-own-c-${world.tag}`
    )
    const client = await signIn(provisioner(), world.staffC.email)
    const { error } = await client.rpc("save_media_labels", {
      p_asset_id: assetC,
      p_expected_revision: 0,
      p_content_types: [],
      p_note: null as unknown as string,
      p_items: [
        {
          itemId: activeItemId(world.venue1.id, "appetisers--onion-bhaji"),
          variantId: null,
        },
      ],
      p_missing_item: null as unknown as string,
      p_catalogue_version_id: activeVersionId(world.venue1.id),
    })
    expect(error?.message ?? "").toMatch(
      /menu_item_wrong_venue|menu_item_unavailable|catalogue/
    )
    expect(
      psql(
        `select count(*) from public.media_label_items where asset_id = ${sql(assetC)}`
      )
    ).toBe("0")
  })
})

test("row 11: a transferred staff member labels an older asset with the old venue's menu", async ({
  browser,
}) => {
  test.setTimeout(240_000)
  const world = await provisionWorld()
  const admin = await withRailway(browser, world)
  await importAndActivate(admin, world.venue2, PRINCE, PRINCE_TITLE)
  const [oldAsset] = await seedReadyAssets(
    world.staffA.id,
    world.venue1.id,
    1,
    "image",
    `qa-old-${world.tag}`
  )
  const { error } = await provisioner()
    .from("profiles")
    .update({ venue_id: world.venue2.id })
    .eq("id", world.staffA.id)
  if (error) throw error
  await seedReadyAssets(
    world.staffA.id,
    world.venue2.id,
    1,
    "image",
    `qa-new-${world.tag}`
  )

  const staff = await signedInPage(browser, world.staffA)
  await staff.goto("/staff")
  await expect(
    staff.getByText(world.venue2.name, { exact: false }).first()
  ).toBeVisible()

  const oldViewer = await openOwn(staff, `qa-old-${world.tag}-01.jpg`)
  const oldEditor = await openEditorFromViewer(staff, oldViewer)
  await expect(
    oldEditor.getByRole("combobox", {
      name: `Menu item at ${world.venue1.name}`,
    })
  ).toBeVisible()
  await oldEditor
    .getByRole("combobox", { name: /^Menu item at / })
    .fill("Stuffed Tandoori")
  await expect(
    oldEditor
      .getByText(`Nothing on ${world.venue1.name}'s menu matches`, {
        exact: false,
      })
      .first()
  ).toBeVisible()
  await pick(oldEditor, /^Menu item at /, "sherpali", /^Sherpali Chicken/)
  const which = oldEditor.getByRole("group", {
    name: /^Which Sherpali Chicken\?/,
  })
  if (await which.isVisible())
    await which.getByRole("button", { name: "Not specified" }).click()
  await oldEditor.getByRole("button", { name: /^Save labels/ }).click()
  await expect(oldEditor).toBeHidden()
  await expect(
    oldViewer.getByRole("list", { name: "Menu items" })
  ).toContainText("Sherpali Chicken")
  expect(
    psql(`select distinct i.venue_id from public.media_label_items li join public.menu_items i on i.id = li.item_id
      where li.asset_id = ${sql(oldAsset)}`)
  ).toBe(world.venue1.id)
  await staff.keyboard.press("Escape")

  const newViewer = await openOwn(staff, `qa-new-${world.tag}-01.jpg`)
  const newEditor = await openEditorFromViewer(staff, newViewer)
  await expect(
    newEditor.getByRole("combobox", {
      name: `Menu item at ${world.venue2.name}`,
    })
  ).toBeVisible()
  await newEditor
    .getByRole("combobox", { name: /^Menu item at / })
    .fill("Stuffed Tandoori")
  await expect(
    newEditor.getByRole("option", { name: /^Stuffed Tandoori Mushroom/ })
  ).toBeVisible()
})

test("rows 12+13: label filters combine with venue/staff/type, search and dates; stable pages; admin correction; original bytes", async ({
  browser,
}) => {
  test.setTimeout(300_000)
  const world = await provisionWorld()
  const admin = await withRailway(browser, world)
  const v1 = world.venue1.id
  const t = world.tag
  const onion = activeItemId(v1, "appetisers--onion-bhaji")
  const momo = activeItemId(v1, "appetisers--momo-veg-chicken")
  const chicken = activeVariantId(v1, "appetisers--momo-veg-chicken", "Chicken")
  const veg = activeVariantId(v1, "appetisers--momo-veg-chicken", "Veg")
  const doc = JSON.parse(readFileSync(RAILWAY, "utf8"))
  const sherpaliSection = doc.sections.find(
    (s: { items: { name: string }[] }) =>
      s.items.some((i) => i.name === "Sherpali Chicken")
  )
  const sherpaliKey = sherpaliSection.items.find(
    (i: { name: string }) => i.name === "Sherpali Chicken"
  ).key
  const sherpali = activeItemId(v1, sherpaliKey)

  const aImg = await seedReadyAssets(
    world.staffA.id,
    v1,
    30,
    "image",
    `qa-lib-a-img-${t}`
  )
  const aVid = await seedReadyAssets(
    world.staffA.id,
    v1,
    3,
    "video",
    `qa-lib-a-vid-${t}`
  )
  const bImg = await seedReadyAssets(
    world.staffB.id,
    v1,
    4,
    "image",
    `qa-lib-b-img-${t}`
  )
  await seedReadyAssets(
    world.staffC.id,
    world.venue2.id,
    2,
    "image",
    `qa-lib-c-img-${t}`
  )
  for (const id of aImg.slice(0, 26))
    await labelAsUploader(world.staffA, v1, id, [{ itemId: onion }], ["dish"])
  for (const id of aVid.slice(0, 2))
    await labelAsUploader(
      world.staffA,
      v1,
      id,
      [{ itemId: onion }],
      ["preparation"]
    )
  await labelAsUploader(
    world.staffB,
    v1,
    bImg[0],
    [{ itemId: momo, variantId: chicken }],
    ["drinks"],
    `QA crispy batter note ${t}`
  )
  await labelAsUploader(world.staffB, v1, bImg[1], [
    { itemId: momo, variantId: chicken },
  ])
  await labelAsUploader(world.staffB, v1, bImg[2], [
    { itemId: momo, variantId: veg },
  ])
  await labelAsUploader(world.staffB, v1, bImg[3], [{ itemId: sherpali }])
  // Two unlabelled photos uploaded "ten days ago" (fixture time travel).
  // Fixture time travel on the owned stack only: the guard trigger keeps
  // created_at immutable for every app role, so bypass triggers for this one
  // provisioning statement.
  psql(`set session_replication_role = replica; update public.media_assets set created_at = now() - interval '10 days'
    where id in (${sql(aImg[28])}, ${sql(aImg[29])})`)
  const tenDaysAgo = psql(
    `select to_char((now() - interval '10 days') at time zone 'Europe/London', 'YYYY-MM-DD')`
  )

  const library = libraryList(admin)
  const tiles = library.getByRole("button")
  const unique = async (n: number, pattern: RegExp) => {
    const names = await tileLabels(library)
    expect(names).toHaveLength(n)
    expect(new Set(names).size).toBe(n)
    for (const name of names) expect(name).toMatch(pattern)
  }

  await test.step("menu item (UI) + venue + photos: 26 across two pages, no duplicates", async () => {
    await admin.goto("/admin")
    await chooseOption(admin, admin, "Venue", world.venue1.name)
    await admin.getByRole("button", { name: "More filters" }).click()
    await admin.getByRole("combobox", { name: "Menu item" }).fill("Onion")
    await admin
      .getByRole("listbox", { name: "Menu items" })
      .getByRole("option", { name: /Onion Bhaji/ })
      .first()
      .click()
    await admin
      .getByRole("group", { name: "Media type" })
      .getByRole("button", { name: "Photos", exact: true })
      .click()
    await expect(admin).toHaveURL(new RegExp(`item=${onion}`))
    await expect(tiles).toHaveCount(24)
    await admin.getByRole("button", { name: /^Load more/ }).click()
    await expect(tiles).toHaveCount(26)
    await expect(admin.getByText("All 26 shown")).toBeVisible()
    await unique(
      26,
      new RegExp(
        `^Photo, qa-lib-a-img-${t}-\\d\\d\\.jpg, by ${escape(world.staffA.name)}`
      )
    )
  })

  await test.step("+ content type Preparation, all types: the 2 videos", async () => {
    await admin
      .getByRole("group", { name: "Media type" })
      .getByRole("button", { name: "Photos and videos", exact: true })
      .click()
    await chooseOption(admin, admin, "Content type", "Preparation")
    await expect(tiles).toHaveCount(2)
    await unique(2, new RegExp(`^Video, qa-lib-a-vid-${t}-0[12]\\.mp4`))
  })

  await test.step("Folders switch between menu section, content type and needs labels within the venue and staff scope", async () => {
    await admin.goto(`/admin?venue=${v1}&item=${momo}&variant=${chicken}`)
    await expect(tiles).toHaveCount(2)
    await unique(2, new RegExp(`^Photo, qa-lib-b-img-${t}-0[12]\\.jpg`))
    const folders = admin.getByRole("region", { name: "Browse folders" })
    const section = folders.getByRole("button", {
      name: sherpaliSection.name,
      exact: true,
    })
    await section.click()
    await expect(section).toHaveAttribute("aria-pressed", "true")
    await expect(admin).toHaveURL(
      `/admin?venue=${v1}&category=${sherpaliSection.key}`
    )
    await expect(tiles).toHaveCount(1)
    await unique(1, new RegExp(`^Photo, qa-lib-b-img-${t}-04\\.jpg`))
    await folders
      .getByRole("button", { name: "Preparation", exact: true })
      .click()
    await expect(admin).toHaveURL(`/admin?venue=${v1}&content=preparation`)
    await expect(tiles).toHaveCount(2)
    await unique(2, new RegExp(`^Video, qa-lib-a-vid-${t}-0[12]\\.mp4`))
    await admin.goto(`/admin?venue=${v1}&staff=${world.staffA.id}`)
    await folders
      .getByRole("button", { name: "Needs labels", exact: true })
      .click()
    await expect(admin).toHaveURL(
      `/admin?venue=${v1}&staff=${world.staffA.id}&labels=unlabelled`
    )
    await expect(tiles).toHaveCount(5)
    await unique(
      5,
      new RegExp(
        `^(Photo, qa-lib-a-img-${t}-(27|28|29|30)\\.jpg|Video, qa-lib-a-vid-${t}-03\\.mp4)`
      )
    )
    await admin.goto(
      `/admin?venue=${v1}&staff=${world.staffB.id}&labels=labelled`
    )
    await expect(tiles).toHaveCount(4)
  })

  await test.step("search (UI) matches a note; dates select the back-dated uploads", async () => {
    await admin.goto(`/admin?venue=${v1}`)
    await admin
      .getByRole("searchbox", { name: "Search labels and notes" })
      .fill("crispy batter")
    await admin.getByRole("button", { name: "Apply filters" }).click()
    await expect(tiles).toHaveCount(1)
    await unique(1, new RegExp(`^Photo, qa-lib-b-img-${t}-01\\.jpg`))
    await admin.goto(`/admin?venue=${v1}&q=${encodeURIComponent("Momo")}`)
    await expect(tiles).toHaveCount(3)
    await admin.goto(`/admin?venue=${v1}&from=${tenDaysAgo}&to=${tenDaysAgo}`)
    await expect(tiles).toHaveCount(2)
    await unique(2, new RegExp(`^Photo, qa-lib-a-img-${t}-(29|30)\\.jpg`))
    await admin.getByRole("button", { name: "Clear filters" }).click()
    await expect(admin).toHaveURL(/\/admin$/)
  })

  await test.step("admin corrects a staff member's labels in the viewer", async () => {
    await admin.goto(
      `/admin?venue=${v1}&staff=${world.staffB.id}&q=${encodeURIComponent("crispy batter")}`
    )
    await tiles.first().click()
    const viewer = admin.getByRole("dialog").first()
    const editor = await openEditorFromViewer(admin, viewer)
    await editor.getByRole("button", { name: "Remove Momo (Chicken)" }).click()
    await pick(
      editor,
      /^Menu item at /,
      "onion bhaji",
      /^Onion Bhaji Appetisers/
    )
    await editor.getByRole("button", { name: /^Save labels/ }).click()
    await expect(editor).toBeHidden()
    const labels = viewer.getByRole("region", { name: "Labels" })
    await expect(
      labels.getByRole("list", { name: "Menu items" }).getByRole("listitem")
    ).toHaveText(["Onion Bhaji · Appetisers"])
    expect(
      psql(`select e.actor_id = ${sql(world.adminA.id)} from public.media_label_events e
        where e.asset_id = ${sql(bImg[0])} order by e.id desc limit 1`)
    ).toBe("t")
    const staffB = await signedInPage(browser, world.staffB)
    await staffB.goto("/staff")
    const own = await openOwn(staffB, `qa-lib-b-img-${t}-01.jpg`)
    await expect(own.getByRole("list", { name: "Menu items" })).toContainText(
      "Onion Bhaji"
    )
    await expect(
      own.getByRole("list", { name: "Menu items" })
    ).not.toContainText("Momo")
    await staffB.context().close()
  })

  await test.step("a labelled real upload still downloads byte-identical", async () => {
    const staff = await signedInPage(browser, world.staffA)
    await openPortfolio(staff)
    const photo = await syntheticJpeg(`qa-bytes-${t}.jpg`)
    await uploadThroughDialog(staff, [photo], { close: false })
    // Label it in the sheet: content types are under "More details", and the
    // labels are sent by asset id (no Save button).
    const sheet = uploadSheet(staff)
    await sheet.getByRole("button", { name: "More details" }).click()
    await sheet
      .getByRole("group", { name: /^What's in the photo \(up to \d+\)$/ })
      .getByRole("button", { name: "Team" })
      .click()
    const id = psql(
      `select id from public.media_assets where original_filename = ${sql(photo.name)}`
    )
    await expect
      .poll(
        () =>
          psql(
            `select coalesce(array_to_string(content_types, ','), '') from public.media_labels where asset_id = ${sql(id)}`
          ),
        { timeout: 30_000 }
      )
      .toBe("team")
    await expect(sheet.getByRole("status")).toHaveText("1 saved")
    await sheet.getByRole("button", { name: "Done" }).click()
    await expect(sheet).toBeHidden()
    await admin.goto(`/admin?content=team&venue=${v1}`)
    await library
      .getByRole("button", { name: tileName("Photo", photo.name) })
      .click()
    const download = admin
      .getByRole("dialog")
      .first()
      .getByRole("link", { name: "Download original" })
    await expect(download).toHaveAttribute("href", `/api/media/${id}/download`)
    const response = await admin.request.get(`/api/media/${id}/download`)
    expect(response.status()).toBe(200)
    expect(sha256(new Uint8Array(await response.body()))).toBe(photo.sha256)
    await staff.context().close()
  })
})
