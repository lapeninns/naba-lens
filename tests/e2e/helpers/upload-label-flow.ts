import { randomUUID } from "node:crypto"
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

import {
  devices,
  expect,
  type BrowserContextOptions,
  type Locator,
  type Page,
  type Request,
  type TestInfo,
} from "@playwright/test"

import { signIn, type Db } from "../../support/identities"
import { addJustPhotos } from "./add-entry"
import { legacyStaffGrant, type CoverageWorld } from "./coverage-world"
import { syntheticJpeg, type SourceFile } from "./media"
import { activateMenu, ok } from "./menus"
import { provisioner, psql } from "./stack"
import type { Person } from "./world"

/**
 * Helpers for upload-label-flow.spec.ts: the staff upload + labelling flow
 * (one "Saving N photos" sheet, labels stored on the server by asset id).
 * The service role only provisions fixtures and reads the database to check
 * where labels ended up; every action under test runs as a signed-in person.
 */

export const sql = (v: string) => `'${v.replace(/'/g, "''")}'`

/** A phone-sized Chromium context (touch, mobile UA) at `width` CSS px. */
export function phone(width: number, height = 800): BrowserContextOptions {
  return {
    ...devices["Pixel 7"],
    viewport: { width, height },
    screen: { width, height },
  }
}

// ---------------------------------------------------------------------------
// Taps and modals, counted explicitly as the audit did (J5, J1, J3)
// ---------------------------------------------------------------------------

/**
 * Counts app taps. Typing into a field after focusing it counts as one
 * interaction, and choosing files in the system picker is not an app tap.
 */
export class TapCounter {
  taps = 0
  readonly steps: string[] = []
  /** Dialogs the flow passed through, by name, in order. */
  readonly dialogs: string[] = []

  dialog(name: string) {
    this.dialogs.push(name)
  }

  async tap(target: Locator, step = String(target)) {
    this.taps += 1
    this.steps.push(step)
    await target.click()
  }

  async type(target: Locator, text: string, step = `type ${text}`) {
    this.taps += 1
    this.steps.push(step)
    await target.fill(text)
  }
}

/**
 * Counts every dialog or alertdialog element that appears in the document
 * from the next navigation on. Call before page.goto; reset with
 * resetModals once the page has settled.
 */
export async function countModals(page: Page) {
  await page.context().addInitScript(() => {
    type Seen = { count: number; names: string[] }
    const w = window as unknown as { __e2eModals: Seen }
    w.__e2eModals = { count: 0, names: [] }
    const seen = new WeakSet<Element>()
    const nameOf = (el: Element) => {
      const by = el.getAttribute("aria-labelledby")
      return (
        el.getAttribute("aria-label") ??
        (by ? document.getElementById(by)?.textContent : null) ??
        el.getAttribute("role") ??
        "?"
      )
    }
    const scan = () => {
      for (const el of document.querySelectorAll(
        "[role=dialog],[role=alertdialog]"
      )) {
        if (seen.has(el)) continue
        seen.add(el)
        w.__e2eModals.count += 1
        w.__e2eModals.names.push(nameOf(el))
      }
    }
    new MutationObserver(scan).observe(document, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["role"],
    })
  })
}

export async function resetModals(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as {
      __e2eModals: { count: number; names: string[] }
    }
    w.__e2eModals.count = 0
    w.__e2eModals.names = []
  })
}

export function modalsOpened(page: Page) {
  return page.evaluate(
    () =>
      (window as unknown as { __e2eModals: { count: number; names: string[] } })
        .__e2eModals
  )
}

/**
 * Keeps a journey's measured taps and modals before its budget is asserted,
 * so a budget failure still leaves the actual totals: a JSON file in the
 * test's output (attached), an annotation, and a line in the run's log.
 */
export async function recordBudget(
  testInfo: TestInfo,
  name: string,
  taps: TapCounter,
  modals: { count: number; names: string[] },
  limits: { taps: number; modals: number }
) {
  const measured = {
    route: taps.steps.join(" > "),
    taps: taps.taps,
    tapSteps: taps.steps,
    tapCounterDialogs: taps.dialogs,
    modals: modals.count,
    modalNames: modals.names,
    limits,
  }
  const file = testInfo.outputPath(`${name}-taps-and-modals.json`)
  writeFileSync(file, JSON.stringify(measured, null, 2))
  await testInfo.attach(`${name}-taps-and-modals`, {
    path: file,
    contentType: "application/json",
  })
  const line = `${name}: ${measured.taps} taps (limit ${limits.taps}; ${measured.route}); ${measured.modals} modals (limit ${limits.modals}; ${modals.names.join(", ")})`
  testInfo.annotations.push({ type: "taps-and-modals", description: line })
  console.log(`taps and modals, ${line}`)
  return measured
}

// ---------------------------------------------------------------------------
// Staff UI
// ---------------------------------------------------------------------------

/** Phone tab bar Add (its name gains ", 1 in progress" while busy). */
export const addTab = (page: Page) =>
  page.locator('[data-slot="tabbar"]').getByRole("button", { name: /^Add/ })

export const addSheet = (page: Page) =>
  page.getByRole("dialog", { name: "Add photos" })

/** The upload sheet once files are picked: "Saving 1 photo", "Saving 2 files". */
export const savingSheet = (page: Page, title?: string) =>
  page.getByRole("dialog", {
    name: title ?? /^Saving \d+ (photo|file)s?$/,
  })

export const fileRow = (sheet: Locator, fileName: string) =>
  sheet
    .getByRole("list", { name: "Files" })
    .getByRole("listitem")
    .filter({ hasText: fileName })

export const doneButton = (sheet: Locator) =>
  sheet.getByRole("button", { name: "Done", exact: true })

/** The common "What's in these photos?" field (", for all files" with several). */
export const COMMON_FIELD = /^What's in these photos\?/
export const COMMON_FIELD_SEVERAL = /^What's in these photos\?.*for all files$/

/** Clicks `trigger`, which must open the system file picker, and picks `paths`. */
export async function pickFiles(
  page: Page,
  trigger: Locator,
  paths: string[],
  taps?: TapCounter
) {
  const chooser = page.waitForEvent("filechooser")
  if (taps) await taps.tap(trigger, "open picker")
  else await trigger.click()
  const fc = await chooser
  const input = {
    multiple: fc.isMultiple(),
    capture: await fc.element().getAttribute("capture"),
    accept: await fc.element().getAttribute("accept"),
  }
  await fc.setFiles(paths)
  return input
}

/**
 * Phone Add while idle: tab, "Just photos" in the intent dialog, then
 * "Choose from your photos" in the Add sheet.
 */
export async function addFromLibrary(
  page: Page,
  paths: string[],
  taps?: TapCounter
) {
  await addJustPhotos(page, addTab(page), taps)
  await expect(addSheet(page)).toBeVisible()
  taps?.dialog("Add photos")
  await pickFiles(
    page,
    addSheet(page).getByRole("button", { name: /^Choose from your photos/ }),
    paths,
    taps
  )
  const sheet = savingSheet(page)
  await expect(sheet).toBeVisible()
  taps?.dialog("Saving sheet")
  return sheet
}

/** Types into a menu item search and chooses the first matching option. */
export async function chooseDish(
  scope: Locator,
  field: string | RegExp,
  query: string,
  option: RegExp,
  taps?: TapCounter
) {
  const combo = scope.getByRole("combobox", { name: field })
  if (taps) await taps.type(combo, query)
  else await combo.fill(query)
  const choice = scope.getByRole("option", { name: option }).first()
  if (taps) await taps.tap(choice, `option ${option}`)
  else await choice.click()
}

/**
 * A same-origin link outside /staff. Staff pages have no such link of their
 * own; this stands in for one (the leave guard watches every anchor).
 */
export async function addOutsideLink(page: Page, href = "/login") {
  await page.evaluate((to) => {
    const a = document.createElement("a")
    a.href = to
    a.id = "e2e-outside-link"
    a.textContent = "Outside link"
    a.setAttribute(
      "style",
      "position:fixed;top:0;left:0;z-index:2147483647;background:#fff;padding:12px"
    )
    document.body.append(a)
  }, href)
  return page.locator("#e2e-outside-link")
}

// ---------------------------------------------------------------------------
// Network: hold a request (and optionally its answer) until the test says so
// ---------------------------------------------------------------------------

export type Gate = {
  /** The first matching request reached the browser's network layer. */
  seen: Promise<Request>
  /** holdResponse only: the server has answered the first held request. */
  answered: Promise<void>
  /** Lets held and later matching requests go to the server. */
  forward: () => void
  /** holdResponse only: hands the server's answers to the page. */
  deliver: () => void
}

export async function gate(
  page: Page,
  match: (request: Request) => boolean,
  { holdResponse = false }: { holdResponse?: boolean } = {}
): Promise<Gate> {
  let onSeen!: (r: Request) => void
  let onAnswered!: () => void
  let forward!: () => void
  let deliver!: () => void
  const seen = new Promise<Request>((r) => (onSeen = r))
  const answered = new Promise<void>((r) => (onAnswered = r))
  const forwarded = new Promise<void>((r) => (forward = r))
  const delivered = new Promise<void>((r) => (deliver = r))
  await page.route("**/*", async (route) => {
    const request = route.request()
    if (!match(request)) return route.fallback()
    onSeen(request)
    await forwarded
    if (!holdResponse) {
      await route.continue().catch(() => {})
      return
    }
    // The server runs the request now; only its answer waits.
    const response = await route.fetch().catch(() => null)
    onAnswered()
    if (!response) return route.abort().catch(() => {})
    await delivered
    await route.fulfill({ response }).catch(() => {})
  })
  return { seen, answered, forward, deliver }
}

const path = (r: Request) => new URL(r.url()).pathname

/**
 * The finaliseUpload Server Action: a POST with a Next-Action header whose
 * argument has an assetId and no filename (reserveUpload's has a filename).
 */
export function isFinalise(request: Request) {
  if (request.method() !== "POST" || !request.headers()["next-action"])
    return false
  const body = request.postData() ?? ""
  return body.includes('"assetId"') && !body.includes('"filename"')
}

/** The reserveUpload Server Action (its argument carries the file name). */
export function isReserve(request: Request) {
  return (
    request.method() === "POST" &&
    !!request.headers()["next-action"] &&
    (request.postData() ?? "").includes('"filename"')
  )
}

export const isLabelPost = (r: Request) =>
  r.method() === "POST" && path(r) === "/api/upload-labels"

/** Videos (and photos over 6 MiB) transfer through Storage's TUS endpoint. */
export const isTusTransfer = (r: Request) =>
  path(r).includes("/storage/v1/upload/resumable")

/** Small photos transfer with one signed PUT. */
export const isSignedPut = (r: Request) =>
  r.method() === "PUT" && path(r).includes("/storage/v1/object/upload/sign/")

// ---------------------------------------------------------------------------
// Media
// ---------------------------------------------------------------------------

const dir = mkdtempSync(join(tmpdir(), "nabalens-label-flow-"))

/** A JPEG cut at 60%: right signature, broken scan data (finalise rejects it). */
export async function corruptJpeg(name: string): Promise<SourceFile> {
  const whole = await syntheticJpeg(`whole-${name}`)
  const bytes = readFileSync(whole.path)
  const file = join(dir, name)
  writeFileSync(file, bytes.subarray(0, Math.floor(bytes.length * 0.6)))
  return { path: file, name, sha256: "" }
}

// ---------------------------------------------------------------------------
// Database reads (service role, read-only) and fixture writes
// ---------------------------------------------------------------------------

/** Live (not deleted) assets with this exact original file name, oldest first. */
export function assetIdsNamed(fileName: string): string[] {
  const out =
    psql(`select coalesce(string_agg(id::text, ',' order by created_at), '')
    from public.media_assets where original_filename = ${sql(fileName)} and deleted_at is null`)
  return out ? out.split(",") : []
}

/** Waits for the one asset reserved for `fileName` and returns its id. */
export async function assetIdFor(fileName: string, timeout = 30_000) {
  await expect
    .poll(() => assetIdsNamed(fileName).length, { timeout })
    .toBeGreaterThan(0)
  return assetIdsNamed(fileName)[0]!
}

export const uploadState = (assetId: string) =>
  psql(
    `select upload_state from public.media_assets where id = ${sql(assetId)}`
  )

/** Dish names on the asset, sorted and comma-joined ("" when none). */
export const labelsOn = (assetId: string) =>
  psql(`select coalesce(string_agg(item_name, ',' order by item_name), '')
    from public.media_label_items where asset_id = ${sql(assetId)}`)

/** "name|variant_id|variant_name" per label item (null shown as "null"). */
export const labelItems = (assetId: string) =>
  psql(`select coalesce(string_agg(item_name || '|' || coalesce(variant_id::text, 'null')
      || '|' || coalesce(variant_name, 'null'), ';' order by item_name), '')
    from public.media_label_items where asset_id = ${sql(assetId)}`)

/** "pending", "needs_attention|catalogue_changed", or "" when nothing is kept. */
export const keptLabels = (assetId: string) =>
  psql(`select coalesce(max(status || coalesce('|' || code, '')), '')
    from public.media_pending_labels where asset_id = ${sql(assetId)}`)

export const keptInput = (assetId: string) =>
  psql(
    `select coalesce(max(input::text), '') from public.media_pending_labels where asset_id = ${sql(assetId)}`
  )

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

/** An asset row still uploading (no bytes), as reserve leaves it. */
export async function seedUploadingAsset(
  uploaderId: string,
  venueId: string,
  fileName: string
) {
  const id = randomUUID()
  const { error } = await provisioner()
    .from("media_assets")
    .insert({
      id,
      uploader_id: uploaderId,
      venue_id: venueId,
      original_path: `${uploaderId}/${id}/original.jpg`,
      original_filename: fileName,
      media_type: "image",
    })
  if (error) throw error
  return id
}

// ---------------------------------------------------------------------------
// Menus and tasks
// ---------------------------------------------------------------------------

const RAILWAY = fileURLToPath(
  new URL("../../fixtures/menus/the-railway.food.json", import.meta.url)
)
export const RAILWAY_TITLE = "The Railway food (DEV FIXTURE)"

/** Imports and activates The Railway food menu through the Menus admin UI. */
export async function importRailway(admin: Page, venueId: string) {
  await admin.goto(`/admin/menus/${venueId}`)
  await admin.getByRole("button", { name: "Import a menu" }).click()
  await admin.getByLabel("Menu file (JSON or CSV)").setInputFiles(RAILWAY)
  await admin.getByRole("button", { name: "Create draft" }).click()
  await admin.waitForURL(/\/admin\/menus\/versions\//)
  await expect(
    admin.getByRole("heading", { level: 1, name: RAILWAY_TITLE })
  ).toBeVisible()
  await admin.getByRole("button", { name: "Activate for labelling" }).click()
  await admin
    .getByRole("alertdialog")
    .getByRole("button", { name: "Activate for labelling" })
    .click()
  await expect(
    admin.getByRole("button", { name: "Start a draft from this version" })
  ).toBeVisible()
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-")

/**
 * DEV FIXTURE: a draft with these sections and dish names, made and activated
 * as the Menus admin. Every call makes new menu items (itemId null), so a
 * dish left out of the next menu is no longer on the active menu.
 */
export async function activateSmallMenu(
  admin: Db,
  venueId: string,
  title: string,
  sections: Record<string, string[]>
) {
  const versionId = (await ok(
    admin.rpc("create_menu_draft", {
      p_venue_id: venueId,
      p_title: title,
      p_source: {
        kind: "json",
        label: "DEV FIXTURE menu.json",
        sha256: "b".repeat(64),
        revision: null,
        capturedAt: "2026-11-07T10:00:00Z",
        notes: null,
      } as never,
      p_document: {
        title,
        sections: Object.entries(sections).map(([name, dishes]) => ({
          slug: slug(name),
          name,
          kind: "food",
          items: dishes.map((dish) => ({
            itemId: null,
            sourceKey: `${slug(name)}--${slug(dish)}`,
            name: dish,
            description: null,
            aliases: [],
            sourceMeta: {},
            variants: [],
            review: null,
          })),
        })),
      } as never,
    })
  )) as string
  await activateMenu(admin, versionId)
  return versionId
}

/**
 * A venue task assigned to `assignee`, created by the venue manager (a legacy
 * staff grant) through the real coverage RPCs. Returns its id.
 */
export async function assignedTask(
  world: CoverageWorld,
  assignee: Pick<Person, "id">,
  title: string
) {
  await legacyStaffGrant(world.admin, world.manager, world.venue1)
  const manager = await signIn(provisioner(), world.manager.email)
  const none = null as never
  const [row] = (await ok(
    manager.rpc("save_coverage_requirement", {
      p_venue_id: world.venue1.id,
      p_requirement_id: none,
      p_expected_revision: none,
      p_kind: "venue_specific",
      p_title: title,
      p_guidance: none,
      p_photo_target: 2,
      p_due_on: none,
      p_client_request_key: `label-flow-${randomUUID()}`,
    })
  )) as { requirement_id: string }[]
  const requirementId = row!.requirement_id
  await ok(
    manager.rpc("set_coverage_requirement_assignees", {
      p_requirement_id: requirementId,
      p_staff_ids: [assignee.id],
    })
  )
  return requirementId
}
