import {
  devices,
  expect,
  test,
  type BrowserContext,
  type Page,
} from "@playwright/test"

import {
  createIdentity,
  createVenue,
  serviceClient,
  type TestIdentity,
} from "../support/identities"
import { openEmailLink } from "./helpers/email-link"
import { mailboxIds, waitForSignInEmail } from "./helpers/mailpit"
import { convertToManager } from "./helpers/manager-world"
import { STAFF_LANDING } from "./helpers/ui"

/**
 * AUTH-1 and AUTH-2 in the built app: a signed-out person who opens a deep
 * link signs in (link or code) and lands on that exact page and query, within
 * their role's area only; an unsafe ?next= is never followed or echoed; and a
 * manager whose session ends mid-task signs in again over the page without
 * losing what they typed (charter C-2, automated part).
 */

test.describe.configure({ mode: "serial" })
test.setTimeout(180_000)

const PHONE = {
  viewport: { width: 390, height: 844 },
  userAgent: devices["Pixel 7"].userAgent,
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
}

const service = serviceClient()
let venueId: string
let staff: TestIdentity
let manager: TestIdentity
let admin: TestIdentity

test.beforeAll(async () => {
  const venue = await createVenue(service, "e2e-return")
  venueId = venue.id
  admin = await createIdentity(service, {
    label: "e2e-return-admin",
    role: "admin",
  })
  staff = await createIdentity(service, {
    label: "e2e-return-staff",
    role: "staff",
    venueId,
    session: false,
  })
  // A real manager account: created as staff, converted by the admin.
  manager = await createIdentity(service, {
    label: "e2e-return-manager",
    role: "staff",
    venueId,
    session: false,
  })
  await convertToManager(admin.client, manager, { id: venueId })
})

const loginFor = (path: string) =>
  new RegExp(`/login\\?next=${escapeRegExp(encodeURIComponent(path))}$`)

function escapeRegExp(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

async function returnCookie(context: BrowserContext) {
  return (await context.cookies()).find((c) => c.name === "nl-return-to")
}

/** Request a sign-in email from the login page in view; returns link and code. */
async function requestSignIn(page: Page, email: string) {
  const seen = await mailboxIds(email)
  await page.getByLabel("Email").fill(email)
  await page.getByRole("button", { name: "Send sign-in link" }).click()
  await expect(
    page.getByRole("heading", { name: "Check your email" })
  ).toBeVisible()
  return waitForSignInEmail(email, seen)
}

async function enterCode(page: Page, code: string) {
  await page.getByLabel("Sign-in code").fill(code)
  await page.getByRole("button", { name: "Sign in with code" }).click()
}

test.describe("deep links survive sign-in (AUTH-1)", () => {
  test("staff: link sign-in returns to the exact page and query", async ({
    page,
  }) => {
    const deepLink = "/staff/people?q=TEST"
    await page.goto(deepLink)
    await expect(page).toHaveURL(loginFor(deepLink))
    // Remembered for the emailed link, which cannot carry it.
    expect(await returnCookie(page.context())).toMatchObject({
      value: encodeURIComponent(deepLink),
      httpOnly: true,
      sameSite: "Lax",
      path: "/",
    })

    const { link } = await requestSignIn(page, staff.email)
    await openEmailLink(page, link)
    await expect(page).toHaveURL(new RegExp(`${escapeRegExp(deepLink)}$`))
    // Used once: a later sign-in on this browser lands on Home.
    expect(await returnCookie(page.context())).toBeUndefined()
  })

  test("manager on a phone: code sign-in returns to the review deep link (C-1)", async ({
    browser,
  }) => {
    const context = await browser.newContext(PHONE)
    const page = await context.newPage()
    const deepLink = "/manager/review?status=pending"
    await page.goto(deepLink)
    await expect(page).toHaveURL(loginFor(deepLink))
    const { code } = await requestSignIn(page, manager.email)
    await enterCode(page, code)
    await expect(page).toHaveURL(new RegExp(`${escapeRegExp(deepLink)}$`))
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible()
    await context.close()
  })

  test("admin: link sign-in returns to the deep link", async ({ browser }) => {
    const context = await browser.newContext()
    const page = await context.newPage()
    const deepLink = "/admin/staff?from=email"
    await page.goto(deepLink)
    await expect(page).toHaveURL(loginFor(deepLink))
    const { link } = await requestSignIn(page, admin.email)
    await openEmailLink(page, link)
    await expect(page).toHaveURL(new RegExp(`${escapeRegExp(deepLink)}$`))
    await context.close()
  })

  test("a wrong-role deep link lands on the role's home; the guard still refuses it", async ({
    browser,
  }) => {
    const context = await browser.newContext()
    const page = await context.newPage()
    await page.goto("/admin/menus")
    await expect(page).toHaveURL(loginFor("/admin/menus"))
    const { code } = await requestSignIn(page, staff.email)
    await enterCode(page, code)
    await expect(page).toHaveURL(STAFF_LANDING)
    expect(await returnCookie(context)).toBeUndefined()
    await page.goto("/admin/menus")
    await expect(page).toHaveURL(STAFF_LANDING)
    await context.close()
  })

  test("an unsafe ?next= is ignored, never echoed, and never followed", async ({
    browser,
  }) => {
    const context = await browser.newContext()
    const page = await context.newPage()
    for (const next of [
      "//evil.example/staff",
      "https://evil.example/staff",
      "/\\evil.example",
      "/staff/%2F%2Fevil.example",
      "/staff/%252F%252Fevil.example",
      "/api/library",
      "/auth/logout",
      '"><script>window.__pwned=1</script>',
    ]) {
      await page.goto(`/login?next=${encodeURIComponent(next)}`)
      await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible()
      expect(await page.content(), next).not.toContain("evil.example")
      expect(await page.content(), next).not.toContain("__pwned")
      expect(await returnCookie(context), next).toBeUndefined()
    }
    await page.goto(`/login?next=${encodeURIComponent("//evil.example/staff")}`)
    const { code } = await requestSignIn(page, staff.email)
    await enterCode(page, code)
    await expect(page).toHaveURL(STAFF_LANDING)
    expect(page.url()).not.toContain("evil.example")
    await context.close()
  })
})

test.describe("an ended session mid-task (AUTH-2, charter C-2)", () => {
  test("a manager's Server Action gets the session-ended 401 and signs in again in place, keeping the input", async ({
    browser,
  }) => {
    const context = await browser.newContext(PHONE)
    const page = await context.newPage()
    await page.goto("/manager/account")
    const first = await requestSignIn(page, manager.email)
    await enterCode(page, first.code)
    await expect(page).toHaveURL(/\/manager\/account$/)

    const name = page.getByLabel("Display name")
    await name.fill("TEST e2e-return renamed")
    await context.clearCookies()

    const refused = page.waitForResponse(
      (r) =>
        r.request().method() === "POST" &&
        !!r.request().headers()["next-action"] &&
        r.status() === 401
    )
    await page.getByRole("button", { name: "Save name" }).click()
    await refused

    const sheet = page.getByRole("dialog", { name: "Sign in again" })
    await expect(sheet).toBeVisible()
    await expect(sheet).toContainText(manager.email)
    await expect(name).toHaveValue("TEST e2e-return renamed")
    // Nothing was saved while signed out.
    const before = await service
      .from("profiles")
      .select("display_name")
      .eq("id", manager.id)
      .single()
    expect(before.data?.display_name).not.toBe("TEST e2e-return renamed")

    const seen = await mailboxIds(manager.email)
    await sheet.getByRole("button", { name: "Send sign-in link" }).click()
    const again = await waitForSignInEmail(manager.email, seen)
    const sent = page.getByRole("dialog", { name: "Check your email" })
    await sent.getByLabel("Sign-in code").fill(again.code)
    await sent.getByRole("button", { name: "Sign in with code" }).click()
    await expect(page.getByRole("dialog")).toHaveCount(0)
    await expect(name).toHaveValue("TEST e2e-return renamed")
    await expect(page).toHaveURL(/\/manager\/account$/)

    await page.getByRole("button", { name: "Save name" }).click()
    await expect(page.getByText("Your name is saved.")).toBeVisible()
    await expect
      .poll(async () => {
        const { data } = await service
          .from("profiles")
          .select("display_name")
          .eq("id", manager.id)
          .single()
        return data?.display_name
      })
      .toBe("TEST e2e-return renamed")
    await context.close()
  })
})
