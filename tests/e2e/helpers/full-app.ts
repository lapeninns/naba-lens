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

/** Album (Home) once its content, not the loading skeleton, is on screen. */
export async function openAlbum(page: Page) {
  if (new URL(page.url()).pathname !== "/staff/tasks")
    await page.goto("/staff/tasks")
  await expect(page.locator('[data-slot="album-home"]')).toBeVisible()
}

/** Album's Add photos: the phone tab or the AppBar button, whichever shows. */
export const albumAdd = (page: Page) =>
  page.locator('[data-slot="album-add"]').filter({ visible: true }).first()

export const matchScreen = (page: Page) =>
  page.locator('[data-slot="match-screen"]')

/**
 * Album's Add photos, the phone's gallery (never a camera), then Match.
 * Returns what the gallery input asked for.
 */
export async function startMatch(
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
  const match = matchScreen(page)
  await expect(match).toBeVisible()
  return { match, input }
}

/** The picker's slot buttons ("Soup Not placed yet · Starters"). */
export const slotChoice = (scope: Locator, name: string) =>
  scope
    .locator('[data-slot="match-picker"]')
    .getByRole("button", { name: new RegExp(`^${escape(name)}\\b`) })
    .first()

/** Answers the shown photo with a slot found by search (spec §5.3). */
export async function matchBySearch(
  match: Locator,
  query: string,
  slot: string
) {
  await match.getByRole("searchbox", { name: "Search all slots" }).fill(query)
  await slotChoice(match, slot).click()
}

/** Match's end, once every photo has an answer. */
export const matchSummary = (page: Page) =>
  page.locator('[data-slot="match-summary"]')

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
