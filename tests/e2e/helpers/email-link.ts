import type { Page } from "@playwright/test"

import { passMfaIfAsked } from "./mfa"

/**
 * Opens a magic-link or invitation link like a person: the /auth/confirm page
 * never uses the token on GET (mail scanners prefetch links), so press
 * Continue (or Accept your invitation), which POSTs it to /auth/confirm/verify. Links the page rejects
 * outright (malformed) redirect to /login before any button appears. An
 * admin then passes the second step (FA-23); pass `email` when the same
 * admin signs in more than once in a run.
 */
export async function openEmailLink(page: Page, link: string, email = "") {
  await page.goto(link)
  if (new URL(page.url()).pathname !== "/auth/confirm") return
  await page
    .getByRole("button", { name: /^(Continue|Accept your invitation)$/ })
    .click()
  await page.waitForURL((url) => !url.pathname.startsWith("/auth/confirm"))
  await passMfaIfAsked(page, email)
}
