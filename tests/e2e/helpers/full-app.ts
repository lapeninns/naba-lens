import { randomUUID } from "node:crypto"

import {
  expect,
  type BrowserContextOptions,
  type Locator,
  type Page,
  type TestInfo,
} from "@playwright/test"

import { signIn, type Db } from "../../support/identities"
import { escape } from "./ui"
import { phone } from "./upload-label-flow"
import { provisioner, psql } from "./stack"
import type { Person, Venue } from "./world"

/**
 * Full App v1 acceptance journeys (Sprint 3, S3-E2E-1): sizes, Album and
 * Match drivers, and read-only database checks. The service role only
 * provisions fixtures and reads where things ended up; every action under
 * test runs as the signed-in person in the browser.
 */

export const sql = (v: string) => `'${v.replace(/'/g, "''")}'`

/** The acceptance sizes (sprint3-plan.md Part 2). */
export const SIZES = {
  phone: phone(390, 844),
  narrow: phone(320, 640),
  desktop: { viewport: { width: 1280, height: 800 } },
} satisfies Record<string, BrowserContextOptions>
export type SizeName = keyof typeof SIZES

/**
 * Today, where staff land (DESIGN.md §5c): Asked for, retakes, the add
 * reminder, Match later, Other jobs and recent activity. These were on the
 * old Album home.
 */
export async function openToday(page: Page) {
  if (new URL(page.url()).pathname !== "/staff/home")
    await page.goto("/staff/home")
  await expect(page.locator("#today-top")).toBeVisible()
}

/**
 * The Album tab (DESIGN.md §5d) once its landing is on screen: Menu,
 * Amenities and Spaces, with search. A part is `/staff/album/menu|amenities|spaces`.
 */
export async function openAlbum(page: Page) {
  if (new URL(page.url()).pathname !== "/staff/album")
    await page.goto("/staff/album")
  await expect(page.locator('[data-slot="album-landing"]')).toBeVisible()
}

/** Add photos: the phone's Add tab or the AppBar button, whichever shows. */
export const albumAdd = (page: Page) =>
  page.locator('[data-slot="album-add"]').filter({ visible: true }).first()

/**
 * The add sheet while it posts (D21, DESIGN.md §6.1): "Saving 2 photos",
 * then "2 photos added" once every photo has finished.
 */
export const addSheet = (page: Page) =>
  page.getByRole("dialog", {
    name: /^(Saving \d+ (photos?|files?)|\d+ (photos?|files?) added)$/,
  })

/**
 * Album's Add photos, the phone's gallery (never a camera). Each ready photo
 * posts to the venue's private Album at once (D21); labelling is then or
 * later. Returns the sheet and what the gallery input asked for.
 */
export async function addPhotos(
  page: Page,
  paths: string[],
  trigger: Locator = albumAdd(page)
) {
  const chooser = page.waitForEvent("filechooser")
  await trigger.click()
  const fc = await chooser
  const input = {
    multiple: fc.isMultiple(),
    capture: await fc.element().getAttribute("capture"),
    accept: (await fc.element().getAttribute("accept")) ?? "",
  }
  await fc.setFiles(paths)
  const sheet = addSheet(page)
  await expect(sheet).toBeVisible()
  return { sheet, input }
}

/** The sheet's running count once `n` photos have posted ("2 posted"). */
export async function waitPosted(page: Page, n: number, timeout = 60_000) {
  await expect(
    addSheet(page)
      .getByRole("status")
      .filter({ hasText: /posted/ })
  ).toHaveText(new RegExp(`^${n} posted$`), { timeout })
}

/** Label photos (DESIGN.md §6.1, D21): tick photos, choose one label, Save. */
export const labelScreen = (page: Page) =>
  page.locator('[data-slot="match-later"]')

/** The sheet's Label now, once its photos have posted: Label photos. */
export async function labelNow(page: Page) {
  await addSheet(page).getByRole("link", { name: "Label now" }).click()
  const screen = labelScreen(page)
  await expect(screen).toBeVisible()
  return screen
}

/** Label photos straight from its route (Today's and My photos' way in). */
export async function openLabelPhotos(page: Page) {
  await page.goto("/staff/album/match-later?select=1")
  const screen = labelScreen(page)
  await expect(screen).toBeVisible()
  return screen
}

/** One photo's tick box on Label photos, found by its asset id. */
export const photoTick = (screen: Locator, assetId: string) =>
  screen.locator(`li[data-asset-id="${assetId}"]`).getByRole("checkbox")

/** Ticks these photos on Label photos (by asset id). */
export async function tickPhotos(screen: Locator, assetIds: string[]) {
  for (const id of assetIds) {
    const tick = photoTick(screen, id)
    await expect(tick).toBeVisible({ timeout: 30_000 })
    await tick.check()
  }
}

/** Label photos' search over the venue's dishes, drinks and spaces. */
export const labelSearch = (screen: Locator) =>
  screen.getByRole("searchbox", { name: "Search dishes, drinks and spaces" })

/** The confirm bar a chosen label fills; Save applies it (D21). */
export const labelConfirm = (screen: Locator) =>
  screen.locator('[data-slot="label-confirm"]')

/** The receipt after a save ("2 photos labelled Soup"). */
export const labelledWords = (count: number, slot: string) =>
  count === 1 ? `1 photo labelled ${slot}` : `${count} photos labelled ${slot}`

/** Saves the chosen label and waits for its receipt. */
export async function saveLabel(screen: Locator, count: number, slot: string) {
  const bar = labelConfirm(screen)
  await expect(bar).toContainText(
    count === 1
      ? `Label 1 photo as ${slot}`
      : `Label ${count} photos as ${slot}`
  )
  await bar.getByRole("button", { name: "Save label" }).click()
  await expect(
    screen.getByText(labelledWords(count, slot), { exact: true })
  ).toBeVisible({ timeout: 30_000 })
}

/** Ticks the photos, finds the slot by search and saves it as their label. */
export async function labelBySearch(
  screen: Locator,
  assetIds: string[],
  query: string,
  slot: string
) {
  await tickPhotos(screen, assetIds)
  await labelSearch(screen).fill(query)
  await slotChoice(screen, slot).click()
  await saveLabel(screen, assetIds.length, slot)
}

/**
 * Adds the photos, waits for them to post and labels them all as one slot
 * found by search: the D21 way to a labelled photo. Returns the asset ids.
 */
export async function postAndLabel(
  page: Page,
  files: { path: string; name: string }[],
  query: string,
  slot: string,
  trigger?: Locator
) {
  await addPhotos(
    page,
    files.map((f) => f.path),
    trigger
  )
  await waitPosted(page, files.length)
  const ids = await Promise.all(files.map((f) => assetNamed(f.name)))
  const screen = await labelNow(page)
  await labelBySearch(screen, ids, query, slot)
  return { ids, screen }
}

/** The picker's slot buttons ("Soup Not placed yet · Starters"). */
export const slotChoice = (scope: Locator, name: string) =>
  scope
    .locator('[data-slot="match-picker"]')
    .getByRole("button", { name: new RegExp(`^${escape(name)}\\b`) })
    .first()

/** Waits for the newest live asset with this file name and returns its id. */
export async function assetNamed(fileName: string, timeout = 30_000) {
  let id = ""
  await expect
    .poll(
      () =>
        (id = psql(`select coalesce((select id::text from public.media_assets
          where original_filename = ${sql(fileName)} and deleted_at is null
          order by created_at desc limit 1), '')`)),
      { timeout }
    )
    .not.toBe("")
  return id
}

export const assetsNamed = (fileName: string) =>
  Number(
    psql(`select count(*) from public.media_assets
      where original_filename = ${sql(fileName)} and deleted_at is null`)
  )

export const uploadStateOf = (assetId: string) =>
  psql(
    `select upload_state from public.media_assets where id = ${sql(assetId)}::uuid`
  )

export const venueOfAsset = (assetId: string) =>
  psql(
    `select venue_id from public.media_assets where id = ${sql(assetId)}::uuid`
  )

/** Dish names labelled on the asset, sorted, comma-joined ("" when none). */
export const dishesOn = (assetId: string) =>
  psql(`select coalesce(string_agg(item_name, ',' order by item_name), '')
    from public.media_label_items where asset_id = ${sql(assetId)}::uuid`)

/** Live place (area) labels on the asset, sorted, comma-joined. */
export const placesOn = (assetId: string) =>
  psql(`select coalesce(string_agg(subject_label, ',' order by subject_label), '')
    from public.media_area_labels
    where asset_id = ${sql(assetId)}::uuid and removed_at is null`)

/**
 * Labels on the asset that belong to ANOTHER venue's catalogue than the
 * asset's own (AC11): dish labels whose item is on no menu of the asset's
 * venue, and place labels at another venue. Counted, never expected > 0.
 */
export const foreignLabels = (assetId: string) =>
  Number(
    psql(`select
      (select count(*) from public.media_label_items li
        join public.media_assets a on a.id = li.asset_id
        where li.asset_id = ${sql(assetId)}::uuid
          and not exists (
            select 1 from public.menu_entries e
            join public.menu_versions v on v.id = e.version_id
            where e.item_id = li.item_id and v.venue_id = a.venue_id))
      + (select count(*) from public.media_area_labels l
        join public.media_assets a on a.id = l.asset_id
        where l.asset_id = ${sql(assetId)}::uuid and l.removed_at is null
          and l.venue_id <> a.venue_id)`)
  )

/** DEV FIXTURE: a place (Album area slot) at the venue, as its manager made it. */
export function createPlace(
  venue: Pick<Venue, "id">,
  label: string,
  by: Person
) {
  return psql(`insert into public.knowledge_subjects (venue_id, kind, label, created_by)
    values (${sql(venue.id)}::uuid, 'area', ${sql(label)}, ${sql(by.id)}::uuid)
    returning id`)
}

/**
 * A manager's request for a photo of a dish (S2-REQ), made through the real
 * RPC in the manager's own session (fixture: the request screen is S3-E2E-2's).
 */
export async function requestDishPhoto(
  manager: Pick<Person, "email">,
  venue: Pick<Venue, "id">,
  itemId: string,
  brief: string
): Promise<string> {
  const db: Db = await signIn(provisioner(), manager.email)
  const { data, error } = await (
    db.rpc as unknown as (
      n: string,
      a: Record<string, unknown>
    ) => PromiseLike<{ data: unknown; error: { message: string } | null }>
  )("media_request_create", {
    p_venue_id: venue.id,
    p_type: "missing_photo",
    p_intended_use: "public",
    p_brief: brief,
    p_slot_kind: "dish",
    p_slot_id: itemId,
    p_photo_count: 1,
    p_priority: "normal",
    p_wants_video: false,
  })
  if (error) throw new Error(`media_request_create: ${error.message}`)
  return (data as { id: string }).id
}

/** A screenshot kept with the test's output, for the report. */
export async function keep(page: Page, info: TestInfo, name: string) {
  const path = info.outputPath(`${name}.png`)
  await page.screenshot({ path, fullPage: true })
  return path
}

export const newKey = () => randomUUID()
