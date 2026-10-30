import { mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  expect,
  request,
  test,
  type Browser,
  type Dialog,
  type Page,
  type Route,
} from "@playwright/test"

import {
  setupIdentity,
  setupSession,
  uploadAs,
} from "../integration/gaps-support"
import { actorFor, syntheticJpeg } from "../slice/media-actor"
import {
  createVenue,
  serviceClient,
  signIn as signInApi,
  type TestIdentity,
} from "../support/identities"

/**
 * Acceptance gaps in the real app (next dev + local Supabase):
 * - GAP-19: the leave warning fires during an active upload, not when idle.
 * - Library refresh on focus/visibility, besides the 15 s interval.
 * - GAP-12: staff at a deactivated venue: no Upload, setup message; admin still
 *   sees the retained media.
 * - GAP-11 over real HTTP: cross-staff avatar/media denial, admin page redirect,
 *   private no-store headers.
 */

const admin = serviceClient()

/** Signs in through the app's own /auth/confirm route with a magic-link token. */
async function signIn(
  browser: Browser,
  identity: TestIdentity,
  baseURL: string
) {
  const data = await setupSession(identity.email, async () => {
    const { data, error } = await admin.auth.admin.generateLink({
      type: "magiclink",
      email: identity.email,
    })
    if (error) throw error
    return data
  })
  const context = await browser.newContext({ baseURL })
  const page = await context.newPage()
  await page.goto(
    `/auth/confirm?token_hash=${data.properties.hashed_token}&type=email`
  )
  // Opening the link never uses it (mail scanners prefetch); Continue does.
  await page.getByRole("button", { name: "Continue" }).click()
  await page.waitForURL((url) => !url.pathname.startsWith("/auth/confirm"))
  return page
}

/** A staff identity with an API session (for server-side uploads) too. */
async function staffWithSession(label: string, venueId: string) {
  const identity = await setupIdentity(admin, {
    label,
    role: "staff",
    venueId,
    session: false,
  })
  return {
    ...identity,
    client: await setupSession(label, () => signInApi(admin, identity.email)),
  }
}

async function readyPhoto(identity: TestIdentity, filename: string) {
  return uploadAs(await actorFor(identity), identity, await syntheticJpeg(), {
    filename,
    contentType: "image/jpeg",
    mediaType: "image",
  })
}

test.describe("GAP-19: leave warning during an active upload", () => {
  test("navigating away mid-upload prompts; idle and finished pages do not", async ({
    browser,
    baseURL,
  }) => {
    test.setTimeout(120_000)
    const venue = await createVenue(admin, "e2e-gaps-leave")
    const staff = await setupIdentity(admin, {
      label: "e2e-gaps-leave",
      role: "staff",
      venueId: venue.id,
      session: false,
    })
    const dir = await mkdtemp(join(tmpdir(), "nabalens-gaps-"))
    const photo = join(dir, "leave-test.jpg")
    await writeFile(photo, await syntheticJpeg(1200, 900))

    const page = await signIn(browser, staff, baseURL!)
    await expect(page).toHaveURL(/\/staff$/)

    const dialogs: string[] = []
    const onDialog = (dialog: Dialog) => {
      dialogs.push(dialog.type())
      // Stay on the page: the upload must not be lost.
      void dialog.dismiss()
    }
    page.on("dialog", onDialog)

    // Idle: leaving needs no confirmation. (A click first, so Chromium's
    // user-activation requirement for beforeunload is met in both cases.)
    await page.getByRole("button", { name: "Edit profile" }).click()
    await page.keyboard.press("Escape")
    const idleProbe = await page.evaluate(() => {
      const event = new Event("beforeunload", { cancelable: true })
      window.dispatchEvent(event)
      return event.defaultPrevented
    })
    expect(idleProbe).toBe(false)

    // Hold the storage transfer so the upload stays active.
    let release!: () => void
    const released = new Promise<void>((r) => (release = r))
    let held = 0
    const hold = async (route: Route) => {
      held++
      await released
      await route.continue()
    }
    await page.route(
      /\/storage\/v1\/(object\/upload\/sign|upload\/resumable)/,
      hold
    )

    await page
      .getByRole("button", { name: "Upload photos or videos" })
      .first()
      .click()
    const dialog = page.getByRole("dialog")
    await dialog.getByLabel("Choose photos or videos").setInputFiles([photo])
    await dialog.getByRole("button", { name: /^Upload 1/ }).click()
    await expect.poll(() => held, { timeout: 30_000 }).toBeGreaterThan(0)

    // Navigate away while the transfer is in flight.
    await page.evaluate(() => {
      window.location.href = "about:blank"
    })
    await expect
      .poll(() => dialogs, { timeout: 10_000 })
      .toContain("beforeunload")
    // Dismissed: still on the portfolio with the upload running.
    await expect(page).toHaveURL(/\/staff$/)
    await expect(dialog).toBeVisible()

    // Let it finish; then leaving is silent.
    release()
    await expect(dialog.getByText("1 uploaded")).toBeVisible({
      timeout: 60_000,
    })
    await page.unroute(/\/storage\/v1\//)
    dialogs.length = 0
    await dialog.getByRole("button", { name: "Done" }).click()
    // Leave the app entirely: /login would send a signed-in staff member back.
    await page.evaluate(() => {
      window.location.href = "about:blank"
    })
    await page.waitForURL("about:blank", { timeout: 15_000 })
    expect(dialogs).toEqual([])
  })
})

test.describe("admin library refreshes on focus", () => {
  test("new ready assets appear on focus and visibilitychange, and on the 15 s interval", async ({
    browser,
    baseURL,
  }) => {
    test.setTimeout(120_000)
    const venue = await createVenue(admin, "e2e-gaps-focus")
    const staff = await staffWithSession("e2e-gaps-focus", venue.id)
    const adminUser = await setupIdentity(admin, {
      label: "e2e-gaps-focus-admin",
      role: "admin",
      session: false,
    })
    const page = await signIn(browser, adminUser, baseURL!)
    await expect(page).toHaveURL(/\/admin$/)

    // Take manual control of the 15 s foreground timer so only the event under
    // test can refresh the gallery. Every other interval runs normally.
    await page.addInitScript(() => {
      const w = window as unknown as {
        __libraryTicks: (() => void)[]
        __libraryIntervals: number[]
      }
      w.__libraryTicks = []
      w.__libraryIntervals = []
      const real = window.setInterval.bind(window)
      window.setInterval = ((
        fn: TimerHandler,
        ms?: number,
        ...rest: unknown[]
      ) => {
        w.__libraryIntervals.push(ms ?? 0)
        if (ms === 15_000 && typeof fn === "function") {
          w.__libraryTicks.push(() => (fn as () => void)())
          return 0
        }
        return real(fn, ms, ...rest)
      }) as typeof window.setInterval
    })
    await page.goto(`/admin?staff=${staff.id}`)
    const library = page.getByRole("list", { name: "Library" })
    await expect(page.getByText("Nothing matches these filters.")).toBeVisible()
    expect(
      await page.evaluate(
        () =>
          (window as unknown as { __libraryIntervals: number[] })
            .__libraryIntervals
      )
    ).toContain(15_000)

    const tile = (name: string) =>
      page.getByRole("button", { name: new RegExp(`^Photo, ${name}`) })

    // 1. Window focus.
    await readyPhoto(staff, "focus-one.jpg")
    await page.waitForTimeout(1500)
    await expect(tile("focus-one")).toHaveCount(0)
    await page.evaluate(() => window.dispatchEvent(new Event("focus")))
    await expect(tile("focus-one")).toBeVisible({ timeout: 10_000 })

    // 2. Tab becomes visible again.
    await readyPhoto(staff, "focus-two.jpg")
    await page.waitForTimeout(1500)
    await expect(tile("focus-two")).toHaveCount(0)
    await page.evaluate(() =>
      document.dispatchEvent(new Event("visibilitychange"))
    )
    await expect(tile("focus-two")).toBeVisible({ timeout: 10_000 })

    // 3. The 15 s interval itself.
    await readyPhoto(staff, "focus-three.jpg")
    await page.evaluate(() =>
      (
        window as unknown as { __libraryTicks: (() => void)[] }
      ).__libraryTicks.forEach((tick) => tick())
    )
    await expect(tile("focus-three")).toBeVisible({ timeout: 10_000 })
    await expect(
      library.getByRole("button", { name: /^Photo, focus-/ })
    ).toHaveCount(3)
  })
})

test.describe("GAP-12: staff at a deactivated venue", () => {
  test("staff see the setup message and no Upload; admin still sees retained media", async ({
    browser,
    baseURL,
  }) => {
    test.setTimeout(120_000)
    const venue = await createVenue(admin, "e2e-gaps-paused")
    const staff = await staffWithSession("e2e-gaps-paused", venue.id)
    const adminUser = await setupIdentity(admin, {
      label: "e2e-gaps-paused-admin",
      role: "admin",
      session: false,
    })
    await readyPhoto(staff, "before-pause.jpg")
    const { error } = await admin
      .from("venues")
      .update({ active: false })
      .eq("id", venue.id)
    expect(error).toBeNull()

    const staffPage = await signIn(browser, staff, baseURL!)
    await expect(staffPage).toHaveURL(/\/staff$/)
    await expect(
      staffPage.getByRole("status").filter({ hasText: /not taking uploads/ })
    ).toBeVisible()
    await expect(
      staffPage.getByRole("button", { name: /Upload photos or videos/ })
    ).toHaveCount(0)
    // Their own retained media is still listed for them.
    await expect(
      staffPage
        .getByRole("list", { name: "Your portfolio" })
        .getByRole("button", { name: /^Photo, before-pause\.jpg/ })
    ).toBeVisible()

    const adminPage = await signIn(browser, adminUser, baseURL!)
    await adminPage.goto(`/admin/staff/${staff.id}`)
    await expect(
      adminPage.getByRole("button", { name: /^Photo, before-pause\.jpg/ })
    ).toBeVisible()
    await adminPage.goto(`/admin?venue=${venue.id}`)
    await expect(
      adminPage
        .getByRole("list", { name: "Library" })
        .getByRole("button", { name: /^Photo, before-pause\.jpg/ })
    ).toBeVisible()
  })
})

test.describe("GAP-11 over HTTP: cross-staff denial and private headers", () => {
  test("staff B gets nothing of staff A's; responses are private and uncached", async ({
    browser,
    baseURL,
  }, testInfo) => {
    // Pure HTTP checks: viewport-independent, so once is enough.
    test.skip(testInfo.project.name !== "chromium", "HTTP only; chromium run")
    test.setTimeout(120_000)
    const venue = await createVenue(admin, "e2e-gaps-http")
    const staffA = await staffWithSession("e2e-gaps-http-a", venue.id)
    const staffB = await setupIdentity(admin, {
      label: "e2e-gaps-http-b",
      role: "staff",
      venueId: venue.id,
      session: false,
    })
    const adminUser = await setupIdentity(admin, {
      label: "e2e-gaps-http-admin",
      role: "admin",
      session: false,
    })
    const photoA = await readyPhoto(staffA, "private-dish.jpg")

    const pageA = await signIn(browser, staffA, baseURL!)
    const pageB = await signIn(browser, staffB, baseURL!)
    const pageAdmin = await signIn(browser, adminUser, baseURL!)

    // Staff A sets an avatar through the real profile route.
    const avatar = await syntheticJpeg(256, 256)
    const set = await pageA.request.post("/api/profile", {
      multipart: {
        displayName: "TEST e2e-gaps-http-a",
        avatar: {
          name: "me.jpg",
          mimeType: "image/jpeg",
          buffer: Buffer.from(avatar),
        },
      },
    })
    expect(set.status()).toBe(200)

    const headerProblems: string[] = []
    const checkPrivate = (label: string, headers: Record<string, string>) => {
      const cc = (headers["cache-control"] ?? "").toLowerCase()
      if (
        !cc.includes("no-store") ||
        !cc.includes("private") ||
        /\bpublic\b/.test(cc)
      ) {
        headerProblems.push(`${label}: cache-control "${cc}"`)
      }
    }

    // Staff B: avatar and every media route for A's asset are refused.
    const deniedPaths = [
      `/api/avatars/${staffA.id}`,
      `/api/media/${photoA}/thumb`,
      `/api/media/${photoA}/preview`,
      `/api/media/${photoA}/stream`,
      `/api/media/${photoA}/download`,
    ]
    for (const path of deniedPaths) {
      const res = await pageB.request.get(path, { maxRedirects: 0 })
      expect([403, 404], path).toContain(res.status())
      expect(res.headers()["location"], path).toBeUndefined()
      checkPrivate(`B ${path}`, res.headers())
    }
    const anonymous = await request.newContext({ baseURL })
    for (const path of deniedPaths) {
      const anon = await anonymous.get(path, { maxRedirects: 0 })
      expect([401, 403, 404], `anon ${path}`).toContain(anon.status())
      expect(anon.headers()["location"], `anon ${path}`).toBeUndefined()
    }
    await anonymous.dispose()

    // Staff B opening A's admin portfolio is sent home with none of A's data.
    const portfolio = await pageB.request.get(`/admin/staff/${staffA.id}`, {
      maxRedirects: 0,
    })
    // A server redirect before anything streams (privacy R3: app/admin/layout.tsx
    // checks the role outside loading.tsx's Suspense boundary), never a 200
    // carrying a client-side redirect.
    const html = await portfolio.text()
    expect(portfolio.status()).toBe(307)
    expect(portfolio.headers()["location"]).toMatch(/\/staff$/)
    expect(html).not.toContain('data-slot="skeleton"')
    expect(html).not.toContain("TEST e2e-gaps-http-a")
    expect(html).not.toContain(photoA)
    expect(await portfolio.text()).not.toContain("private-dish")
    await pageB.goto(`/admin/staff/${staffA.id}`)
    await expect(pageB).toHaveURL(/\/staff$/)
    await expect(pageB.getByText("private-dish.jpg")).toHaveCount(0)
    await expect(pageB.getByText("TEST e2e-gaps-http-a")).toHaveCount(0)

    // Allowed reads carry private, no-store headers and nosniff.
    const allowed: [Page, string, number][] = [
      [pageA, `/api/avatars/${staffA.id}`, 302],
      [pageAdmin, `/api/avatars/${staffA.id}`, 302],
      [pageA, `/api/media/${photoA}/thumb`, 302],
      [pageA, `/api/media/${photoA}/preview`, 302],
      [pageAdmin, `/api/media/${photoA}/preview`, 302],
      [pageAdmin, `/api/media/${photoA}/download`, 200],
    ]
    for (const [page, path, status] of allowed) {
      const res = await page.request.get(path, { maxRedirects: 0 })
      expect(res.status(), path).toBe(status)
      checkPrivate(path, res.headers())
      expect(res.headers()["x-content-type-options"], path).toBe("nosniff")
    }
    expect(headerProblems).toEqual([])
  })
})
