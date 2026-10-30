import { expect, type Browser, type Locator, type Page } from "@playwright/test"

import type { Db, TestIdentity } from "../support/identities"

/**
 * Signs in through the app's own /auth/confirm route with a magic-link token
 * (as tests/e2e/slice.spec.ts does). Not retried: a local auth 504 fails the
 * setup with a diagnostic.
 */
export async function signInAs(
  browser: Browser,
  admin: Db,
  identity: TestIdentity,
  baseURL: string
): Promise<Page> {
  const { data, error } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email: identity.email,
  })
  if (error?.status === 504)
    throw new Error(`signInAs(${identity.email}): local auth timed out (machine load?)`, { cause: error })
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
        img.evaluate((el: HTMLImageElement) =>
          el.complete && el.naturalWidth > 0
            ? "loaded"
            : `${el.complete ? "broken" : "loading"}: ${el.getAttribute("src")}`
        ),
      // Generous: the dev server compiles media routes on first use, and the
      // machine is shared with other local stacks.
      { timeout: 30_000 }
    )
    .toBe("loaded")
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
