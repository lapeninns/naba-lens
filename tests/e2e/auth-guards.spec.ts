import {
  expect,
  test,
  type APIRequestContext,
  type Browser,
} from "@playwright/test"

import {
  createIdentity,
  createVenue,
  serviceClient,
  type TestIdentity,
} from "../support/identities"

// Privacy audit R3: a signed-in account that may not see a page must get a
// server redirect (307) before anything renders, not 200 plus a client-side
// redirect streamed after the loading skeleton. Raw HTTP, redirects not followed.

const admin = serviceClient()

async function signedIn(browser: Browser, identity: TestIdentity) {
  const { data, error } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email: identity.email,
  })
  if (error) throw error
  const context = await browser.newContext()
  const page = await context.newPage()
  await page.goto(
    `/auth/confirm?token_hash=${data.properties.hashed_token}&type=email`
  )
  await page.getByRole("button", { name: "Continue" }).click()
  await page.waitForURL((url) => !url.pathname.startsWith("/auth/confirm"))
  return context
}

/**
 * Markers of the admin or staff app shell and their loading skeletons. (Next's
 * redirect shell keeps the route's static <title>, e.g. "Content · NabaLens";
 * that is a fixed string, not rendered UI or data.)
 */
const APP_MARKUP = [
  'href="/admin/staff"',
  ">Content<",
  'data-slot="skeleton"',
  "Upload photos or videos",
]
/** Other people's details, filled in once the identities exist. */
const PEOPLE: string[] = []

async function expectRedirect(
  request: APIRequestContext,
  path: string,
  to: string
) {
  const res = await request.get(path, { maxRedirects: 0 })
  expect(res.status(), `${path} status`).toBe(307)
  expect(new URL(res.headers()["location"], "http://x").pathname).toBe(to)
  const body = await res.text()
  for (const marker of [...APP_MARKUP, ...PEOPLE]) {
    expect(body, `${path} body`).not.toContain(marker)
  }
}

test.describe("server-side role guards", () => {
  // HTTP only; one project is enough.
  test.skip(({ isMobile }) => isMobile, "HTTP status checks; desktop run")

  let staff: TestIdentity
  let other: TestIdentity
  let adminUser: TestIdentity
  let orphan: TestIdentity
  let former: TestIdentity

  test.beforeAll(async () => {
    const venue = await createVenue(admin, "e2e-guards")
    staff = await createIdentity(admin, {
      label: "e2e-guard-staff",
      role: "staff",
      venueId: venue.id,
      session: false,
    })
    other = await createIdentity(admin, {
      label: "e2e-guard-other",
      role: "staff",
      venueId: venue.id,
      session: false,
    })
    adminUser = await createIdentity(admin, {
      label: "e2e-guard-admin",
      role: "admin",
      session: false,
    })
    orphan = await createIdentity(admin, {
      label: "e2e-guard-orphan",
      role: "staff",
      profile: false,
      session: false,
    })
    former = await createIdentity(admin, {
      label: "e2e-guard-former",
      role: "staff",
      venueId: venue.id,
      session: false,
    })
    for (const person of [staff, other, adminUser]) {
      PEOPLE.push(person.email)
    }
    PEOPLE.push("TEST e2e-guard-other", "TEST e2e-guard-admin")
  })

  test("staff get a 307 to /staff from every admin page, with no admin markup", async ({
    browser,
  }) => {
    const context = await signedIn(browser, staff)
    for (const path of [
      "/admin",
      "/admin?type=image",
      "/admin/staff",
      `/admin/staff/${other.id}`,
      `/admin/staff/${adminUser.id}`,
    ]) {
      await expectRedirect(context.request, path, "/staff")
    }
    // Control: their own page renders.
    const own = await context.request.get("/staff", { maxRedirects: 0 })
    expect(own.status()).toBe(200)
    await context.close()
  })

  test("admins get a 307 to /admin from /staff", async ({ browser }) => {
    const context = await signedIn(browser, adminUser)
    await expectRedirect(context.request, "/staff", "/admin")
    const own = await context.request.get("/admin/staff", { maxRedirects: 0 })
    expect(own.status()).toBe(200)
    await context.close()
  })

  test("accounts without an active profile get a 307 to the blocked page", async ({
    browser,
  }) => {
    const noProfile = await signedIn(browser, orphan)
    const deactivated = await signedIn(browser, former)
    const { error } = await admin
      .from("profiles")
      .update({ active: false })
      .eq("id", former.id)
    expect(error).toBeNull()
    for (const context of [noProfile, deactivated]) {
      for (const path of ["/staff", "/admin", "/admin/staff"]) {
        await expectRedirect(context.request, path, "/auth/blocked")
      }
      await context.close()
    }
  })

  test("signed-out requests get a 307 to /login", async ({ browser }) => {
    const context = await browser.newContext()
    for (const path of ["/staff", "/admin", "/admin/staff"]) {
      await expectRedirect(context.request, path, "/login")
    }
    await context.close()
  })
})
