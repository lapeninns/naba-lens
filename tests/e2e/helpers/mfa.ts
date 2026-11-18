import type { Page } from "@playwright/test"

import { totpCode } from "../../support/totp"

/**
 * Admins pass a TOTP second step after signing in (FA-23, /auth/mfa). The
 * first sign-in of a test admin sets up the authenticator from the setup key
 * the page shows; later sign-ins in this worker enter a fresh code for it.
 */
const secrets = new Map<string, string>()

/** Completes /auth/mfa when sign-in lands there; otherwise does nothing. */
export async function passMfaIfAsked(page: Page, email: string) {
  await page.waitForURL((url) => !url.pathname.startsWith("/auth/confirm"))
  if (!new URL(page.url()).pathname.startsWith("/auth/mfa")) return
  const setup = page.getByRole("button", {
    name: "Set up with an authenticator app",
  })
  const code = page.getByLabel("6-digit code")
  await setup.or(code).first().waitFor()
  if (await setup.isVisible()) {
    await setup.click()
    const key = page.getByTestId("mfa-secret")
    await key.waitFor()
    secrets.set(email, ((await key.textContent()) ?? "").trim())
  }
  const secret = secrets.get(email)
  if (!secret)
    throw new Error(`No authenticator set up in this run for ${email}`)
  await code.fill(totpCode(secret))
  await page.getByRole("button", { name: /^(Confirm code|Continue)$/ }).click()
  await page.waitForURL((url) => !url.pathname.startsWith("/auth/mfa"))
}
