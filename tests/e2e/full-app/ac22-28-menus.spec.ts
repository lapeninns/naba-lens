import { readFileSync, writeFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

import { expect, test, type Page } from "@playwright/test"

import type { Db } from "../../support/identities"
import {
  activeVersionId,
  labelledPhoto,
  photoRow,
  preferredAsset,
  provisionManagerWorld,
  type ManagerWorld,
} from "../helpers/manager-world"
import { ok } from "../helpers/menus"
import { psql, requireIsolatedStack } from "../helpers/stack"
import { provisionWorld } from "../helpers/world"
import {
  acceptAsManager,
  as,
  closeAll,
  DESKTOP,
  evidence,
  note,
  PHONE,
  sql,
} from "./helpers"

/**
 * AC22, AC23 and AC26 to AC28 (spec §4, §22): menus and offerings. A dish's
 * identity is per venue and stable across menu versions; availability and a
 * scheduled menu never touch the current menu's photo requirements; a
 * repeated import adds nothing and retirements need explicit approval.
 */

test.describe.configure({ mode: "serial" })
test.beforeAll(() => requireIsolatedStack())
test.setTimeout(240_000)
test.afterEach(({ browser }) => closeAll(browser))

const slot = (venueId: string, itemId: string) =>
  psql(`select state || ':' || required || ':' || unavailable
    from private.coverage_slot_rows(${sql(venueId)}::uuid)
    where slot_id = ${sql(itemId)}::uuid`)

const entry = (
  sourceKey: string,
  name: string,
  itemId: string | null = null
) => ({
  itemId,
  sourceKey,
  name,
  description: null,
  aliases: [],
  sourceMeta: {},
  variants: [],
  review: null,
})

/**
 * A draft at venue A keeping every current dish (same item ids) and adding
 * `extra`. DEV FIXTURE, made in the admin's own session.
 */
function nextDraft(w: ManagerWorld, title: string, extra: string | null) {
  const db: Db = w.adminDb
  return ok(
    db.rpc("create_menu_draft", {
      p_venue_id: w.venueA.id,
      p_title: title,
      p_source: {
        kind: "json",
        label: "DEV FIXTURE next menu.json",
        sha256: "c".repeat(64),
        revision: null,
        capturedAt: "2026-11-15T10:00:00Z",
        notes: null,
      } as never,
      p_document: {
        title,
        sections: [
          {
            slug: "starters",
            name: "Starters",
            kind: "food",
            items: [
              entry("starters--soup", "Soup", w.itemsA.soup),
              entry("starters--salad", "Salad", w.itemsA.salad),
            ],
          },
          {
            slug: "mains",
            name: "Mains",
            kind: "food",
            items: [
              entry("mains--pie", "Pie", w.itemsA.pie),
              ...(extra ? [entry(`mains--${extra.toLowerCase()}`, extra)] : []),
            ],
          },
          {
            slug: "drinks",
            name: "Drinks",
            kind: "drinks",
            items: [entry("drinks--lager", "Lager", w.itemsA.lager)],
          },
        ],
      } as never,
    })
  ) as Promise<string>
}

const revisionOf = (versionId: string) =>
  Number(
    psql(
      `select revision from public.menu_versions where id = ${sql(versionId)}::uuid`
    )
  )

/** The manager's Album row for a dish on /manager/menu. */
const menuRow = (page: Page, name: string) =>
  page
    .getByRole("main")
    .getByRole("listitem")
    .filter({ has: page.getByText(name, { exact: true }) })
    .first()

test("AC22 (deferred, FA-41): a stable dish keeps its accepted photo when the menu changes; one active menu per venue", async ({
  browser,
}) => {
  note(
    "deferred",
    "FA-41: two menus sharing one offering is Release 2 (a venue has one active menu). Pins today's rule: the same offering across menu versions keeps its qualifying photo."
  )
  const w = await provisionManagerWorld()
  const asset = await labelledPhoto(w.staffA1, w.venueA, [w.itemsA.soup])
  await acceptAsManager(w.mgrA, asset, w.itemsA.soup)
  const before = activeVersionId(w.venueA.id)

  const draft = await nextDraft(w, `Winter menu ${w.tag}`, null)
  await ok(
    w.adminDb.rpc("activate_menu_version_confirmed", {
      p_version_id: draft,
      p_expected_revision: revisionOf(draft),
      p_retirements: 0,
    })
  )
  expect(activeVersionId(w.venueA.id)).toBe(draft)
  expect(activeVersionId(w.venueA.id)).not.toBe(before)

  // Same offering, same accepted photo, now on the new menu.
  expect(photoRow(asset)).toMatch(new RegExp(`^${w.itemsA.soup}:accepted:`))
  expect(
    psql(
      `select menu_version_id from public.menu_item_photos where asset_id = ${sql(asset)}::uuid`
    )
  ).toBe(draft)
  expect(preferredAsset(w.itemsA.soup)).toBe(asset)
  expect(slot(w.venueA.id, w.itemsA.soup)).toMatch(/^covered:/)
  // One active menu per venue.
  expect(
    psql(`select count(*) from public.menu_versions
      where venue_id = ${sql(w.venueA.id)}::uuid and status = 'active'`)
  ).toBe("1")

  const mgr = await as(browser, w.mgrA, PHONE)
  await mgr.goto("/manager/menu")
  await expect(menuRow(mgr, "Soup")).toContainText("Has a photo")
  await evidence(mgr, "ac22-soup-kept-photo")
})

test("AC23: a dish with the same name at another pub gets no photo from the first pub", async ({
  browser,
}) => {
  const w = await provisionManagerWorld()
  const asset = await labelledPhoto(w.staffA1, w.venueA, [w.itemsA.soup])

  const mgrA = await as(browser, w.mgrA, DESKTOP)
  await mgrA.goto(`/manager/review/photo/${asset}`)
  await mgrA.locator('[data-review-action="approve"]').first().click()
  await expect(mgrA.getByText("Saved.")).toBeVisible()
  expect(slot(w.venueA.id, w.itemsA.soup)).toMatch(/^covered:/)

  // Venue B's Soup: a different offering, still needs its own photo.
  expect(w.itemsB.soup).not.toBe(w.itemsA.soup)
  expect(preferredAsset(w.itemsB.soup)).toBe("")
  expect(slot(w.venueB.id, w.itemsB.soup)).toMatch(/^missing:/)
  expect(
    psql(`select count(*) from public.menu_item_photos where asset_id = ${sql(asset)}::uuid
      and venue_id = ${sql(w.venueB.id)}::uuid`)
  ).toBe("0")
  // Provenance is unchanged: the photo is venue A's.
  expect(
    psql(
      `select venue_id from public.media_assets where id = ${sql(asset)}::uuid`
    )
  ).toBe(w.venueA.id)

  const mgrB = await as(browser, w.mgrB, PHONE)
  await mgrB.goto("/manager/menu")
  await expect(menuRow(mgrB, "Soup")).toContainText("Still needs a photo")
  // Venue A's photo can't be opened from venue B.
  const res = await mgrB.request.get(`/api/media/${asset}/thumb`)
  expect(res.status()).toBe(404)
  await evidence(mgrB, "ac23-venue-b-soup")
})

test("AC26: marking a dish sold out keeps its photo requirement and its history", async ({
  browser,
}) => {
  const w = await provisionManagerWorld()
  const asset = await labelledPhoto(w.staffA1, w.venueA, [w.itemsA.soup])
  await acceptAsManager(w.mgrA, asset, w.itemsA.soup)
  const historyBefore = psql(`select count(*) from public.menu_item_photo_events
    where asset_id = ${sql(asset)}::uuid`)

  const mgr = await as(browser, w.mgrA, PHONE)
  for (const [item, before] of [
    [w.itemsA.soup, "covered"],
    [w.itemsA.pie, "missing"],
  ] as const) {
    await mgr.goto(`/manager/menu/${item}`)
    await expect(
      mgr.getByText("Its photo request and history stay as they are.")
    ).toBeVisible()
    await mgr.getByLabel("Why it is off").fill(`Sold out tonight ${w.tag}`)
    await mgr.getByRole("button", { name: "Mark not available" }).click()
    await expect(mgr.getByText("Not on today.")).toBeVisible()
    // The requirement stays, flagged unavailable; its state is unchanged.
    expect(slot(w.venueA.id, item)).toBe(`${before}:true:true`)
  }
  await evidence(mgr, "ac26-not-on-today")

  expect(photoRow(asset)).toMatch(/:accepted:/)
  expect(
    psql(`select count(*) from public.menu_item_photo_events
      where asset_id = ${sql(asset)}::uuid`)
  ).toBe(historyBefore)
  expect(
    psql(`select count(*) from public.menu_item_availability
      where item_id = ${sql(w.itemsA.soup)}::uuid`)
  ).not.toBe("0")

  // Back on: unchanged requirement, no longer flagged.
  await mgr.goto(`/manager/menu/${w.itemsA.soup}`)
  await mgr.getByRole("button", { name: "Back on the menu" }).click()
  await expect(mgr.getByText("On the menu today.")).toBeVisible()
  expect(slot(w.venueA.id, w.itemsA.soup)).toBe("covered:true:false")
})

test("AC27: a scheduled next menu leaves the current menu as it is until it activates", async ({
  browser,
}) => {
  const w = await provisionManagerWorld()
  const current = activeVersionId(w.venueA.id)
  const draft = await nextDraft(w, `Spring menu ${w.tag}`, "Stew")

  const admin = await as(browser, w.admin, DESKTOP)
  await admin.goto(`/admin/menus/versions/${draft}`)
  await admin.getByRole("button", { name: "Activate for labelling" }).click()
  const dialog = admin.getByRole("alertdialog", {
    name: "Activate this draft for labelling?",
  })
  await dialog
    .getByText(
      "Schedule for later. Until then the current menu stays as it is."
    )
    .click()
  const at = new Date(Date.now() + 2 * 24 * 3600 * 1000)
  const local = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/London",
    dateStyle: "short",
    timeStyle: "short",
  })
    .format(at)
    .replace(" ", "T")
  await dialog.getByLabel("Activate at").fill(local)
  await dialog.getByRole("button", { name: "Schedule activation" }).click()
  await expect(
    admin.getByText(/is scheduled to become active at/)
  ).toBeVisible()
  await evidence(admin, "ac27-scheduled")

  // Nothing changed for the current menu.
  expect(activeVersionId(w.venueA.id)).toBe(current)
  const mgr = await as(browser, w.mgrA, PHONE)
  await mgr.goto("/manager/menu")
  await expect(menuRow(mgr, "Soup")).toBeVisible()
  await expect(
    mgr.getByRole("main").getByText("Stew", { exact: true })
  ).toHaveCount(0)
  await mgr.goto("/manager/menu/versions")
  await expect(mgr.getByRole("main")).toContainText("Current menu since")
  await expect(mgr.getByRole("main")).toContainText(/Starts .* 1 new/)
  expect(activeVersionId(w.venueA.id)).toBe(current)
  await evidence(mgr, "ac27-manager-versions")

  // Time passes: the schedule comes due and the next menu takes over.
  psql(`update public.menu_versions set scheduled_for = now() - interval '1 minute'
    where id = ${sql(draft)}::uuid`)
  await mgr.goto("/manager/menu")
  await expect.poll(() => activeVersionId(w.venueA.id)).toBe(draft)
  await mgr.reload()
  await expect(
    mgr.getByRole("main").getByText("Stew", { exact: true }).first()
  ).toBeVisible()
})

const fixture = (name: string) =>
  fileURLToPath(new URL(`../../fixtures/menus/${name}`, import.meta.url))
const RAILWAY = fixture("the-railway.food.json")

async function previewImport(page: Page, venueId: string, path: string) {
  await page.goto(`/admin/menus/${venueId}`)
  const input = page.getByLabel("Menu file (JSON or CSV)")
  if ((await input.count()) === 0)
    await page.getByRole("button", { name: "Import a menu" }).click()
  await input.setInputFiles(path)
  await expect(
    page.getByRole("region", { name: "Changes from the active menu" })
  ).toBeVisible()
}

async function createAndOpenDraft(page: Page) {
  await page.getByRole("button", { name: "Create draft" }).click()
  await page.waitForURL(/\/admin\/menus\/versions\//)
}

const itemCount = (venueId: string) =>
  psql(
    `select count(*) from public.menu_items where venue_id = ${sql(venueId)}::uuid`
  )

test("AC28: importing the same menu again adds no offerings, and a retirement needs explicit approval", async ({
  browser,
}, testInfo) => {
  const world = await provisionWorld()
  const venue = world.venue1
  const admin = await as(browser, world.adminA, DESKTOP)

  await previewImport(admin, venue.id, RAILWAY)
  await createAndOpenDraft(admin)
  await admin.getByRole("button", { name: "Activate for labelling" }).click()
  await admin
    .getByRole("alertdialog")
    .getByRole("button", { name: "Activate for labelling" })
    .click()
  await expect(admin.getByRole("alertdialog")).toBeHidden()
  const first = activeVersionId(venue.id)
  const items = itemCount(venue.id)

  // The same file again: recognised, and nothing is duplicated.
  await previewImport(admin, venue.id, RAILWAY)
  await expect(admin.getByText("This file was already imported")).toBeVisible()
  await expect(
    admin.getByText(
      "It is the active menu. Creating a draft from it again changes nothing on its own."
    )
  ).toBeVisible()
  await evidence(admin, "ac28-already-imported")
  expect(itemCount(venue.id)).toBe(items)
  expect(activeVersionId(venue.id)).toBe(first)

  // A file without one dish: the retirement is proposed, not applied.
  const doc = JSON.parse(readFileSync(RAILWAY, "utf8"))
  doc.title = "The Railway food v2 (QA SYNTHETIC)"
  const appetisers = doc.sections.find(
    (s: { key: string }) => s.key === "appetisers"
  )
  appetisers.items = appetisers.items.filter(
    (i: { key: string }) => i.key !== "appetisers--spring-roll"
  )
  const v2 = testInfo.outputPath("railway-v2.qa-synthetic.json")
  writeFileSync(v2, JSON.stringify(doc, null, 2))
  await previewImport(admin, venue.id, v2)
  await expect(
    admin.getByRole("region", { name: "Proposed retirements" })
  ).toContainText("Spring Roll")
  await createAndOpenDraft(admin)
  await admin.getByRole("button", { name: "Activate for labelling" }).click()
  const dialog = admin.getByRole("alertdialog", {
    name: "Activate this draft for labelling?",
  })
  const activate = dialog.getByRole("button", {
    name: "Activate for labelling",
  })
  await expect(dialog).toContainText("Spring Roll")
  await expect(activate).toBeDisabled()
  await evidence(admin, "ac28-retirement-needs-approval")
  await dialog
    .getByText("Retire it from current coverage. Photos and history are kept.")
    .click()
  await activate.click()
  await expect(dialog).toBeHidden()
  expect(activeVersionId(venue.id)).not.toBe(first)
  // No offering was duplicated or deleted.
  expect(itemCount(venue.id)).toBe(items)
})
