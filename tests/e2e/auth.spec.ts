import { expect, test, type Page } from "@playwright/test"

import {
  createIdentity,
  createVenue,
  serviceClient,
  testEmail,
} from "../support/identities"
import { getLocalSupabaseEnv } from "../support/local-supabase"

/** Polls the local Mailpit inbox for the newest sign-in link sent to `email`. */
async function latestSignInLink(email: string): Promise<string> {
  const mailpit = getLocalSupabaseEnv().mailpitUrl
  if (!mailpit)
    throw new Error("Mailpit URL unavailable from `supabase status`.")
  for (let attempt = 0; attempt < 40; attempt++) {
    const search = await fetch(
      `${mailpit}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}&limit=1`
    ).then((r) => r.json())
    const id = search.messages?.[0]?.ID
    if (id) {
      const message = await fetch(`${mailpit}/api/v1/message/${id}`).then((r) =>
        r.json()
      )
      const match = String(message.HTML).match(
        /href="([^"]*\/auth\/confirm\?[^"]+)"/
      )
      if (match) return match[1].replace(/&amp;/g, "&")
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error("No sign-in email arrived in Mailpit.")
}

async function requestLink(page: Page, email: string) {
  await page.goto("/login")
  await page.getByLabel("Work email").fill(email)
  await page.getByRole("button", { name: "Send sign-in link" }).click()
  await expect(
    page.getByRole("heading", { name: "Check your email" })
  ).toBeVisible()
}

/** Follow the emailed link on this app's origin (templates use the configured site URL). */
async function openLink(page: Page, link: string, baseURL: string) {
  const url = new URL(link)
  await page.goto(new URL(url.pathname + url.search, baseURL).toString())
}

test.describe("authentication and role routing", () => {
  const admin = serviceClient()

  test("signed-out visitors are sent to /login", async ({ page }) => {
    await page.goto("/staff")
    await expect(page).toHaveURL(/\/login$/)
    await page.goto("/admin")
    await expect(page).toHaveURL(/\/login$/)
  })

  test("an uninvited email gets the same neutral response and no account", async ({
    page,
  }) => {
    const email = testEmail("e2e-uninvited")
    await requestLink(page, email)
    const { data } = await admin.auth.admin.listUsers({
      page: 1,
      perPage: 1000,
    })
    expect(data.users.some((u) => u.email === email)).toBe(false)
  })

  test("invited staff signs in by magic link and lands on /staff", async ({
    page,
    baseURL,
  }) => {
    const venue = await createVenue(admin, "e2e")
    const staff = await createIdentity(admin, {
      label: "e2e-staff",
      role: "staff",
      venueId: venue.id,
      session: false,
    })

    await requestLink(page, staff.email)
    await openLink(page, await latestSignInLink(staff.email), baseURL!)
    await expect(page).toHaveURL(/\/staff$/)
    await expect(
      page.getByRole("heading", { name: "TEST e2e-staff" })
    ).toBeVisible()

    // Staff cannot open the admin area by URL.
    await page.goto("/admin")
    await expect(page).toHaveURL(/\/staff$/)

    await page.getByRole("button", { name: "Sign out" }).click()
    await expect(page).toHaveURL(/\/login\?signed_out=1$/)
    await page.goto("/staff")
    await expect(page).toHaveURL(/\/login$/)
  })

  test("an admin lands on /admin", async ({ page, baseURL }) => {
    const adminUser = await createIdentity(admin, {
      label: "e2e-admin",
      role: "admin",
      session: false,
    })
    await requestLink(page, adminUser.email)
    await openLink(page, await latestSignInLink(adminUser.email), baseURL!)
    await expect(page).toHaveURL(/\/admin$/)
  })

  test("a reused or invalid link offers recovery", async ({
    page,
    baseURL,
  }) => {
    const venue = await createVenue(admin, "e2e-reuse")
    const staff = await createIdentity(admin, {
      label: "e2e-reuse",
      role: "staff",
      venueId: venue.id,
      session: false,
    })
    await requestLink(page, staff.email)
    const link = await latestSignInLink(staff.email)
    await openLink(page, link, baseURL!)
    await expect(page).toHaveURL(/\/staff$/)

    await page.context().clearCookies()
    await openLink(page, link, baseURL!)
    await expect(page).toHaveURL(/\/login\?error=link_invalid$/)
    await expect(page.getByText(/expired or was already used/)).toBeVisible()
    await expect(page.getByLabel("Work email")).toBeVisible()
  })

  test("a deactivated account is blocked, even with an existing session", async ({
    page,
    baseURL,
  }) => {
    const venue = await createVenue(admin, "e2e-deact")
    const staff = await createIdentity(admin, {
      label: "e2e-deact",
      role: "staff",
      venueId: venue.id,
      session: false,
    })
    await requestLink(page, staff.email)
    await openLink(page, await latestSignInLink(staff.email), baseURL!)
    await expect(page).toHaveURL(/\/staff$/)

    await admin.from("profiles").update({ active: false }).eq("id", staff.id)
    await page.goto("/staff")
    await expect(page).toHaveURL(/\/auth\/blocked$/)
    await expect(
      page.getByRole("heading", { name: "Account unavailable" })
    ).toBeVisible()
  })
})
