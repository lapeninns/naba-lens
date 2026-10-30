// Magic links and session expiry, driven through the real login Server Function,
// /auth/confirm, proxy() and protected pages/routes (see ./auth-support.ts).
import { beforeAll, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))
vi.mock("next/headers", () =>
  import("./auth-support").then((m) => m.nextHeadersMock())
)
vi.mock("next/cache", () => ({ revalidatePath: () => {} }))

import { requestSignInLink } from "@/app/login/actions"
import LoginPage from "@/app/login/page"
import { GET as callback } from "@/app/auth/callback/route"
import { POST as logout } from "@/app/auth/logout/route"
import { GET as download } from "@/app/api/media/[id]/download/route"
import { GET as avatar } from "@/app/api/avatars/[id]/route"
import { loadMyMedia } from "@/app/staff/actions"
import { loadLibraryPage } from "@/app/admin/library-actions"
import RootPage from "@/app/page"
import StaffPage from "@/app/staff/page"
import AdminPage from "@/app/admin/page"
import { getAuthState } from "@/lib/auth"
import { proxy } from "@/proxy"

import {
  anonClient,
  createIdentity,
  createVenue,
  serviceClient,
  testEmail,
  type TestIdentity,
} from "../support/identities"
import { getLocalSupabaseEnv } from "../support/local-supabase"
import {
  ageEmailLinks,
  APP_ORIGIN,
  appRequest,
  authUserCount,
  issueSignInLink,
  Browser,
  resignAccessToken,
  mailCount,
  nextConfirmLink,
  readSessionCookie,
  redirectOf,
  tokenHashOf,
  writeSessionCookie,
} from "./auth-support"
import { followEmailLink, loadConfirmPage, submitConfirm } from "./auth-confirm"

const service = serviceClient()

/** The login form as a person uses it: submit, then open the emailed link. */
async function requestLink(browser: Browser, email: string) {
  const seen = await mailCount(email)
  const result = await browser.run(() => requestSignInLink(email))
  expect(result).toEqual({})
  return nextConfirmLink(email, seen)
}

async function open(browser: Browser, confirmPath: string) {
  const res = await followEmailLink(browser, confirmPath)
  return { status: res.status, location: res.location }
}

async function signedIn(browser: Browser, email: string) {
  const link = await issueSignInLink(service, email)
  expect(await open(browser, link)).toEqual({ status: 303, location: "/" })
  return link
}

let venue: { id: string }
let staff: TestIdentity
let admin: TestIdentity

beforeAll(async () => {
  venue = await createVenue(service, "links")
  staff = await createIdentity(service, {
    label: "links-staff",
    role: "staff",
    venueId: venue.id,
    session: false,
  })
  admin = await createIdentity(service, {
    label: "links-admin",
    role: "admin",
    session: false,
  })
})

describe("magic links", () => {
  it("a fresh link signs the invited person in and routes by role", async () => {
    // The one test that sends a real email (the stack allows 2 per hour).
    const browser = new Browser("fresh")
    const link = await requestLink(browser, staff.email)
    expect(await open(browser, link)).toEqual({ status: 303, location: "/" })
    expect(browser.authCookies().length).toBeGreaterThan(0)
    expect((await browser.run(() => redirectOf(RootPage))).location).toBe(
      "/staff"
    )

    const adminBrowser = new Browser("admin")
    await signedIn(adminBrowser, admin.email)
    expect((await adminBrowser.run(() => redirectOf(RootPage))).location).toBe(
      "/admin"
    )
  })

  it("an expired link is refused, sets no session and offers recovery", async () => {
    const browser = new Browser("expired")
    const link = await issueSignInLink(service, staff.email)
    ageEmailLinks(staff.id)

    expect(await open(browser, link)).toEqual({
      status: 303,
      location: "/login?error=link_invalid",
    })
    expect(
      browser.authCookies().filter((c) => !c.name.includes("verifier"))
    ).toEqual([])
    expect((await browser.run(getAuthState)).status).toBe("signed_out")

    // The login page renders the expired-link recovery state.
    const page = await browser.run(() =>
      redirectOf(() =>
        LoginPage({ searchParams: Promise.resolve({ error: "link_invalid" }) })
      )
    )
    expect(page.location).toBeNull()
    const card = (page.value as { props: { children: { props: object } } })
      .props.children
    expect(card.props).toMatchObject({ linkExpired: true })

    // Recovery: a new link works.
    await signedIn(browser, staff.email)
    expect((await browser.run(getAuthState)).status).toBe("active")
  })

  it("a link works once; reusing it (any browser) is refused", async () => {
    const first = new Browser("first-use")
    const link = await signedIn(first, staff.email)

    for (const label of ["same", "other"]) {
      const browser = label === "same" ? first : new Browser("second-use")
      const before = browser.cookieHeader()
      expect(await open(browser, link)).toEqual({
        status: 303,
        location: "/login?error=link_invalid",
      })
      if (label === "other") {
        expect(browser.authCookies()).toEqual([])
        expect((await browser.run(getAuthState)).status).toBe("signed_out")
      } else {
        // The first session is untouched by the failed reuse.
        expect(browser.cookieHeader()).toBe(before)
      }
    }

    // The raw token hash is single-use at the auth API as well.
    const { error } = await anonClient().auth.verifyOtp({
      type: "email",
      token_hash: tokenHashOf(link),
    })
    expect(error?.code).toBe("otp_expired")
  })

  it("a superseded link stops working once a newer one is used", async () => {
    const browser = new Browser("superseded")
    const older = await issueSignInLink(service, staff.email)
    // Supabase allows one outstanding link per user; requesting again replaces it.
    await new Promise((resolve) => setTimeout(resolve, 1100))
    const newer = await issueSignInLink(service, staff.email)
    expect(newer).not.toBe(older)
    expect(await open(new Browser("old"), older)).toEqual({
      status: 303,
      location: "/login?error=link_invalid",
    })
    expect(await open(browser, newer)).toEqual({ status: 303, location: "/" })
  })

  it("malformed links and the PKCE callback without a valid code are refused", async () => {
    const browser = new Browser("malformed")
    // Unusable links are turned away by the page itself, without a verify call.
    for (const path of [
      "/auth/confirm",
      "/auth/confirm?token_hash=abc&type=email",
      `/auth/confirm?token_hash=${"a".repeat(56)}&type=recovery`,
      `/auth/confirm?token_hash=${"a".repeat(56)}&type=signup`,
      `/auth/confirm?token_hash=${"a".repeat(56)}`,
    ]) {
      expect(await loadConfirmPage(browser, path)).toEqual({
        form: null,
        location: "/login?error=link_invalid",
      })
    }
    // A well-formed but unknown token fails at Continue.
    expect(
      await open(
        browser,
        `/auth/confirm?token_hash=${"a".repeat(56)}&type=email`
      )
    ).toEqual({ status: 303, location: "/login?error=link_invalid" })
    for (const fields of [
      {},
      { token_hash: "abc", type: "email" },
      { token_hash: "a".repeat(56), type: "recovery" },
    ] as Record<string, string>[]) {
      expect(await submitConfirm(browser, fields)).toEqual({
        status: 303,
        location: "/login?error=link_invalid",
      })
    }
    for (const path of ["/auth/callback", "/auth/callback?code=not-a-code"]) {
      const res = await browser.run(() => callback(appRequest(browser, path)))
      expect(res.headers.get("location")).toBe("/login?error=link_invalid")
    }
    expect(
      browser.authCookies().filter((c) => !c.name.includes("verifier"))
    ).toEqual([])
  })

  it("an uninvited email gets the same neutral result and no account", async () => {
    const email = testEmail("links-stranger")
    const result = await new Browser("stranger").run(() =>
      requestSignInLink(email)
    )
    expect(result).toEqual({})
    await new Promise((resolve) => setTimeout(resolve, 500))
    expect(await mailCount(email)).toBe(0)
    expect(authUserCount(email)).toBe(0)
  })
})

describe("email link scanners (GET must not use the token)", () => {
  it("opening the link only shows a Continue page and starts no session", async () => {
    const link = await issueSignInLink(service, staff.email)
    const scanner = new Browser("scanner")
    for (let i = 0; i < 3; i++) {
      const page = await loadConfirmPage(scanner, link)
      expect(page.location).toBeNull()
      expect(page.form).toEqual({
        action: "/auth/confirm/verify",
        method: "post",
        fields: { token_hash: tokenHashOf(link), type: "email" },
        heading: "Sign in to NabaLens",
      })
    }
    expect(scanner.authCookies()).toEqual([])
    expect((await scanner.run(getAuthState)).status).toBe("signed_out")

    // The person opening the same link afterwards still signs in.
    const person = new Browser("person")
    expect(await open(person, link)).toEqual({ status: 303, location: "/" })
    expect((await person.run(getAuthState)).status).toBe("active")
  })

  it("an invitation link says so and also survives prefetching", async () => {
    const email = testEmail("links-invitee")
    const seen = await mailCount(email)
    const invited = await service.auth.admin.inviteUserByEmail(email)
    expect(invited.error).toBeNull()
    const { error } = await service.from("profiles").insert({
      id: invited.data.user!.id,
      display_name: "TEST links invitee",
      role: "staff",
      venue_id: venue.id,
    })
    expect(error).toBeNull()
    const link = await nextConfirmLink(email, seen)
    expect(link).toContain("type=invite")

    const scanned = await loadConfirmPage(new Browser("scanner"), link)
    expect(scanned.form?.heading).toBe("Accept your invitation")
    expect(scanned.form?.fields.type).toBe("invite")

    const person = new Browser("invitee")
    expect(await open(person, link)).toEqual({ status: 303, location: "/" })
    expect((await person.run(() => redirectOf(RootPage))).location).toBe(
      "/staff"
    )
  })

  it("a cross-site form cannot submit someone's token", async () => {
    const link = await issueSignInLink(service, staff.email)
    const fields = { token_hash: tokenHashOf(link), type: "email" }
    const victim = new Browser("victim")
    for (const headers of [
      { origin: "https://evil.example", "sec-fetch-site": "cross-site" },
      { origin: APP_ORIGIN, "sec-fetch-site": "same-site" },
      // Older browsers without Fetch Metadata: Origin decides.
      { origin: "https://evil.example", "sec-fetch-site": null },
      { origin: "null", "sec-fetch-site": null },
    ]) {
      expect(await submitConfirm(victim, fields, headers)).toEqual({
        status: 403,
        location: null,
      })
    }
    expect(victim.authCookies()).toEqual([])
    // The refused POST did not use the token either.
    expect(await submitConfirm(victim, fields)).toEqual({
      status: 303,
      location: "/",
    })
  })

  it("the page keeps the token out of Referer headers and search indexes", async () => {
    const page = await import("@/app/auth/confirm/page")
    expect(page.metadata).toMatchObject({
      referrer: "same-origin",
      robots: { index: false, follow: false },
    })
    const verify = await import("@/app/auth/confirm/verify/route")
    expect("GET" in verify).toBe(false)
  })
})

describe("session expiry", () => {
  /**
   * A browser whose session has lapsed: the access token is past `exp` and its
   * refresh token no longer works (the session was ended server-side).
   */
  async function lapsedBrowser(email: string) {
    const browser = new Browser("lapsed")
    await signedIn(browser, email)
    const { name, session } = readSessionCookie(browser)

    // The session is over server-side, so its refresh token is refused too.
    const { error } = await service.auth.admin.signOut(
      session.access_token,
      "global"
    )
    expect(error).toBeNull()

    writeSessionCookie(browser, name, {
      ...session,
      access_token: resignAccessToken(session.access_token, -120),
      expires_at: Math.floor(Date.now() / 1000) - 120,
      expires_in: -120,
    })
    return browser
  }

  it("proxy sends the expired session to /login and clears its cookies", async () => {
    const browser = await lapsedBrowser(staff.email)
    for (const path of ["/staff", "/admin", "/admin/staff", "/admin/staff/x"]) {
      const res = await proxy(appRequest(browser, path))
      expect(res.status).toBe(307)
      expect(new URL(res.headers.get("location")!).pathname).toBe("/login")
      expect(new URL(res.headers.get("location")!).search).toBe("")
      expect(await res.text()).toBe("")
      const cleared = res.cookies
        .getAll()
        .filter((c) => c.name.includes("-auth-token"))
      expect(cleared.length).toBeGreaterThan(0)
      expect(cleared.every((c) => c.value === "" || c.maxAge === 0)).toBe(true)
    }
  })

  it("pages, Server Functions and routes treat it as signed out and return no data", async () => {
    const browser = await lapsedBrowser(staff.email)
    const run = <T>(fn: () => Promise<T>) => browser.run(fn)

    expect((await run(getAuthState)).status).toBe("signed_out")
    const props = { searchParams: Promise.resolve({}) }
    for (const page of [RootPage, StaffPage, () => AdminPage(props)]) {
      expect((await run(() => redirectOf(page))).location).toBe("/login")
    }
    expect(await run(() => loadMyMedia(null))).toEqual({
      ok: false,
      message: "Sign in to continue.",
    })
    expect(await run(() => loadLibraryPage({}, null))).toEqual({
      ok: false,
      message: "Sign in to continue.",
    })

    const params = { params: Promise.resolve({ id: staff.id }) }
    const dl = await run(() => download(appRequest(browser, "/x"), params))
    expect(dl.status).toBe(401)
    const av = await run(() => avatar(appRequest(browser, "/x"), params))
    expect(av.status).toBe(401)
    expect(av.headers.get("location")).toBeNull()
  })

  it("PostgREST and Storage reject the expired token outright", async () => {
    const browser = new Browser("rest")
    await signedIn(browser, staff.email)
    const { session } = readSessionCookie(browser)
    const env = getLocalSupabaseEnv()
    const get = (token: string) =>
      fetch(`${env.url}/rest/v1/profiles?select=id,display_name`, {
        headers: {
          apikey: env.publishableKey,
          authorization: `Bearer ${token}`,
        },
      })

    // Control: the same claims with a future exp are accepted (own row only).
    const valid = await get(resignAccessToken(session.access_token, 600))
    expect(valid.status).toBe(200)
    expect((await valid.json()).map((r: { id: string }) => r.id)).toEqual([
      staff.id,
    ])

    const expired = resignAccessToken(session.access_token, -120)
    const rest = await get(expired)
    expect(rest.status).toBe(401)
    expect(await rest.text()).not.toContain(staff.id)

    const storage = await fetch(`${env.url}/storage/v1/object/list/avatars`, {
      method: "POST",
      headers: {
        apikey: env.publishableKey,
        authorization: `Bearer ${expired}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ prefix: staff.id }),
    })
    expect(storage.ok).toBe(false)

    const user = await fetch(`${env.url}/auth/v1/user`, {
      headers: {
        apikey: env.publishableKey,
        authorization: `Bearer ${expired}`,
      },
    })
    expect(user.status).toBe(403)
    expect(await user.text()).not.toContain(staff.email)
  })

  it("logout ends the session for this browser only", async () => {
    const a = new Browser("logout-a")
    const b = new Browser("logout-b")
    await signedIn(a, admin.email)
    await signedIn(b, admin.email)

    const res = await a.run(() => logout())
    expect(res.status).toBe(303)
    expect(res.headers.get("location")).toBe("/login?signed_out=1")
    expect(a.authCookies().filter((c) => !c.name.includes("verifier"))).toEqual(
      []
    )
    expect((await a.run(getAuthState)).status).toBe("signed_out")
    expect((await b.run(getAuthState)).status).toBe("active")
  })
})
