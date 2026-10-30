import { expect as baseExpect, test, type Page } from "@playwright/test"

import {
  createIdentity,
  createVenue,
  serviceClient,
  testEmail,
} from "../support/identities"
import { getLocalSupabaseEnv } from "../support/local-supabase"

const admin = serviceClient()
// Server Functions and routes compile on first use under `next dev`.
const expect = baseExpect.configure({ timeout: 30_000 })

/** Signs a browser in through /auth/confirm with a server-generated magic-link token. */
async function signInAs(page: Page, email: string) {
  const { data, error } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
  })
  if (error) throw error
  await page.goto(
    `/auth/confirm?token_hash=${data.properties.hashed_token}&type=email`
  )
  await page.getByRole("button", { name: "Continue" }).click()
}

/** The invitation link from the real email in the local Mailpit inbox. */
async function invitationLink(email: string): Promise<string> {
  const mailpit = getLocalSupabaseEnv().mailpitUrl
  if (!mailpit) throw new Error("Mailpit URL unavailable")
  for (let attempt = 0; attempt < 40; attempt++) {
    const search = await fetch(
      `${mailpit}/api/v1/search?query=${encodeURIComponent(`to:"${email}" subject:"invited"`)}&limit=1`
    ).then((r) => r.json())
    const id = search.messages?.[0]?.ID
    if (id) {
      const message = await fetch(`${mailpit}/api/v1/message/${id}`).then((r) =>
        r.json()
      )
      const match = String(message.HTML).match(
        /href="[^"]*(\/auth\/confirm\?[^"]+type=invite)"/
      )
      if (match) return match[1].replace(/&amp;/g, "&")
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error("No invitation email arrived in Mailpit.")
}

test.describe("admin staff management", () => {
  test("invite → accept → deactivate → reactivate", async ({ browser }) => {
    test.setTimeout(180_000)
    const venue = await createVenue(admin, "e2e-acc")
    const adminUser = await createIdentity(admin, {
      label: "e2e-acc-admin",
      role: "admin",
      session: false,
    })
    const adminPage = await (await browser.newContext()).newPage()
    await signInAs(adminPage, adminUser.email)
    await expect(adminPage).toHaveURL(/\/admin$/)

    // Invite through the dialog.
    await adminPage.goto("/admin/staff")
    await expect(
      adminPage.getByRole("heading", { name: "Staff", level: 1 })
    ).toBeVisible()
    const email = testEmail("e2e-invitee")
    const name = `TEST Invitee ${email.slice(10, 18)}`
    await adminPage.getByRole("button", { name: "Invite staff" }).click()
    const dialog = adminPage.getByRole("dialog")
    await dialog.getByLabel("Name").fill(name)
    await dialog.getByLabel("Email").fill(email)
    await dialog.getByLabel("Job title (optional)").fill("TEST Curry chef")
    await dialog.getByRole("combobox", { name: "Venue" }).click()
    await adminPage.getByRole("option", { name: venue.name }).click()
    await dialog.getByRole("button", { name: "Send invitation" }).click()
    await expect(
      dialog.getByRole("heading", { name: "Invitation sent" })
    ).toBeVisible()
    // The footer button (the dialog's corner X is also named "Close").
    await dialog.getByRole("button", { name: "Close" }).last().click()
    await expect(
      adminPage.getByText(name).filter({ visible: true }).first()
    ).toBeVisible()

    // Inviting the same address again is refused with a clear message.
    await adminPage.getByRole("button", { name: "Invite staff" }).click()
    await dialog.getByLabel("Name").fill(name)
    await dialog.getByLabel("Email").fill(email)
    await dialog.getByRole("combobox", { name: "Venue" }).click()
    await adminPage.getByRole("option", { name: venue.name }).click()
    await dialog.getByRole("button", { name: "Send invitation" }).click()
    await expect(
      dialog.getByText("This email already has a NabaLens account", {
        exact: false,
      })
    ).toBeVisible()
    await dialog.getByRole("button", { name: "Cancel" }).click()

    // The invitee accepts from the real email and lands on their portfolio.
    const staffContext = await browser.newContext()
    const staffPage = await staffContext.newPage()
    await staffPage.goto(await invitationLink(email))
    await expect(
      staffPage.getByRole("heading", { name: "Accept your invitation" })
    ).toBeVisible()
    await staffPage.getByRole("button", { name: "Continue" }).click()
    await expect(staffPage).toHaveURL(/\/staff$/)
    await expect(staffPage.getByRole("heading", { name })).toBeVisible()

    // Staff cannot open the admin staff area or call its avatar route.
    await staffPage.goto("/admin/staff")
    await expect(staffPage).toHaveURL(/\/staff$/)
    const { data: invitee } = await admin
      .from("profiles")
      .select("id")
      .eq("display_name", name)
      .single()
    const forged = await staffPage.request.post(
      `/admin/staff/${invitee!.id}/avatar`,
      {
        multipart: {
          file: {
            name: "a.png",
            mimeType: "image/png",
            buffer: Buffer.from("x"),
          },
        },
      }
    )
    expect(forged.status()).toBe(403)

    // Admin sees them as Active, opens the portfolio and deactivates them.
    await adminPage.goto(`/admin/staff/${invitee!.id}`)
    await expect(adminPage.getByRole("heading", { name })).toBeVisible()
    await expect(adminPage.getByText("Active", { exact: true })).toBeVisible()
    await expect(adminPage.getByText(`has no uploads yet`)).toBeVisible()
    await adminPage.getByRole("button", { name: "Deactivate" }).click()
    await adminPage
      .getByRole("alertdialog")
      .getByRole("button", { name: "Deactivate" })
      .click()
    await expect(adminPage.getByText(/is deactivated/)).toBeVisible()
    await expect(adminPage.getByText("Inactive", { exact: true })).toBeVisible()

    // The staff member's existing session is refused on its next request.
    await staffPage.goto("/staff")
    await expect(staffPage).toHaveURL(/\/auth\/blocked$/)

    // Reactivation restores access with a fresh sign-in.
    await adminPage.getByRole("button", { name: "Reactivate" }).click()
    await expect(adminPage.getByText(/can sign in again/)).toBeVisible()
    await staffContext.clearCookies()
    await signInAs(staffPage, email)
    await expect(staffPage).toHaveURL(/\/staff$/)

    // Edit details: change job title from the directory.
    await adminPage.goto("/admin/staff")
    await adminPage
      .getByRole("button", { name: `More actions for ${name}` })
      .click()
    await adminPage.getByRole("menuitem", { name: "Edit details" }).click()
    const edit = adminPage.getByRole("dialog")
    await edit.getByLabel("Job title").fill("TEST Head chef")
    await edit.getByRole("button", { name: "Save changes" }).click()
    await expect(edit).toBeHidden()
    await expect(adminPage.getByText(`Saved ${name}.`)).toBeVisible()
    const { data: saved } = await admin
      .from("profiles")
      .select("job_title")
      .eq("id", invitee!.id)
      .single()
    expect(saved?.job_title).toBe("TEST Head chef")
  })
})
