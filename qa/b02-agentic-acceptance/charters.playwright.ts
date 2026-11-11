// B02-06 charters A and B (qualification plan §10) as two deterministic
// Playwright tests (charters.config.ts). They use what the e2e browser
// fixture has no method for: a real page close and a new page in the same
// signed-in context (A), and the browser's own offline switch (B). Both run
// in the shared recovery scope of this run's world, against the app run.mjs
// started; every outcome is read back from the database read-only.
//
// Copy is the candidate's: upload-dialog.tsx, upload-stopped.ts,
// media-tile.tsx, shell/entry-copy.ts, offline-notice.tsx, capture-form.tsx,
// capture/draft.ts and knowledge/copy.ts.
import { copyFileSync, existsSync } from "node:fs"
import { dirname, join } from "node:path"

import type { Browser, Page, Route } from "@playwright/test"

import { candidatePlaywright, CHARTERS, charterRunId } from "./charters.config"
import { db, QUESTION, readOnly, sessionCookies, target, uuid, world, type Person } from "./fixture"

const { test, expect } = candidatePlaywright()

const SIGNED_PUT = /\/storage\/v1\/object\/upload\/sign\//
const STOPPED = "Stopped. Choose the same photo again from Add to finish it; it continues where it stopped."
const OFFLINE_BODY = /^Loaded at \d{2}:\d{2}\. You've been offline since \d{2}:\d{2}\.$/
const SAVED_ON_PHONE = "Saved on this phone. It's saved to your account when you're back online with this page open."
const SAVED_FOR_LATER = "Saved for later. Not sent yet. Finish it from Home or Me."
const RESTORED_LOCAL = "Restored from this phone. It hasn't been sent."
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
const draftKey = (userId: string, checkId: string) => `nabalens.amenity-draft.v2:${userId}:${checkId}`

/** A new context on this run's app, signed in as `who` the fixture's way (cookies only, in memory). */
async function signedIn(browser: Browser, who: Person) {
  const context = await browser.newContext()
  await context.addCookies(await sessionCookies(who.email))
  return context
}

/**
 * Actual signed-upload PUTs from one page: method PUT at the guarded loopback
 * storage origin (target().api), matching the signed-upload path only.
 */
function watchPuts(page: Page) {
  const storage = target().api
  let puts = 0
  page.on("request", (r) => {
    if (r.method() === "PUT" && new URL(r.url()).origin === storage && SIGNED_PUT.test(r.url())) puts++
  })
  return () => puts
}

/** Server Function POSTs from one page: reservations (carry the file name) and finalises (carry an assetId). */
function watchActions(page: Page, file: string) {
  const bodies: string[] = []
  page.on("request", (r) => {
    if (r.method() === "POST" && r.headers()["next-action"]) bodies.push(r.postData() ?? "")
  })
  return {
    reserves: () => bodies.filter((b) => b.includes(file) && !b.includes('"assetId"')).length,
    finalises: () => bodies.filter((b) => b.includes('"assetId"')).length,
  }
}

/** The one account draft row for (user, check): author, answer, reason and revision only. */
function accountDraft(userId: string, checkId: string) {
  const out = readOnly(`select coalesce(json_agg(json_build_object(
      'user', user_id, 'answer', payload->>'answer', 'reason', payload->>'reason', 'revision', draft_revision)), '[]')
    from public.knowledge_drafts where user_id = ${uuid(userId)} and check_id = ${uuid(checkId)}`)
  return JSON.parse(out || "[]") as { user: string; answer: string; reason: string; revision: number }[]
}

const localDraft = async (page: Page, key: string) =>
  JSON.parse((await page.evaluate((k) => window.localStorage.getItem(k), key)) ?? "null") as { answer?: string; reason?: string } | null

/** Opens Home, then the check's own card or row (To do or Amenity checks), by its question. */
async function openCheckFromHome(page: Page, checkId: string, question: string) {
  await page.goto("/staff/tasks")
  await page
    .getByRole("main")
    .getByRole("link", { name: new RegExp(`^[A-Z][a-z]+( [a-z]+)*: ${escape(question)}$`) })
    .first()
    .click()
  await expect(page).toHaveURL(new RegExp(`/staff/tasks/amenities/${checkId}(\\?.*)?$`))
  await expect(page.getByRole("heading", { level: 1, name: question })).toBeVisible()
}

test.beforeAll(() => {
  // The world the e2e suites used, for this run and no other.
  expect(world().runId).toBe(charterRunId())
})

test(CHARTERS[0], async ({ browser }) => {
  const w = world()
  const who = w.staffRecover
  // A copy only this charter picks, made once: the re-pick must be the same
  // file (name, size, type, modified time), which is how the app finds the
  // unfinished asset again (lib/upload/upload-keys.ts).
  const file = `b02-charter-a-${w.tag}.jpg`
  const path = join(dirname(w.media.recover), file)
  if (existsSync(path)) throw new Error(`${file} exists: charter A runs once per world.`)
  copyFileSync(w.media.recover, path)
  expect(db.assets(who.id, file)).toEqual([])

  const context = await signedIn(browser, who)
  const first = await context.newPage()
  const firstActions = watchActions(first, file)
  const firstPuts = watchPuts(first)
  // The real signed PUT is latched: received, never answered, so it is in
  // flight when the page goes. The route is in place before the pick; only
  // a PUT at the loopback storage origin is held, anything else continues.
  const storage = target().api
  const latched: Route[] = []
  await first.route(SIGNED_PUT, (route) => {
    const request = route.request()
    if (request.method() !== "PUT" || new URL(request.url()).origin !== storage) return route.continue()
    latched.push(route)
  })
  await first.goto("/staff/tasks")
  await first.getByRole("banner").getByRole("button", { name: "Add photos", exact: true }).click()
  await first.getByRole("dialog", { name: "What are you adding?" }).getByRole("button", { name: /^Just photos/ }).click()
  await first.getByRole("dialog", { name: "Upload photos or videos" }).getByLabel("Choose photos or videos", { exact: true }).setInputFiles(path)
  const sheet = first.getByRole("dialog", { name: "Saving 1 photo" })
  await expect(sheet).toBeVisible()

  // One reservation, then its bytes in flight.
  await expect.poll(() => latched.length, { timeout: 30_000 }).toBe(1)
  expect(firstPuts()).toBe(1)
  expect(firstActions.reserves()).toBe(1)
  const reserved = db.assets(who.id, file)
  expect(reserved.map(({ filename, state, venue, deleted }) => ({ filename, state, venue, deleted }))).toEqual([
    { filename: file, state: "uploading", venue: w.scopes.recovery.venue.id, deleted: false },
  ])
  const assetId = reserved[0]!.id
  await expect(sheet.getByRole("list", { name: "Files" }).getByRole("listitem").filter({ hasText: file })).toContainText("Saving…")

  // The page closes mid-transfer (no beforeunload run: the tab is gone).
  await first.close()
  expect(first.isClosed()).toBe(true)
  for (const route of latched) await route.abort().catch(() => {})
  expect(firstActions.finalises()).toBe(0)
  expect(db.assets(who.id, file).map(({ id, state }) => ({ id, state }))).toEqual([{ id: assetId, state: "uploading" }])

  // A new page in the same signed-in context, from Home to Me.
  const second = await context.newPage()
  const secondActions = watchActions(second, file)
  const secondPuts = watchPuts(second)
  await second.goto("/staff/tasks")
  await expect(second).toHaveURL(/\/staff\/tasks$/)
  await second.getByRole("navigation", { name: "Staff" }).getByRole("link", { name: /^Me\b/ }).click()
  await expect(second).toHaveURL(/\/staff$/)
  const portfolio = second.getByRole("list", { name: "Your portfolio" })
  // The outer figure is scoped to the portfolio; the inner selector is
  // page-relative, because filter({ has }) resolves it from each candidate
  // figure (a portfolio-relative inner locator would seek a nested list).
  const tileSelector = `button[data-media-id="${assetId}"]`
  const figure = portfolio.locator("figure").filter({ has: second.locator(tileSelector) })
  await expect(figure).toHaveCount(1)
  const tile = figure.locator(tileSelector)
  await expect(tile).toHaveAccessibleName(/^Photo, uploaded [^,]+, Stopped$/)
  await expect(portfolio.getByRole("button", { name: /, Stopped$/ })).toHaveCount(1)
  await expect(figure.getByText(STOPPED, { exact: true })).toBeVisible()
  expect(secondPuts()).toBe(0)

  // The offered action, then the same file picked again: the same asset finishes.
  await figure.getByRole("button", { name: "Open Add", exact: true }).click()
  await second.getByRole("dialog", { name: "Upload photos or videos" }).getByLabel("Choose photos or videos", { exact: true }).setInputFiles(path)
  const again = second.getByRole("dialog", { name: "Saving 1 photo" })
  await expect(again.getByRole("status")).toHaveText("1 saved", { timeout: 60_000 })
  // One reserve RPC on each page is expected: the second reuses the first
  // reservation (same asset). Exactly one real PUT then carries the bytes.
  expect(secondActions.reserves()).toBe(1)
  expect(secondActions.finalises()).toBe(1)
  expect(secondPuts()).toBe(1)
  await expect
    .poll(() => db.assets(who.id, file).map(({ id, state, deleted }) => ({ id, state, deleted })), { timeout: 30_000 })
    .toEqual([{ id: assetId, state: "ready", deleted: false }])
  await again.getByRole("button", { name: "Done", exact: true }).click()
  // The same tile, now ready: Me shows label badges, so an unlabelled ready
  // photo's name ends in "Needs labels" (media-tile.tsx describe).
  await expect(tile).toHaveAccessibleName(/^Photo, uploaded [^,]+, Needs labels$/, { timeout: 30_000 })
  await expect(figure.getByText(STOPPED, { exact: true })).toHaveCount(0)
  await expect(portfolio.getByRole("button", { name: /, Stopped$/ })).toHaveCount(0)
  await expect(portfolio.locator(tileSelector)).toHaveCount(1)
  expect(db.assets(who.id, file).map(({ id, state, deleted }) => ({ id, state, deleted }))).toEqual([{ id: assetId, state: "ready", deleted: false }])
  expect(firstPuts() + secondPuts()).toBe(2)
  await second.screenshot({ path: test.info().outputPath("charter-a-ready.png") })
  await context.close()
})

test(CHARTERS[1], async ({ browser }) => {
  const w = world()
  const who = w.recoveryDraft
  const check = w.scopes.recovery.checks.step_free_entrance
  const question = QUESTION.step_free_entrance
  const reason = `DEV FIXTURE two steps at the door, typed offline (B02 charter B ${w.tag})`
  const key = draftKey(who.id, check)
  expect(accountDraft(who.id, check)).toEqual([])
  expect(db.contributions(check)).toEqual([])

  const context = await signedIn(browser, who)
  const page = await context.newPage()
  await openCheckFromHome(page, check, question)

  // The capture form is interactive while online: choosing No makes the
  // client render the Reason field, so the listeners are mounted before the
  // browser goes offline (not the offline-at-first-mount fallback).
  await page.getByRole("radio", { name: "No", exact: true }).check()
  await expect(page.getByLabel("Reason", { exact: true })).toBeVisible()
  await expect(page.getByRole("alert").filter({ hasText: "You're offline" })).toHaveCount(0)

  // The browser goes offline: the page knows, and says so once.
  await context.setOffline(true)
  expect(await page.evaluate(() => navigator.onLine)).toBe(false)
  const offline = page.getByRole("alert").filter({ hasText: "You're offline" })
  await expect(offline).toHaveCount(1)
  await expect(offline.getByText(OFFLINE_BODY)).toBeVisible()

  // Typed and saved offline: on this device only.
  await expect(page.getByRole("radio", { name: "No", exact: true })).toBeChecked()
  await page.getByLabel("Reason", { exact: true }).fill(reason)
  await page.getByRole("button", { name: "Save for later", exact: true }).click()
  await expect(page.getByText(SAVED_ON_PHONE, { exact: true })).toBeVisible()
  expect(await localDraft(page, key)).toMatchObject({ answer: "no", reason })
  expect(accountDraft(who.id, check)).toEqual([])

  await page.screenshot({ path: test.info().outputPath("charter-b-offline.png") })

  // Leaving: the page closes while offline, then the browser comes back
  // online with no page of this check open. The form's deferred save lived
  // in that page, so nothing can have saved it, and nothing did.
  expect(await page.evaluate(() => navigator.onLine)).toBe(false)
  await page.close()
  expect(page.isClosed()).toBe(true)
  expect(context.pages()).toHaveLength(0)
  await context.setOffline(false)
  expect(accountDraft(who.id, check)).toEqual([])
  expect(db.contributions(check)).toEqual([])

  // Back online, the same check from Home: the reason is still there.
  const back = await context.newPage()
  await openCheckFromHome(back, check, question)
  expect(await back.evaluate(() => navigator.onLine)).toBe(true)
  await expect(back.getByRole("alert").filter({ hasText: "You're offline" })).toHaveCount(0)
  await expect(back.getByText(RESTORED_LOCAL, { exact: true })).toBeVisible()
  await expect(back.getByRole("radio", { name: "No", exact: true })).toBeChecked()
  await expect(back.getByLabel("Reason", { exact: true })).toHaveValue(reason)
  expect(accountDraft(who.id, check)).toEqual([])

  // The explicit save reaches the account.
  await back.getByRole("button", { name: "Save for later", exact: true }).click()
  await expect(back.getByText(SAVED_FOR_LATER, { exact: true })).toBeVisible()
  await expect.poll(() => accountDraft(who.id, check), { timeout: 15_000 }).toEqual([{ user: who.id, answer: "no", reason, revision: 1 }])

  // One send: step-free always needs a manager's confirmation, so exactly one
  // finding waits (awaiting_confirmation); the draft is gone from the account
  // and this device.
  await back.getByRole("button", { name: "Submit finding", exact: true }).click()
  await expect(back).toHaveURL(`/staff/tasks?finding_sent=${check}`, { timeout: 30_000 })
  const notice = back.getByRole("status").filter({ hasText: "Finding sent" })
  await expect(notice).toHaveCount(1)
  await expect(notice).toContainText(`${question} Your manager confirms it before it's used.`)
  expect(db.contributions(check)).toEqual([{ by: who.id, kind: "finding", answer: "no", outcome: "awaiting_confirmation" }])
  expect(db.submissions(check)).toEqual([])
  expect(accountDraft(who.id, check)).toEqual([])
  expect(await localDraft(back, key)).toBeNull()

  // Stale-draft guard: reopened through the row's exact post-send action
  // (View: mine, waiting for confirmation), the sent draft does not come back.
  await back.goto("/staff/tasks")
  const view = back.getByRole("list", { name: "Amenity checks" }).getByRole("link", { name: `View: ${question}`, exact: true })
  await expect(view).toHaveCount(1)
  await view.click()
  await expect(back).toHaveURL(new RegExp(`/staff/tasks/amenities/${check}(\\?.*)?$`))
  await expect(back.getByRole("heading", { level: 1, name: question })).toBeVisible()
  await expect(back.getByText(RESTORED_LOCAL, { exact: true })).toHaveCount(0)
  await expect(back.getByText(/^You saved this on /)).toHaveCount(0)
  // An undecided finding of mine shows "Your latest finding" with "Change my
  // finding" in place of the form, which opens it prefilled from what I sent
  // (B01 capture page, kept unchanged by B02): No is checked, and the reason
  // typed offline must not come back from anywhere.
  const latest = back.getByRole("region", { name: "Your latest finding" })
  await expect(latest.getByText("Answer: No", { exact: true })).toBeVisible()
  await back.getByRole("button", { name: "Change my finding", exact: true }).click()
  await expect(back.getByRole("radio", { name: "No", exact: true })).toBeChecked()
  await expect(back.getByLabel("Reason", { exact: true })).toHaveValue("")
  expect((await localDraft(back, key))?.reason ?? "").toBe("")
  expect(accountDraft(who.id, check)).toEqual([])
  expect(db.contributions(check)).toHaveLength(1)
  await back.screenshot({ path: test.info().outputPath("charter-b-sent.png") })
  await context.close()
})
