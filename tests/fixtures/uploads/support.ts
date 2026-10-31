import { execFileSync } from "node:child_process"

import {
  expect,
  type Browser,
  type Locator,
  type Page,
  type Request,
} from "@playwright/test"

import { provisioner } from "../../e2e/helpers/stack"
import {
  provisionWorld,
  signedInPage,
  type Person,
} from "../../e2e/helpers/world"

/**
 * Shared pieces of the media upload journeys: fixtures from
 * tests/fixtures/uploads/generate.mjs, the upload dialog, and observation of
 * the real storage traffic (signed PUT and TUS) of one page. Nothing in the app
 * is mocked: interruptions are shaped with Playwright routes or the browser's
 * offline switch, and server state is read back with the service client.
 */

export const MiB = 1024 * 1024
/** Supabase requires exactly 6 MiB chunks on its resumable endpoint. */
export const CHUNK = 6 * MiB

export const STORAGE_UPLOAD =
  /\/storage\/v1\/(object\/upload\/sign\/|upload\/resumable)/
export const SIGNED_PUT = /\/storage\/v1\/object\/upload\/sign\//
export const TUS = /\/storage\/v1\/upload\/resumable/

type Fixtures = { dir: string; files: Record<string, string> }
let cached: Fixtures | null = null

export function fixtureFile(name: string): string {
  cached ??= JSON.parse(
    execFileSync(process.execPath, ["tests/fixtures/uploads/generate.mjs"], {
      encoding: "utf8",
    })
  ) as Fixtures
  const path = cached.files[name.replace(/[.-]/g, "_")]
  if (!path) throw new Error(`fixture ${name} missing`)
  return path
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** One unique world; the staff member of venue one is the uploader. */
export async function stage(browser: Browser, baseURL: string) {
  const world = await provisionWorld()
  const page = await signedInPage(browser, world.staffA, { baseURL })
  await expect(page).toHaveURL(/\/staff$/)
  return { world, staff: world.staffA, page }
}

export async function signInAs(
  browser: Browser,
  who: Pick<Person, "email">,
  baseURL: string,
  home: RegExp
) {
  const page = await signedInPage(browser, who, { baseURL })
  await expect(page).toHaveURL(home)
  return page
}

export type AssetRow = {
  id: string
  original_filename: string
  media_type: string
  upload_state: string
  validated_mime_type: string | null
  size_bytes: number | null
  original_path: string
  created_at: string
  deleted_at: string | null
}

export async function rowsOf(uploaderId: string): Promise<AssetRow[]> {
  const { data, error } = await provisioner()
    .from("media_assets")
    .select(
      "id, original_filename, media_type, upload_state, validated_mime_type, size_bytes, original_path, created_at, deleted_at"
    )
    .eq("uploader_id", uploaderId)
    .order("created_at")
  if (error) throw error
  return data as AssetRow[]
}

export async function objectsOf(uploaderId: string, assetId: string) {
  const { data, error } = await provisioner()
    .storage.from("media")
    .list(`${uploaderId}/${assetId}`)
  if (error) throw error
  return data.map((o) => o.name).sort()
}

export async function openUploadDialog(page: Page) {
  await page
    .getByRole("button", { name: "Upload photos or videos" })
    .first()
    .click()
  const dialog = page.getByRole("dialog", { name: "Upload photos or videos" })
  await expect(dialog).toBeVisible()
  return dialog
}

export async function chooseAndUpload(
  dialog: Locator,
  files: string[]
): Promise<void> {
  await dialog
    .getByLabel("Choose photos or videos")
    .setInputFiles(files.map(fixtureFile))
  await dialog
    .getByRole("button", {
      name: `Upload ${files.length} ${files.length === 1 ? "file" : "files"}`,
    })
    .click()
}

/** The queue row of one file in the upload dialog. */
export const row = (dialog: Locator, name: string) =>
  dialog
    .getByRole("list", { name: "Files" })
    .getByRole("listitem")
    .filter({ has: dialog.page().getByText(name, { exact: true }) })

/** Waits for the run to settle; on a mismatch the message lists every file's row. */
export async function expectSummary(
  dialog: Locator,
  expected: string,
  timeout = 60_000
) {
  const status = dialog.getByRole("status")
  await expect(status).toBeVisible({ timeout })
  const files = await dialog.getByRole("list", { name: "Files" }).innerText()
  expect(await status.textContent(), files).toBe(expected)
}

export const portfolio = (page: Page) =>
  page.getByRole("list", { name: "Your portfolio" })

/** A portfolio tile by file name; `state` is the suffix of its accessible name. */
export function tileOf(
  page: Page,
  fileName: string,
  state?: "Uploading" | "Processing" | "Failed" | "ready"
) {
  const base = `^(Photo|Video), ${fileName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}, `
  const name =
    state === undefined
      ? new RegExp(base)
      : state === "ready"
        ? new RegExp(`${base}uploaded (?!.*, (Uploading|Processing|Failed)$)`)
        : new RegExp(`${base}uploaded [^,]+, ${state}$`)
  return portfolio(page).getByRole("button", { name })
}

/** Storage upload requests of a page and the bytes the server received. */
export function watchStorage(page: Page) {
  const inFlight = new Set<Request>()
  const log: {
    method: string
    url: string
    offset: number | null
    length: number | null
  }[] = []
  const delivered: { method: string; bytes: number }[] = []
  const pending: Promise<void>[] = []
  page.on("request", (r) => {
    if (!STORAGE_UPLOAD.test(r.url()) || r.method() === "OPTIONS") return
    inFlight.add(r)
    const headers = r.headers()
    const offset = headers["upload-offset"]
    const length = headers["content-length"]
    log.push({
      method: r.method(),
      url: r.url(),
      offset: offset === undefined ? null : Number(offset),
      length: length === undefined ? null : Number(length),
    })
  })
  page.on("requestfinished", (r) => {
    if (!inFlight.delete(r)) return
    // A finished PATCH answers with the new offset: the difference is what the
    // server stored from this request.
    const sent = Number(r.headers()["upload-offset"] ?? 0)
    pending.push(
      r
        .response()
        .then((res) => res?.allHeaders())
        .then((h) => {
          const next = Number(h?.["upload-offset"])
          if (r.method() === "PATCH" && Number.isFinite(next))
            delivered.push({ method: "PATCH", bytes: next - sent })
        })
        .catch(() => {})
    )
  })
  page.on("requestfailed", (r) => void inFlight.delete(r))
  return {
    log,
    methods: () => log.filter((r) => TUS.test(r.url)).map((r) => r.method),
    patchOffsets: () =>
      log
        .filter((r) => TUS.test(r.url) && r.method === "PATCH")
        .map((r) => r.offset),
    /** PATCH bodies whose request finished, i.e. reached the server. */
    deliveredPatchBytes: async () => {
      await Promise.all(pending)
      return delivered
        .filter((d) => d.method === "PATCH")
        .reduce((sum, d) => sum + d.bytes, 0)
    },
    reset() {
      log.length = 0
      delivered.length = 0
      pending.length = 0
    },
  }
}

/** Server Function calls posted from the staff page (reserve and finalise). */
export function watchActions(page: Page) {
  const bodies: string[] = []
  page.on("request", (r) => {
    if (r.method() === "POST" && r.headers()["next-action"]) {
      bodies.push(r.postData() ?? "")
    }
  })
  return {
    bodies,
    finalises: () => bodies.filter((b) => b.includes('"assetId"')),
  }
}

/** True when the request is a finalise Server Function call (it carries the asset id). */
export const isFinalise = (request: Request) =>
  request.method() === "POST" &&
  Boolean(request.headers()["next-action"]) &&
  (request.postData() ?? "").includes('"assetId"')

/** The date as the app prints it: en-GB, Europe/London. */
export function appDate(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Europe/London",
  }).format(new Date(iso))
}
