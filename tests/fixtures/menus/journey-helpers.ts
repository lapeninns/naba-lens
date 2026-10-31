import { randomUUID } from "node:crypto"
import { fileURLToPath } from "node:url"

import {
  expect,
  type Browser,
  type Locator,
  type Page,
  type TestInfo,
} from "@playwright/test"

import { signIn } from "../../support/identities"
import { provisioner, psql } from "../../e2e/helpers/stack"
import { escape, portfolioList } from "../../e2e/helpers/ui"
import {
  provisionWorld,
  signedInPage,
  type Person,
  type World,
} from "../../e2e/helpers/world"

/**
 * Shared steps for the menus journeys (tests/journeys/menus-*.spec.ts). Menus
 * are the DEV FIXTURE files next to this module; every journey provisions its
 * own world, so journeys can run in any order on a shared stack.
 */

const fixture = (name: string) => fileURLToPath(new URL(name, import.meta.url))
export const RAILWAY = fixture("the-railway.food.json")
export const RAILWAY_TITLE = "The Railway food (DEV FIXTURE)"

export const sql = (v: string) => `'${v.replace(/'/g, "''")}'`

export const activeVersionId = (venueId: string) =>
  psql(
    `select id from public.menu_versions where venue_id = ${sql(venueId)} and status = 'active'`
  )

export function activeItemId(venueId: string, sourceKey: string) {
  const id = psql(`select e.item_id from public.menu_entries e
    join public.menu_versions v on v.id = e.version_id
    where v.venue_id = ${sql(venueId)} and v.status = 'active' and e.source_key = ${sql(sourceKey)}`)
  if (!id) throw new Error(`No active item ${sourceKey}`)
  return id
}

export async function attachShot(testInfo: TestInfo, name: string, page: Page) {
  await testInfo.attach(name, {
    body: await page.screenshot(),
    contentType: "image/png",
  })
}

export async function openVenueMenus(
  page: Page,
  venue: { id: string; name: string }
) {
  await page.goto(`/admin/menus/${venue.id}`)
  await expect(
    page.getByRole("heading", { level: 1, name: venue.name })
  ).toBeVisible()
}

/** Preview the Railway file at the venue; leaves the admin on the draft page. */
export async function importRailwayDraft(
  page: Page,
  venue: { id: string; name: string }
) {
  await openVenueMenus(page, venue)
  await page.getByLabel("Menu file (JSON or CSV)").setInputFiles(RAILWAY)
  await expect(
    page.getByRole("heading", { name: `Preview: ${RAILWAY_TITLE}` })
  ).toBeVisible()
  await page.getByRole("button", { name: "Create draft" }).click()
  await page.waitForURL(/\/admin\/menus\/versions\//)
  await expect(
    page.getByRole("heading", { level: 1, name: RAILWAY_TITLE })
  ).toBeVisible()
}

/** From a draft version page: Activate… → confirm → the version is active. */
export async function activateOpenDraft(page: Page) {
  await page.getByRole("button", { name: "Activate…" }).click()
  const dialog = page.getByRole("alertdialog")
  await dialog.getByRole("button", { name: "Activate for labelling" }).click()
  await expect(dialog).toBeHidden()
  await expect(page.getByRole("button", { name: "Retire menu…" })).toBeVisible()
}

/** A new draft of the venue's active menu, activated: a new active version id. */
export async function activateNewVersion(
  page: Page,
  venue: { id: string; name: string }
) {
  const before = activeVersionId(venue.id)
  await openVenueMenus(page, venue)
  await page
    .getByRole("button", { name: "Start a draft from the active menu" })
    .click()
  await page.waitForURL(/\/admin\/menus\/versions\//)
  await activateOpenDraft(page)
  expect(activeVersionId(venue.id)).not.toBe(before)
}

/** A fresh world whose venue one has The Railway's menu imported and active. */
export async function worldWithActiveRailway(
  browser: Browser
): Promise<{ world: World; admin: Page }> {
  const world = await provisionWorld()
  const admin = await signedInPage(browser, world.adminA)
  await importRailwayDraft(admin, world.venue1)
  await activateOpenDraft(admin)
  return { world, admin }
}

export async function openOwnLabelEditor(
  page: Page,
  kind: "Photo" | "Video",
  fileName: string
) {
  await page.goto("/staff")
  await portfolioList(page)
    .getByRole("button", { name: new RegExp(`^${kind}, ${escape(fileName)}`) })
    .click()
  const viewer = page.getByRole("dialog").first()
  await viewer.getByRole("button", { name: /^(Add|Edit) labels$/ }).click()
  const editor = page.getByRole("dialog", { name: /^(Add|Edit) labels$/ })
  await expect(editor).toBeVisible()
  return { viewer, editor }
}

export async function pickMenuItem(
  editor: Locator,
  query: string,
  option: RegExp
) {
  await editor.getByRole("combobox", { name: /^Search the menu/ }).fill(query)
  await editor.getByRole("option", { name: option }).click()
}

/** A ready video with a real duration, set at the processing → ready step. */
export async function seedReadyVideo(
  uploaderId: string,
  venueId: string,
  fileName: string,
  durationSeconds: number
) {
  const admin = provisioner()
  const id = randomUUID()
  const insert = await admin.from("media_assets").insert({
    id,
    uploader_id: uploaderId,
    venue_id: venueId,
    original_path: `${uploaderId}/${id}/original.mp4`,
    original_filename: fileName,
    media_type: "video",
  })
  if (insert.error) throw insert.error
  const processing = await admin
    .from("media_assets")
    .update({ upload_state: "processing" })
    .eq("id", id)
  if (processing.error) throw processing.error
  const ready = await admin
    .from("media_assets")
    .update({
      upload_state: "ready",
      validated_mime_type: "video/mp4",
      size_bytes: 1024,
      width: 640,
      height: 480,
      duration_seconds: durationSeconds,
    })
    .eq("id", id)
  if (ready.error) throw ready.error
  return id
}

/** Content-type labels saved through the RPC as the uploader (fixture setup). */
export async function labelContentTypes(
  who: Pick<Person, "email">,
  assetId: string,
  contentTypes: string[]
) {
  const client = await signIn(provisioner(), who.email)
  const { error } = await client.rpc("save_media_labels", {
    p_asset_id: assetId,
    p_expected_revision: 0,
    p_content_types: contentTypes,
    p_note: null as unknown as string,
    p_items: [],
    p_missing_item: null as unknown as string,
  })
  if (error) throw new Error(`fixture label save failed: ${error.message}`)
}
