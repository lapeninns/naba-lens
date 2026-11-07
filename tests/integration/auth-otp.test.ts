// Sign-in codes: the one-time code in the sign-in email, checked through the
// real login Server Function (and the browser helper the upload recovery sheet
// uses) against the local stack. See ./auth-support.ts for the harness.
import { beforeAll, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))
vi.mock("next/headers", () =>
  import("./auth-support").then((m) => m.nextHeadersMock())
)
vi.mock("next/cache", () => ({ revalidatePath: () => {} }))

import { requestSignInLink, verifySignInCodeAction } from "@/app/login/actions"
import RootPage from "@/app/page"
import { getAuthState } from "@/lib/auth"
import {
  SIGN_IN_CODE_FORMAT_MESSAGE,
  SIGN_IN_CODE_INVALID_MESSAGE,
  signInWithCode,
} from "@/lib/auth/magic-link"

import {
  anonClient,
  createIdentity,
  createVenue,
  serviceClient,
  testEmail,
  type TestIdentity,
} from "../support/identities"
import {
  ageEmailLinks,
  authUserCount,
  Browser,
  issueSignInCode,
  issueSignInEmail,
  latestSubject,
  mailCount,
  nextConfirmLink,
  nextSignInEmail,
  redirectOf,
} from "./auth-support"
import { followEmailLink } from "./auth-confirm"

const service = serviceClient()
const INVALID = { error: SIGN_IN_CODE_INVALID_MESSAGE }

async function enterCode(browser: Browser, email: string, code: string) {
  return browser.run(() => verifySignInCodeAction(email, code))
}

async function sessionCookies(browser: Browser) {
  return browser.authCookies().filter((c) => !c.name.includes("verifier"))
}

async function openLink(browser: Browser, confirmPath: string) {
  const res = await followEmailLink(browser, confirmPath)
  return { status: res.status, location: res.location }
}

/** Another digit string of the same length that is not `code`. */
function wrongCode(code: string) {
  const last = Number(code.at(-1))
  return `${code.slice(0, -1)}${(last + 1) % 10}`
}

let venue: { id: string }
let staff: TestIdentity

beforeAll(async () => {
  venue = await createVenue(service, "otp")
  staff = await createIdentity(service, {
    label: "otp-staff",
    role: "staff",
    venueId: venue.id,
    session: false,
  })
})

describe("sign-in codes", () => {
  it("the emailed code signs the person in and routes by role", async () => {
    // A real email, so the template's code is proven end to end.
    const browser = new Browser("otp-real")
    const seen = await mailCount(staff.email)
    expect(await browser.run(() => requestSignInLink(staff.email))).toEqual({})
    const { link, code } = await nextSignInEmail(staff.email, seen)
    expect(link).toContain("/auth/confirm?token_hash=")
    expect(link).not.toContain(code)

    expect(await enterCode(browser, staff.email, code)).toEqual({ ok: true })
    expect((await sessionCookies(browser)).length).toBeGreaterThan(0)
    expect((await browser.run(getAuthState)).status).toBe("active")
    expect((await browser.run(() => redirectOf(RootPage))).location).toBe(
      "/staff/tasks"
    )
  })

  it("the sign-in email says it holds a link and a code", async () => {
    // The stack's max_frequency spaces out emails to one address.
    await new Promise((resolve) => setTimeout(resolve, 1100))
    const seen = await mailCount(staff.email)
    expect(
      await new Browser("otp-subject").run(() => requestSignInLink(staff.email))
    ).toEqual({})
    await nextSignInEmail(staff.email, seen)
    expect(await latestSubject(staff.email)).toBe(
      "Your Naba-Lens sign-in link and code"
    )
  })

  it("accepts the code with spaces or dashes, and refuses a part code without a check", async () => {
    const code = await issueSignInCode(service, staff.email)
    const browser = new Browser("otp-format")
    expect(await enterCode(browser, staff.email, code.slice(0, 3))).toEqual({
      error: SIGN_IN_CODE_FORMAT_MESSAGE,
    })
    expect(await enterCode(browser, "not-an-email", code)).toEqual({
      error: "Enter a full email address, like name@example.com.",
    })
    const spaced = `${code.slice(0, 3)} - ${code.slice(3)}`
    expect(
      await enterCode(browser, ` ${staff.email.toUpperCase()} `, spaced)
    ).toEqual({ ok: true })
    expect((await browser.run(getAuthState)).status).toBe("active")
  })

  it("a wrong code is refused, sets no session and leaves the right one usable", async () => {
    const code = await issueSignInCode(service, staff.email)
    const browser = new Browser("otp-wrong")
    expect(await enterCode(browser, staff.email, wrongCode(code))).toEqual(
      INVALID
    )
    expect(await sessionCookies(browser)).toEqual([])
    expect((await browser.run(getAuthState)).status).toBe("signed_out")
    expect(await enterCode(browser, staff.email, code)).toEqual({ ok: true })
  })

  it("an expired code is refused", async () => {
    const code = await issueSignInCode(service, staff.email)
    ageEmailLinks(staff.id)
    const browser = new Browser("otp-expired")
    expect(await enterCode(browser, staff.email, code)).toEqual(INVALID)
    expect(await sessionCookies(browser)).toEqual([])
  })

  it("a code works once; using it again (any browser) is refused", async () => {
    const code = await issueSignInCode(service, staff.email)
    const first = new Browser("otp-first")
    expect(await enterCode(first, staff.email, code)).toEqual({ ok: true })
    const before = first.cookieHeader()
    expect(await enterCode(first, staff.email, code)).toEqual(INVALID)
    // The first session is untouched by the failed reuse.
    expect(first.cookieHeader()).toBe(before)

    const other = new Browser("otp-second")
    expect(await enterCode(other, staff.email, code)).toEqual(INVALID)
    expect(await sessionCookies(other)).toEqual([])
  })

  it("the link and the code from one email work once between them", async () => {
    // Code first: the link from the same email is then refused.
    const first = await issueSignInEmail(service, staff.email)
    expect(
      await enterCode(new Browser("otp-code"), staff.email, first.code)
    ).toEqual({ ok: true })
    expect(await openLink(new Browser("otp-then-link"), first.link)).toEqual({
      status: 303,
      location: "/login?error=link_invalid",
    })

    // Link first: the code from the same email is then refused.
    await new Promise((resolve) => setTimeout(resolve, 1100))
    const second = await issueSignInEmail(service, staff.email)
    expect(await openLink(new Browser("otp-link"), second.link)).toEqual({
      status: 303,
      location: "/",
    })
    const late = new Browser("otp-then-code")
    expect(await enterCode(late, staff.email, second.code)).toEqual(INVALID)
    expect(await sessionCookies(late)).toEqual([])
  })

  it("a newer code replaces the older one", async () => {
    const older = await issueSignInCode(service, staff.email)
    // Supabase keeps one outstanding sign-in token per user.
    await new Promise((resolve) => setTimeout(resolve, 1100))
    const newer = await issueSignInCode(service, staff.email)
    expect(newer).not.toBe(older)
    expect(await enterCode(new Browser("otp-old"), staff.email, older)).toEqual(
      INVALID
    )
    expect(await enterCode(new Browser("otp-new"), staff.email, newer)).toEqual(
      { ok: true }
    )
  })

  it("an email without an account gets the same answer and no account", async () => {
    const email = testEmail("otp-stranger")
    const browser = new Browser("otp-stranger")
    expect(await enterCode(browser, email, "123456")).toEqual(INVALID)
    expect(await sessionCookies(browser)).toEqual([])
    expect(authUserCount(email)).toBe(0)
  })

  it("the browser check used by upload recovery resolves the signed-in user", async () => {
    const code = await issueSignInCode(service, staff.email)
    const browserClient = anonClient()
    expect(
      await signInWithCode(browserClient, staff.email, wrongCode(code))
    ).toEqual(INVALID)
    expect(await signInWithCode(browserClient, staff.email, code)).toEqual({
      userId: staff.id,
    })
    const { data } = await browserClient.auth.getSession()
    expect(data.session?.user.id).toBe(staff.id)
  })

  it("a newly invited person activates with the invitation, then signs in with a code", async () => {
    const email = testEmail("otp-invitee")
    const seen = await mailCount(email)
    const invited = await service.auth.admin.inviteUserByEmail(email)
    expect(invited.error).toBeNull()
    const { error } = await service.from("profiles").insert({
      id: invited.data.user!.id,
      display_name: "TEST otp invitee",
      role: "staff",
      venue_id: venue.id,
    })
    expect(error).toBeNull()
    // Invitations stay link-only.
    const invite = await nextConfirmLink(email, seen)
    expect(invite).toContain("type=invite")
    expect(await openLink(new Browser("otp-invite"), invite)).toEqual({
      status: 303,
      location: "/",
    })

    await new Promise((resolve) => setTimeout(resolve, 1100))
    const code = await issueSignInCode(service, email)
    const later = new Browser("otp-invitee-later")
    expect(await enterCode(later, email, code)).toEqual({ ok: true })
    expect((await later.run(() => redirectOf(RootPage))).location).toBe(
      "/staff/tasks"
    )
  })
})
