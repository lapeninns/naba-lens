import { expect, type Browser, type Locator, type Page } from "@playwright/test"

import type { Db, TestIdentity } from "../support/identities"

/**
 * Signs in through the app's own /auth/confirm route with a magic-link token
 * (as tests/e2e/slice.spec.ts does). Only the local auth server's retryable 504
 * is retried, a setup-only concession to machine load.
 */
export async function signInAs(
  browser: Browser,
  admin: Db,
  identity: TestIdentity,
  baseURL: string
): Promise<Page> {
  let link = await admin.auth.admin.generateLink({
    type: "magiclink",
    email: identity.email,
  })
  for (let i = 0; link.error?.status === 504 && i < 3; i++) {
    link = await admin.auth.admin.generateLink({
      type: "magiclink",
      email: identity.email,
    })
  }
  const { data, error } = link
  if (error) throw error
  const context = await browser.newContext({ baseURL })
  const page = await context.newPage()
  await page.goto(
    `/auth/confirm?token_hash=${data.properties.hashed_token}&type=email`
  )
  return page
}

/** Waits for a tile's or viewer's image to finish loading real pixels. */
export async function expectImageLoaded(img: Locator) {
  await img.scrollIntoViewIfNeeded()
  await expect
    .poll(
      () =>
        img.evaluate(
          (el: HTMLImageElement) => el.complete && el.naturalWidth > 0
        ),
      { timeout: 15_000 }
    )
    .toBe(true)
}

/**
 * Lets a test hide or show the tab: `document.visibilityState` reads a window
 * flag. Install before the first navigation.
 */
export async function installVisibilityControl(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __nlVisibility?: DocumentVisibilityState }
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => w.__nlVisibility ?? "visible",
    })
    Object.defineProperty(document, "hidden", {
      configurable: true,
      get: () => (w.__nlVisibility ?? "visible") === "hidden",
    })
  })
}

export async function setVisibility(
  page: Page,
  state: DocumentVisibilityState
) {
  await page.evaluate((next) => {
    ;(
      window as unknown as { __nlVisibility?: DocumentVisibilityState }
    ).__nlVisibility = next
    document.dispatchEvent(new Event("visibilitychange"))
  }, state)
}
