import { readFileSync, writeFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

import { expect, test, type Locator, type Page } from "@playwright/test"

import { signIn } from "../support/identities"
import { provisioner, psql, requireIsolatedStack } from "./helpers/stack"
import { escape } from "./helpers/ui"
import {
  provisionWorld,
  seedReadyAssets,
  signedInPage,
  type Person,
} from "./helpers/world"

/**
 * v0.3 QA (packet J): admin menu catalogue journeys on the isolated stack.
 * Contract §7 rows 1 (two venue menus, separation), 2 (CSV, rejected and
 * malformed input), 3 (review + activate; draft never active for staff),
 * 4 (rename, removal, key change, category move, archive and retire keep
 * historical labels) and 15 (stale draft save in two pages).
 *
 * The Railway / Prince of Wales files are DEV FIXTURE menus from
 * tests/fixtures/menus; modified versions are SYNTHETIC TEST DATA written to
 * the test's output directory. Fixture labels for history checks are written
 * through the real `save_media_labels` RPC as the staff member (their own
 * session), never with the service role.
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

function activeVersionId(venueId: string): string {
  return psql(
    `select id from public.menu_versions where venue_id = ${sql(venueId)} and status = 'active'`
  )
}

/** Stable item id behind a source key in the venue's active version. */
function activeItemId(venueId: string, sourceKey: string): string {
  const id = psql(`select e.item_id from public.menu_entries e
    join public.menu_versions v on v.id = e.version_id
    where v.venue_id = ${sql(venueId)} and v.status = 'active' and e.source_key = ${sql(sourceKey)}`)
  if (!id) throw new Error(`No active item ${sourceKey}`)
  return id
}

function activeVariantId(venueId: string, sourceKey: string, name: string) {
  return psql(`select ev.variant_id from public.menu_entry_variants ev
    join public.menu_entries e on e.id = ev.entry_id
    join public.menu_versions v on v.id = e.version_id
    where v.venue_id = ${sql(venueId)} and v.status = 'active'
      and e.source_key = ${sql(sourceKey)} and lower(ev.name) = lower(${sql(name)})`)
}

/** Labels one asset as its uploader through the RPC (fixture setup only). */
async function labelAsUploader(
  who: Person,
  venueId: string,
  assetId: string,
  items: { itemId: string; variantId?: string | null }[],
  contentTypes: string[] = []
) {
  const client = await signIn(provisioner(), who.email)
  const { error } = await client.rpc("save_media_labels", {
    p_asset_id: assetId,
    p_expected_revision: 0,
    p_content_types: contentTypes,
    p_note: null as unknown as string,
    p_items: items.map((i) => ({
      itemId: i.itemId,
      variantId: i.variantId ?? null,
    })),
    p_missing_item: null as unknown as string,
    p_catalogue_version_id: activeVersionId(venueId),
  })
  if (error) throw new Error(`fixture label save failed: ${error.message}`)
}

async function openVenueMenus(page: Page, venueId: string, venueName: string) {
  await page.goto(`/admin/menus/${venueId}`)
  await expect(
    page.getByRole("heading", { level: 1, name: venueName })
  ).toBeVisible()
}

async function previewImport(page: Page, path: string) {
  await page.getByLabel("Menu file (JSON or CSV)").setInputFiles(path)
}

/** From a version page: Activate… → confirm → the version is active. */
async function activateOpenDraft(page: Page) {
  await page.getByRole("button", { name: "Activate…" }).click()
  const dialog = page.getByRole("alertdialog")
  await expect(dialog).toContainText(
    "Active means available for labelling photos and videos."
  )
  await dialog.getByRole("button", { name: "Activate for labelling" }).click()
  await expect(dialog).toBeHidden()
  await expect(page.getByRole("button", { name: "Retire menu…" })).toBeVisible()
}

async function importAndActivate(
  page: Page,
  venue: { id: string; name: string },
  path: string,
  title: string
) {
  await openVenueMenus(page, venue.id, venue.name)
  await previewImport(page, path)
  await expect(
    page.getByRole("heading", { name: `Preview: ${title}` })
  ).toBeVisible()
  await page.getByRole("button", { name: "Create draft" }).click()
  await page.waitForURL(/\/admin\/menus\/versions\//)
  await expect(
    page.getByRole("heading", { level: 1, name: title })
  ).toBeVisible()
  await activateOpenDraft(page)
}

/** Staff: open one of their own photos and its label editor. */
async function openOwnLabelEditor(page: Page, fileName: string) {
  await page.goto("/staff")
  await page
    .getByRole("list", { name: "Your portfolio" })
    .getByRole("button", { name: new RegExp(`^Photo, ${escape(fileName)}`) })
    .click()
  const viewer = page.getByRole("dialog").first()
  await viewer.getByRole("button", { name: /^(Add|Edit) labels$/ }).click()
  const editor = page.getByRole("dialog", { name: /^(Add|Edit) labels$/ })
  await expect(editor).toBeVisible()
  return editor
}

async function searchMenu(editor: Locator, query: string) {
  await editor.getByRole("combobox", { name: /^Search the menu/ }).fill(query)
}

test("rows 1+3: two venue menus imported separately; a draft is never active for staff", async ({
  browser,
}) => {
  test.setTimeout(240_000)
  const world = await provisionWorld()
  const [assetA] = await seedReadyAssets(
    world.staffA.id,
    world.venue1.id,
    1,
    "image",
    `qa-sep-a-${world.tag}`
  )
  await seedReadyAssets(
    world.staffC.id,
    world.venue2.id,
    1,
    "image",
    `qa-sep-c-${world.tag}`
  )
  const fileA = `qa-sep-a-${world.tag}-01.jpg`
  const fileC = `qa-sep-c-${world.tag}-01.jpg`
  const admin = await signedInPage(browser, world.adminA)
  const staffA = await signedInPage(browser, world.staffA)
  const staffC = await signedInPage(browser, world.staffC)

  await test.step("Menus nav → venue → preview The Railway (all added)", async () => {
    await admin.goto("/admin")
    await admin
      .getByRole("navigation", { name: "Admin" })
      .getByRole("link", { name: "Menus" })
      .click()
    await expect(
      admin.getByRole("heading", { level: 1, name: "Menus" })
    ).toBeVisible()
    await admin
      .getByRole("list", { name: "Venue menus" })
      .getByRole("link", { name: new RegExp(`^${escape(world.venue1.name)}`) })
      .click()
    await expect(
      admin.getByRole("heading", { level: 1, name: world.venue1.name })
    ).toBeVisible()
    await expect(
      admin.getByText(
        "PDF, image, Word and JavaScript menus are not supported.",
        {
          exact: false,
        }
      )
    ).toBeVisible()
    await previewImport(admin, RAILWAY)
    const preview = admin.getByRole("region", {
      name: `Preview: ${RAILWAY_TITLE}`,
    })
    await expect(preview).toContainText(
      "the-railway.food.json · 14 sections, 125 items."
    )
    await expect(
      preview.getByRole("heading", { name: "Added (125)" })
    ).toBeVisible()
    await admin.getByRole("button", { name: "Create draft" }).click()
    await admin.waitForURL(/\/admin\/menus\/versions\//)
    await expect(admin.getByText("Saved · revision 1")).toBeVisible()
  })

  await test.step("draft only: staff A still has no menu to label with", async () => {
    const editor = await openOwnLabelEditor(staffA, fileA)
    await expect(editor).toContainText(
      `${world.venue1.name} has no active menu yet`
    )
    await expect(
      editor.getByRole("combobox", { name: /^Search the menu/ })
    ).toHaveCount(0)
    await expect(
      editor.getByRole("button", { name: "Finished dish" })
    ).toBeVisible()
    await staffA.keyboard.press("Escape")
  })

  await test.step("activate The Railway; import + activate Prince of Wales at venue 2", async () => {
    await activateOpenDraft(admin)
    await importAndActivate(admin, world.venue2, PRINCE, PRINCE_TITLE)
    await admin.goto("/admin/menus")
    const list = admin.getByRole("list", { name: "Venue menus" })
    await expect(
      list.getByRole("link", {
        name: new RegExp(`^${escape(world.venue1.name)}`),
      })
    ).toContainText(RAILWAY_TITLE)
    await expect(
      list.getByRole("link", {
        name: new RegExp(`^${escape(world.venue2.name)}`),
      })
    ).toContainText(PRINCE_TITLE)
  })

  await test.step("venue separation in the staff label editor", async () => {
    const a = await openOwnLabelEditor(staffA, fileA)
    // Names unique to each venue's file (The Railway also lists some Prince
    // of Wales dishes under its own "Sister Pub Specials").
    await searchMenu(a, "Sherpali")
    await expect(
      a.getByRole("option", { name: /^Sherpali Chicken/ })
    ).toBeVisible()
    await searchMenu(a, "Stuffed Tandoori")
    await expect(
      a.getByText("No menu items match", { exact: false }).first()
    ).toBeVisible()
    await searchMenu(a, "Onion Bhaji")
    // Both files list "Onion Bhaji"; only venue 1's own item is offered.
    await expect(
      a.getByRole("option", { name: /^Onion Bhaji in / })
    ).toHaveCount(1)
    await a.getByRole("option", { name: /^Onion Bhaji in Appetisers/ }).click()
    await a.getByRole("button", { name: /^Save labels/ }).click()
    await expect(a).toBeHidden()
    await expect(
      staffA.getByRole("dialog").getByRole("list", { name: "Menu items" })
    ).toContainText("Onion Bhaji")

    const c = await openOwnLabelEditor(staffC, fileC)
    await searchMenu(c, "Stuffed Tandoori")
    await expect(
      c.getByRole("option", { name: /^Stuffed Tandoori Mushroom/ })
    ).toBeVisible()
    await searchMenu(c, "Sherpali")
    await expect(
      c.getByText("No menu items match", { exact: false }).first()
    ).toBeVisible()
  })

  await test.step("DB: the saved label item belongs to the asset's venue", async () => {
    expect(
      psql(`select distinct i.venue_id from public.media_label_items li
        join public.menu_items i on i.id = li.item_id
        where li.asset_id = ${sql(assetA)}`)
    ).toBe(world.venue1.id)
    expect(
      psql(
        `select count(*) from public.menu_items where venue_id = ${sql(world.venue1.id)}`
      )
    ).toBe("125")
    expect(
      psql(
        `select count(*) from public.menu_items where venue_id = ${sql(world.venue2.id)}`
      )
    ).toBe("127")
  })
})

test("rows 2+4: re-import with rename, removal, key change and category move; uncertain resolved; labels keep history; archive; retire", async ({
  browser,
}, testInfo) => {
  test.setTimeout(300_000)
  const world = await provisionWorld()
  const admin = await signedInPage(browser, world.adminA)
  const venue = world.venue1
  await importAndActivate(admin, venue, RAILWAY, RAILWAY_TITLE)
  const firstVersion = activeVersionId(venue.id)

  const prefix = `qa-hist-${world.tag}`
  const [renamedAsset, removedAsset, archivedAsset] = await seedReadyAssets(
    world.staffA.id,
    venue.id,
    3,
    "image",
    prefix
  )
  const file = (n: number) => `${prefix}-0${n}.jpg`
  const onion = activeItemId(venue.id, "appetisers--onion-bhaji")
  const spring = activeItemId(venue.id, "appetisers--spring-roll")
  const momo = activeItemId(venue.id, "appetisers--momo-veg-chicken")
  const momoChicken = activeVariantId(
    venue.id,
    "appetisers--momo-veg-chicken",
    "Chicken"
  )
  const mushroom = activeItemId(venue.id, "appetisers--garlic-mushroom")
  const paneer = activeItemId(venue.id, "appetisers--chilli-paneer")
  await labelAsUploader(
    world.staffA,
    venue.id,
    renamedAsset,
    [{ itemId: onion }],
    ["dish"]
  )
  await labelAsUploader(world.staffA, venue.id, removedAsset, [
    { itemId: spring },
  ])
  await labelAsUploader(world.staffA, venue.id, archivedAsset, [
    { itemId: momo, variantId: momoChicken },
    { itemId: mushroom },
  ])

  // SYNTHETIC TEST DATA derived from the DEV FIXTURE: one rename (same key),
  // one removal, one key change (name-only match → uncertain) and one
  // explicit-key category move.
  const doc = JSON.parse(readFileSync(RAILWAY, "utf8"))
  doc.title = "The Railway food v2 (QA SYNTHETIC)"
  const appetisers = doc.sections.find(
    (s: { key: string }) => s.key === "appetisers"
  )
  const specials = doc.sections.find(
    (s: { name: string }) => s.name === "Chef's Specials"
  )
  const byKey = (key: string) =>
    appetisers.items.find((i: { key: string }) => i.key === key)
  byKey("appetisers--onion-bhaji").name = "Onion Bhaji Tower"
  byKey("appetisers--chilli-paneer").key = "appetisers--chilli-paneer-2026"
  const moved = byKey("appetisers--garlic-mushroom")
  appetisers.items = appetisers.items.filter(
    (i: { key: string }) => i.key !== "appetisers--spring-roll" && i !== moved
  )
  specials.items.push(moved)
  const v2 = testInfo.outputPath("railway-v2.qa-synthetic.json")
  writeFileSync(v2, JSON.stringify(doc, null, 2))

  await test.step("preview against the active menu: changed, removed, uncertain", async () => {
    await openVenueMenus(admin, venue.id, venue.name)
    await previewImport(admin, v2)
    const preview = admin.getByRole("region", {
      name: "Preview: The Railway food v2 (QA SYNTHETIC)",
    })
    await expect(preview).toContainText("Compared with the active menu.")
    await expect(
      preview.getByRole("heading", { name: "Uncertain matches (1)" })
    ).toBeVisible()
    await expect(
      preview.getByRole("heading", { name: "Changed (2)" })
    ).toBeVisible()
    await expect(
      preview.getByRole("heading", { name: /^Removed \(\d+\)$/ })
    ).toBeVisible()
    await expect(
      preview.getByRole("heading", { name: "Added (0)" })
    ).toHaveCount(0)
    await expect(preview).toContainText("Onion Bhaji Tower")
    await expect(preview).toContainText("Spring Roll")
    await expect(preview).toContainText("Not resolved")
  })

  await test.step("resolve the uncertain match as the same item, create the draft, activate", async () => {
    await admin
      .getByRole("radio", { name: /Same item as “Chilli Paneer”/ })
      .check()
    await admin
      .getByRole("button", { name: "Confirm decision for Chilli Paneer" })
      .click()
    await expect(
      admin.getByText("Resolved: same item as “Chilli Paneer”")
    ).toBeVisible()
    await admin.getByRole("button", { name: "Create draft" }).click()
    await admin.waitForURL(/\/admin\/menus\/versions\//)
    await expect(
      admin.getByRole("heading", {
        level: 1,
        name: "The Railway food v2 (QA SYNTHETIC)",
      })
    ).toBeVisible()
    await activateOpenDraft(admin)
    expect(activeVersionId(venue.id)).not.toBe(firstVersion)
    // The key change kept the item's identity; nothing was hard-deleted.
    expect(activeItemId(venue.id, "appetisers--chilli-paneer-2026")).toBe(
      paneer
    )
    expect(
      psql(
        `select status from public.menu_versions where id = ${sql(firstVersion)}`
      )
    ).toBe("retired")
    expect(
      psql(`select count(*) from public.menu_items where id = ${sql(spring)}`)
    ).toBe("1")
  })

  const viewerLabels = async (n: number) => {
    await admin.goto("/admin")
    await admin
      .getByRole("list", { name: "Library" })
      .getByRole("button", { name: new RegExp(`^Photo, ${escape(file(n))}`) })
      .click()
    return admin.getByRole("dialog").getByRole("region", { name: "Labels" })
  }

  await test.step("historical labels: current name + labelled as, not on menu, moved section", async () => {
    const renamed = await viewerLabels(1)
    await expect(
      renamed.getByRole("list", { name: "Menu items" })
    ).toContainText("Onion Bhaji Tower")
    await expect(renamed).toContainText("labelled as Onion Bhaji")
    const removed = await viewerLabels(2)
    await expect(
      removed.getByRole("list", { name: "Menu items" })
    ).toContainText("Spring Roll")
    await expect(removed).toContainText("Not on the current menu")
    const movedLabels = await viewerLabels(3)
    await expect(
      movedLabels.getByRole("listitem").filter({ hasText: "Garlic Mushroom" })
    ).toContainText("Chef's Specials")
  })

  await test.step("archive Momo: staff can no longer pick it; its label stays (Archived)", async () => {
    await openVenueMenus(admin, venue.id, venue.name)
    await admin.getByRole("link", { name: "View active menu" }).click()
    await admin.getByRole("searchbox", { name: "Search items" }).fill("Momo")
    // Item rows expand to show their controls (and the label count).
    await admin
      .getByRole("button", { name: /^Momo Veg · Chicken/, expanded: false })
      .click()
    await admin.getByRole("button", { name: "Archive item: Momo" }).click()
    const confirm = admin.getByRole("alertdialog")
    await expect(confirm).toContainText(
      "Staff can no longer add it to new labels"
    )
    await confirm.getByRole("button", { name: "Archive item" }).click()
    await expect(
      admin.getByRole("button", { name: "Unarchive item: Momo" })
    ).toBeVisible()
    expect(
      psql(
        `select archived_at is not null from public.menu_items where id = ${sql(momo)}`
      )
    ).toBe("t")

    const labels = await viewerLabels(3)
    await expect(
      labels.getByRole("listitem").filter({ hasText: "Momo" })
    ).toContainText("Archived")
    const staff = await signedInPage(browser, world.staffA)
    const editor = await openOwnLabelEditor(staff, file(1))
    await searchMenu(editor, "Momo")
    await expect(
      editor.getByText("No menu items match", { exact: false }).first()
    ).toBeVisible()
    await staff.context().close()
  })

  await test.step("retire: no active menu, content types only; labels kept", async () => {
    await openVenueMenus(admin, venue.id, venue.name)
    await admin.getByRole("link", { name: "View active menu" }).click()
    await admin.getByRole("button", { name: "Retire menu…" }).click()
    const confirm = admin.getByRole("alertdialog")
    await confirm.getByRole("button", { name: "Retire menu" }).click()
    await expect(confirm).toBeHidden()
    await openVenueMenus(admin, venue.id, venue.name)
    await expect(
      admin.getByRole("region", { name: "Active menu" })
    ).toContainText("No active menu.")
    await expect(
      admin.getByRole("list", { name: "Retired and discarded versions" })
    ).toContainText("The Railway food v2 (QA SYNTHETIC)")

    const staff = await signedInPage(browser, world.staffA)
    const editor = await openOwnLabelEditor(staff, file(1))
    await expect(editor).toContainText(`${venue.name} has no active menu yet`)
    await expect(
      editor.getByRole("button", { name: "Preparation" }).first()
    ).toBeVisible()
    await staff.keyboard.press("Escape")
    await staff.context().close()

    const renamed = await viewerLabels(1)
    await expect(
      renamed.getByRole("list", { name: "Menu items" })
    ).toContainText("Onion Bhaji Tower")
    expect(
      psql(
        `select count(*) from public.media_label_items where asset_id in (${[
          renamedAsset,
          removedAsset,
          archivedAsset,
        ]
          .map(sql)
          .join(", ")})`
      )
    ).toBe("4")
  })
})

test("row 2: CSV imports; PDF and other formats are refused; malformed and duplicate JSON report issues", async ({
  browser,
  baseURL,
}, testInfo) => {
  test.setTimeout(180_000)
  const world = await provisionWorld()
  const admin = await signedInPage(browser, world.adminA)
  await openVenueMenus(admin, world.venue1.id, world.venue1.name)

  await test.step("PDF: refused in the browser with the JSON/CSV-only message", async () => {
    const pdf = testInfo.outputPath("menu.pdf")
    writeFileSync(pdf, "%PDF-1.4\n% SYNTHETIC TEST DATA, not a real menu\n")
    await previewImport(admin, pdf)
    await expect(
      admin.getByText("Only .json and .csv files can be imported.", {
        exact: false,
      })
    ).toBeVisible()
    await expect(admin.getByRole("heading", { name: /^Preview:/ })).toHaveCount(
      0
    )
  })

  await test.step("PDF posted straight to the preview route is refused (400)", async () => {
    const response = await admin.request.post(
      "/api/admin/menus/import-preview",
      {
        headers: { origin: baseURL! },
        multipart: {
          venueId: world.venue1.id,
          file: {
            name: "menu.pdf",
            mimeType: "application/pdf",
            buffer: Buffer.from("%PDF-1.4\n% SYNTHETIC TEST DATA\n"),
          },
        },
      }
    )
    expect(response.status()).toBe(400)
    expect(await response.json()).toMatchObject({ ok: false })
  })

  await test.step("malformed JSON: preview failed, nothing created", async () => {
    await previewImport(admin, fixture("synthetic-malformed.json"))
    await expect(admin.getByText("Preview failed")).toBeVisible()
    await expect(admin.getByRole("heading", { name: /^Preview:/ })).toHaveCount(
      0
    )
  })

  await test.step("duplicate keys: reported, no preview", async () => {
    await previewImport(admin, fixture("synthetic-duplicates.json"))
    await expect(admin.getByText("Preview failed")).toBeVisible()
    await expect(admin.getByText(/duplicate/i).first()).toBeVisible()
  })

  await test.step("CSV with BOM/CRLF and quoting: preview, draft with CSV provenance", async () => {
    await previewImport(admin, fixture("synthetic-quoting.csv"))
    const preview = admin.getByRole("region", { name: /^Preview:/ })
    await expect(preview).toContainText("synthetic-quoting.csv ·")
    await expect(
      preview.getByRole("heading", { name: /^Added \(\d+\)$/ })
    ).toBeVisible()
    await admin.getByRole("button", { name: "Create draft" }).click()
    await admin.waitForURL(/\/admin\/menus\/versions\//)
    const provenance = admin.getByRole("region", { name: "Provenance" })
    await expect(provenance).toContainText("synthetic-quoting.csv")
    await expect(provenance).toContainText("CSV")
  })
  expect(
    psql(
      `select count(*) from public.menu_versions where venue_id = ${sql(world.venue1.id)}`
    )
  ).toBe("1")
})

test("row 15: a stale draft save in a second page is a recoverable conflict", async ({
  browser,
}) => {
  test.setTimeout(120_000)
  const world = await provisionWorld()
  const one = await signedInPage(browser, world.adminA)
  await openVenueMenus(one, world.venue1.id, world.venue1.name)
  await one.getByRole("button", { name: "New empty draft" }).click()
  await one.waitForURL(/\/admin\/menus\/versions\//)
  await expect(one.getByText("Saved · revision 1")).toBeVisible()
  const two = await one.context().newPage()
  await two.goto(one.url())
  await expect(two.getByText("Saved · revision 1")).toBeVisible()

  await one
    .getByRole("textbox", { name: "Menu title" })
    .fill(`QA first ${world.tag}`)
  await one.getByRole("button", { name: "Save draft" }).click()
  await expect(one.getByText("Draft saved (revision 2).")).toBeVisible()

  await two
    .getByRole("textbox", { name: "Menu title" })
    .fill(`QA second ${world.tag}`)
  await two.getByRole("button", { name: "Save draft" }).click()
  const alert = two
    .getByRole("alert")
    .filter({ hasText: "This draft changed elsewhere" })
  await expect(alert).toBeVisible()
  // The local edit is still there until the admin chooses.
  await expect(two.getByRole("textbox", { name: "Menu title" })).toHaveValue(
    `QA second ${world.tag}`
  )
  await alert.getByRole("button", { name: "Reload latest" }).click()
  await expect(two.getByRole("textbox", { name: "Menu title" })).toHaveValue(
    `QA first ${world.tag}`
  )
  await expect(two.getByText("Saved · revision 2")).toBeVisible()
  expect(
    psql(
      `select title || ' r' || revision from public.menu_versions where venue_id = ${sql(world.venue1.id)}`
    )
  ).toBe(`QA first ${world.tag} r2`)
})
