import type { Page } from "@playwright/test"

import {
  knownTotpSecret,
  rememberTotpFactor,
  totpCode,
} from "../../support/totp"
import { provisioner } from "./stack"

/**
 * Admins pass a TOTP second step after signing in (FA-23, /auth/mfa). The
 * first sign-in of a test admin sets up the authenticator from the setup key
 * the page shows; later sign-ins in this worker enter a fresh code for it.
 *
 * The factor is remembered per account in tests/support/totp, so a database
 * session (`signIn`) for the same admin reuses it instead of enrolling a
 * second one (Supabase refuses that below aal2), and a browser sign-in after
 * a database session uses the factor that session enrolled.
 */

// Looked up through the service client, not host psql, so a journey that only
// signs people in keeps needing no SQL tools (journey prerequisites).
async function userIdFor(email: string): Promise<string> {
  const wanted = email.toLowerCase()
  for (let page = 1; ; page += 1) {
    const { data, error } = await provisioner().auth.admin.listUsers({
      page,
      perPage: 1000,
    })
    if (error) throw error
    const user = data.users.find((u) => u.email?.toLowerCase() === wanted)
    if (user) return user.id
    if (data.users.length < 1000) return ""
  }
}

let unnamed: string | null = null

/** Completes /auth/mfa when sign-in lands there; otherwise does nothing. */
export async function passMfaIfAsked(page: Page, email: string) {
  await page.waitForURL((url) => !url.pathname.startsWith("/auth/confirm"))
  if (!new URL(page.url()).pathname.startsWith("/auth/mfa")) return
  // Callers that don't name the admin share one remembered key (the last
  // authenticator set up without an email), as before.
  const userId = email ? await userIdFor(email) : ""
  const setup = page.getByRole("button", {
    name: "Set up with an authenticator app",
  })
  const code = page.getByLabel("6-digit code")
  await setup.or(code).first().waitFor()
  if (await setup.isVisible()) {
    await setup.click()
    const key = page.getByTestId("mfa-secret")
    await key.waitFor()
    const secret = ((await key.textContent()) ?? "").trim()
    await code.fill(totpCode(secret))
    await page
      .getByRole("button", { name: /^(Confirm code|Continue)$/ })
      .click()
    await page.waitForURL((url) => !url.pathname.startsWith("/auth/mfa"))
    if (!userId) {
      unnamed = secret
      return
    }
    const { data, error } = await provisioner().auth.admin.mfa.listFactors({
      userId,
    })
    if (error) throw error
    const factor = data.factors.find(
      (f) => f.factor_type === "totp" && f.status === "verified"
    )
    if (factor) rememberTotpFactor(userId, { factorId: factor.id, secret })
    return
  }
  const secret = userId ? knownTotpSecret(userId) : unnamed
  if (!secret)
    throw new Error(`No authenticator set up in this run for ${email}`)
  await code.fill(totpCode(secret))
  await page.getByRole("button", { name: /^(Confirm code|Continue)$/ }).click()
  await page.waitForURL((url) => !url.pathname.startsWith("/auth/mfa"))
}
