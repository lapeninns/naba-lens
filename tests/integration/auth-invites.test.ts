// Invitations and admin self-lockout, through the real admin Server Functions
// (real Supabase invite emails in Mailpit) and, for provider failures, the same
// lib/server/accounts code with one failing dependency.
import { beforeAll, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))
vi.mock("next/headers", () =>
  import("./auth-support").then((m) => m.nextHeadersMock())
)
vi.mock("next/cache", () => ({ revalidatePath: () => {} }))

import {
  inviteStaffAction,
  resendInvitationAction,
  setStaffActiveAction,
  updateStaffAccountAction,
} from "@/app/admin/staff/actions"
import AdminPage from "@/app/admin/page"
import RootPage from "@/app/page"
import { getAuthState } from "@/lib/auth"
import {
  inviteStaff,
  listStaffDirectory,
  type AccountsContext,
  type InviteMailer,
} from "@/lib/server/accounts"

import {
  anonClient,
  createIdentity,
  createVenue,
  serviceClient,
  testEmail,
  type Db,
} from "../support/identities"
import {
  authUserCount,
  authUserIds,
  Browser,
  issueSignInLink,
  mailCount,
  nextConfirmLink,
  readSessionCookie,
  redirectOf,
} from "./auth-support"
import { followEmailLink } from "./auth-confirm"

const service = serviceClient()
const INVITED = /invited/i

let venue: { id: string }
let admin: { id: string; email: string; browser: Browser; rest: Db }

async function signIn(email: string) {
  const browser = new Browser(email)
  const link = await issueSignInLink(service, email)
  const res = await followEmailLink(browser, link)
  expect(res.location).toBe("/")
  const { session } = readSessionCookie(browser)
  const rest = anonClient()
  await rest.auth.setSession({
    access_token: session.access_token,
    refresh_token: session.refresh_token,
  })
  return { browser, rest }
}

const invite = (email: string, extra: object = {}) =>
  admin.browser.run(() =>
    inviteStaffAction({
      displayName: "TEST Invitee",
      email,
      jobTitle: "Bartender",
      venueId: venue.id,
      ...extra,
    })
  )

async function profileOf(id: string) {
  const { data } = await service
    .from("profiles")
    .select("id, role, active, venue_id, display_name")
    .eq("id", id)
    .maybeSingle()
  return data
}

async function idOf(email: string): Promise<string> {
  const [id] = authUserIds(email)
  if (!id) throw new Error(`no auth user ${email}`)
  return id
}

/** Opens the newest invitation email and follows its link in a fresh browser. */
async function acceptLatestInvite(email: string, seenBefore: number) {
  const link = await nextConfirmLink(email, seenBefore)
  expect(link).toContain("type=invite")
  const browser = new Browser(`invitee ${email}`)
  const res = await followEmailLink(browser, link)
  return { browser, link, location: res.location }
}

beforeAll(async () => {
  venue = await createVenue(service, "invites")
  const identity = await createIdentity(service, {
    label: "inv-admin",
    role: "admin",
    session: false,
  })
  admin = { ...identity, ...(await signIn(identity.email)) }
})

describe("invitations", { timeout: 60_000 }, () => {
  it("a duplicate invitation is refused and creates or sends nothing", async () => {
    const email = testEmail("inv-dup")
    expect(await invite(email)).toEqual({ status: "sent" })
    expect(await mailCount(email, INVITED)).toBe(1)
    const id = await idOf(email)
    const before = await profileOf(id)

    for (const variant of [email, email.toUpperCase(), `  ${email} `]) {
      const again = await invite(variant, { displayName: "TEST Other name" })
      expect(again).toMatchObject({
        status: "error",
        fieldErrors: { email: expect.any(String) },
      })
    }
    expect(authUserCount(email)).toBe(1)
    expect(await profileOf(id)).toEqual(before)
    await new Promise((resolve) => setTimeout(resolve, 500))
    expect(await mailCount(email, INVITED)).toBe(1)
  })

  it("resend sends a fresh invitation that works; the older one stops working", async () => {
    const email = testEmail("inv-resend")
    expect(await invite(email)).toEqual({ status: "sent" })
    const id = await idOf(email)
    const firstLink = await nextConfirmLink(email, 0)

    expect(await admin.browser.run(() => resendInvitationAction(id))).toEqual({
      ok: true,
    })
    expect(authUserCount(email)).toBe(1)
    const accepted = await acceptLatestInvite(email, 1)
    expect(accepted.link).not.toBe(firstLink)
    expect(accepted.location).toBe("/")
    expect(
      (await accepted.browser.run(() => redirectOf(RootPage))).location
    ).toBe("/staff")

    const stale = new Browser("stale invite")
    const res = await followEmailLink(stale, firstLink)
    expect(res.location).toBe("/login?error=link_invalid")

    // Once they have signed in, resend is refused and sends nothing.
    const seen = await mailCount(email, INVITED)
    const late = await admin.browser.run(() => resendInvitationAction(id))
    expect(late).toMatchObject({ ok: false })
    expect(await mailCount(email, INVITED)).toBe(seen)
    expect(authUserCount(email)).toBe(1)
  })

  describe("provider failures recover without duplicate accounts", () => {
    /** The Server Function's context, with the admin's real session. */
    const ctx = (over: Partial<AccountsContext> = {}): AccountsContext => ({
      caller: admin.rest,
      service,
      ...over,
    })

    it("email provider down: partial, then resend delivers and the person gets in", async () => {
      const email = testEmail("inv-smtp")
      const down: InviteMailer = async () => ({
        error: { code: "unexpected_failure", message: "SMTP down (simulated)" },
      })
      const first = await inviteStaff(ctx({ mailer: down }), {
        displayName: "TEST SMTP",
        email,
        jobTitle: null,
        venueId: venue.id,
      })
      expect(first.status).toBe("partial")
      if (first.status !== "partial") return
      expect(authUserCount(email)).toBe(1)
      expect(await mailCount(email, INVITED)).toBe(0)

      // Shown as invited, so the admin knows to resend.
      const directory = await listStaffDirectory(ctx())
      expect(
        directory.ok && directory.staff.find((s) => s.id === first.userId)
      ).toMatchObject({ status: "invited", email })

      // Re-inviting is refused (no second account); resend is the recovery.
      expect(await invite(email)).toMatchObject({ status: "error" })
      expect(authUserCount(email)).toBe(1)
      expect(
        await admin.browser.run(() => resendInvitationAction(first.userId))
      ).toEqual({ ok: true })
      const accepted = await acceptLatestInvite(email, 0)
      expect(accepted.location).toBe("/")
      expect((await accepted.browser.run(getAuthState)).status).toBe("active")
      expect(authUserCount(email)).toBe(1)
    })

    it("auth provider refuses to create the user: nothing is saved, a retry works", async () => {
      const email = testEmail("inv-auth-down")
      const failing = serviceClient()
      failing.auth.admin.createUser = async () =>
        ({
          data: { user: null },
          error: { code: "unexpected_failure", message: "down", status: 500 },
        }) as never
      const result = await inviteStaff(ctx({ service: failing }), {
        displayName: "TEST Auth down",
        email,
        jobTitle: null,
        venueId: venue.id,
      })
      expect(result).toMatchObject({ status: "error", code: "auth_failed" })
      expect(authUserCount(email)).toBe(0)

      expect(await invite(email)).toEqual({ status: "sent" })
      expect(authUserCount(email)).toBe(1)
    })

    it("profile write fails: the new auth user is rolled back, a retry works", async () => {
      const email = testEmail("inv-db-down")
      const failing = serviceClient()
      const from = failing.from.bind(failing)
      failing.from = ((table: string) =>
        table === "profiles"
          ? {
              insert: async () => ({
                error: { code: "XX000", message: "simulated" },
              }),
            }
          : from(table as never)) as never
      const result = await inviteStaff(ctx({ service: failing }), {
        displayName: "TEST DB down",
        email,
        jobTitle: null,
        venueId: venue.id,
      })
      expect(result).toMatchObject({ status: "error", code: "database_failed" })
      expect(authUserCount(email)).toBe(0)

      expect(await invite(email)).toEqual({ status: "sent" })
      expect(authUserCount(email)).toBe(1)
    })

    it("profile write and rollback both fail: the retry adopts the same auth user", async () => {
      const email = testEmail("inv-orphan")
      const failing = serviceClient()
      const from = failing.from.bind(failing)
      failing.from = ((table: string) =>
        table === "profiles"
          ? {
              insert: async () => ({
                error: { code: "XX000", message: "simulated" },
              }),
            }
          : from(table as never)) as never
      failing.auth.admin.deleteUser = async () =>
        ({
          data: { user: null },
          error: { code: "unexpected_failure", message: "down", status: 500 },
        }) as never
      const result = await inviteStaff(ctx({ service: failing }), {
        displayName: "TEST Orphan",
        email,
        jobTitle: null,
        venueId: venue.id,
      })
      expect(result).toMatchObject({ status: "error", code: "database_failed" })
      expect(authUserCount(email)).toBe(1)
      const orphanId = await idOf(email)

      expect(await invite(email)).toEqual({ status: "sent" })
      expect(authUserCount(email)).toBe(1)
      expect(await profileOf(orphanId)).toMatchObject({
        role: "staff",
        active: true,
      })
    })
  })

  it("activation changes report the new status for the admin UI", async () => {
    const email = testEmail("inv-status")
    expect(await invite(email)).toEqual({ status: "sent" })
    const id = await idOf(email)
    const run = <T>(fn: () => Promise<T>) => admin.browser.run(fn)
    expect(await run(() => setStaffActiveAction(id, false))).toEqual({
      ok: true,
      status: "inactive",
    })
    // Never signed in: back to Invited, so "Resend invitation" applies again.
    expect(await run(() => setStaffActiveAction(id, true))).toEqual({
      ok: true,
      status: "invited",
    })
    expect(
      await run(() => updateStaffAccountAction(id, { active: false }))
    ).toEqual({ ok: true, status: "inactive" })
    expect(
      await run(() => updateStaffAccountAction(id, { jobTitle: "Chef" }))
    ).toEqual({ ok: true })
  })

  it("an email that belongs to an admin is refused, and the admin is untouched", async () => {
    const other = await createIdentity(service, {
      label: "inv-other-admin",
      role: "admin",
      session: false,
    })
    const before = {
      self: await profileOf(admin.id),
      other: await profileOf(other.id),
    }
    const mailBefore = await mailCount(other.email)

    for (const email of [
      other.email,
      other.email.toUpperCase(),
      admin.email,
      ` ${admin.email.toUpperCase()} `,
    ]) {
      const result = await invite(email)
      expect(result).toMatchObject({
        status: "error",
        fieldErrors: { email: expect.any(String) },
      })
    }
    expect(await profileOf(admin.id)).toEqual(before.self)
    expect(await profileOf(other.id)).toEqual(before.other)
    expect(authUserCount(other.email)).toBe(1)
    expect(authUserCount(admin.email)).toBe(1)
    // Resend never targets admins either.
    expect(
      await admin.browser.run(() => resendInvitationAction(other.id))
    ).toMatchObject({ ok: false })
    await new Promise((resolve) => setTimeout(resolve, 500))
    expect(await mailCount(other.email)).toBe(mailBefore)
  })

  it("an invitation always creates staff, whatever the request says", async () => {
    const email = testEmail("inv-role")
    expect(await invite(email, { role: "admin", active: false })).toEqual({
      status: "sent",
    })
    expect(await profileOf(await idOf(email))).toMatchObject({
      role: "staff",
      active: true,
      venue_id: venue.id,
    })
  })
})

describe("admins cannot lock themselves out", () => {
  const stillAdmin = async () => {
    expect(await profileOf(admin.id)).toMatchObject({
      role: "admin",
      active: true,
    })
    expect((await admin.browser.run(getAuthState)).status).toBe("active")
    const page = await admin.browser.run(() =>
      redirectOf(() => AdminPage({ searchParams: Promise.resolve({}) }))
    )
    expect(page.location).toBeNull()
  }

  it("not through the account Server Functions", async () => {
    expect(
      await admin.browser.run(() => setStaffActiveAction(admin.id, false))
    ).toMatchObject({ ok: false })
    for (const patch of [
      { active: false },
      { role: "staff" },
      { venueId: venue.id, active: false },
    ]) {
      expect(
        await admin.browser.run(() => updateStaffAccountAction(admin.id, patch))
      ).toMatchObject({ ok: false })
    }
    await stillAdmin()
  })

  it("not through direct database updates on their own row", async () => {
    const deactivate = await admin.rest
      .from("profiles")
      .update({ active: false })
      .eq("id", admin.id)
    expect(deactivate.error?.message).toBe("self_deactivation_forbidden")
    const demote = await admin.rest
      .from("profiles")
      .update({ role: "staff" } as never)
      .eq("id", admin.id)
    expect(demote.error?.code).toBe("42501")
    await stillAdmin()
  })

  it("not by two admins deactivating or demoting each other", async () => {
    const other = await createIdentity(service, {
      label: "inv-peer-admin",
      role: "admin",
      session: false,
    })
    const peer = await signIn(other.email)
    for (const [db, target] of [
      [admin.rest, other.id],
      [peer.rest, admin.id],
    ] as const) {
      const off = await db
        .from("profiles")
        .update({ active: false })
        .eq("id", target)
        .select("id")
      expect(off.data ?? []).toEqual([])
    }
    expect(
      await peer.browser.run(() => setStaffActiveAction(admin.id, false))
    ).toMatchObject({ ok: false })
    expect(await profileOf(other.id)).toMatchObject({
      role: "admin",
      active: true,
    })
    await stillAdmin()
  })

  it("an admin's own auth session API cannot ban or remove them", async () => {
    const env = (
      await import("../support/local-supabase")
    ).getLocalSupabaseEnv()
    const { data } = await admin.rest.auth.getSession()
    const headers = {
      apikey: env.publishableKey,
      authorization: `Bearer ${data.session!.access_token}`,
      "content-type": "application/json",
    }
    const ban = await fetch(`${env.url}/auth/v1/admin/users/${admin.id}`, {
      method: "PUT",
      headers,
      body: JSON.stringify({ ban_duration: "1h" }),
    })
    expect([401, 403]).toContain(ban.status)
    const remove = await fetch(`${env.url}/auth/v1/admin/users/${admin.id}`, {
      method: "DELETE",
      headers,
    })
    expect([401, 403]).toContain(remove.status)
    await stillAdmin()
  })
})
