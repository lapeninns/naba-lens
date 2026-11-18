import type { Page } from "@playwright/test"

import { knownTotpSecret, totpCode } from "../../support/totp"

/**
 * Admins pass a TOTP second step after signing in (FA-23, /auth/mfa). The
 * first sign-in of a test admin sets up the authenticator from the setup key
 * the page shows; later sign-ins in this worker enter a fresh code for it.
 * An admin whose factor a fixture enrolled through the API (createIdentity
 * with a session, tests/support/totp.ts) is asked for a code straight away:
 * that factor's secret is found by the signed-in user's id.
 */
const secrets = new Map<string, string>()

/** The signed-in user's id, from the Supabase auth cookie's access token. */
async function sessionUserId(page: Page): Promise<string | null> {
  const cookies = (await page.context().cookies()).filter((c) =>
    /^sb-.*-auth-token(\.\d+)?$/.test(c.name)
  )
  if (cookies.length === 0) return null
  const chunk = (name: string) => Number(name.split(".").at(-1)) || 0
  let raw = cookies
    .sort((a, b) => chunk(a.name) - chunk(b.name))
    .map((c) => c.value)
    .join("")
  if (raw.startsWith("base64-"))
    raw = Buffer.from(raw.slice(7), "base64url").toString("utf8")
  try {
    const token = (JSON.parse(raw) as { access_token?: string }).access_token
    if (!token) return null
    const payload = JSON.parse(
      Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8")
    ) as { sub?: string }
    return payload.sub ?? null
  } catch {
    return null
  }
}

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
  let secret = secrets.get(email)
  if (!secret) {
    const userId = await sessionUserId(page)
    secret = (userId && knownTotpSecret(userId)) || undefined
  }
  if (!secret)
    throw new Error(`No authenticator set up in this run for ${email}`)
  await code.fill(totpCode(secret))
  await page.getByRole("button", { name: /^(Confirm code|Continue)$/ }).click()
  await page.waitForURL((url) => !url.pathname.startsWith("/auth/mfa"))
}
