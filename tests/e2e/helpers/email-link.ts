import type { Page } from "@playwright/test"

/**
 * Opens a magic-link or invitation link like a person: the /auth/confirm page
 * never uses the token on GET (mail scanners prefetch links), so press
 * Continue, which POSTs it to /auth/confirm/verify. Links the page rejects
 * outright (malformed) redirect to /login before any button appears.
 */
export async function openEmailLink(page: Page, link: string) {
  await page.goto(link)
  if (new URL(page.url()).pathname !== "/auth/confirm") return
  await page.getByRole("button", { name: "Continue" }).click()
  await page.waitForURL((url) => !url.pathname.startsWith("/auth/confirm"))
}
