import type { User } from "@supabase/supabase-js"
import { beforeEach, describe, expect, it, vi } from "vitest"

import type { AccountsContext, Db } from "@/lib/server/accounts/context"
import { staffStatus } from "@/lib/server/accounts/directory"
import { resendInvitation } from "@/lib/server/accounts/invite"

// "Invited" must mean the invitation can still be resent. GoTrue refuses to
// re-invite a confirmed address, so an account that confirmed its email but
// never signed in (seeded or legacy accounts) is Active: it signs in from the
// login page, and the directory must not offer Resend invitation for it.
vi.mock("@/lib/server/accounts/context", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/server/accounts/context")>()
  return {
    ...actual,
    requireAdminCaller: vi.fn(async () => ({
      ok: true,
      admin: { id: "admin", role: "admin" },
    })),
  }
})

const ID = "11111111-1111-4111-8111-111111111111"
const EMAIL = "invitee@example.test"
const AT = "2026-11-01T09:00:00Z"

// GoTrue sends null for an unset time; the User type says undefined. Both read as unset.
type AuthFields = {
  last_sign_in_at?: string | null
  email_confirmed_at?: string | null
}
const asUser = (fields: AuthFields) =>
  fields as Pick<User, "last_sign_in_at" | "email_confirmed_at">

describe("staffStatus", () => {
  it.each<[string, AuthFields, "active" | "invited"]>([
    [
      "never signed in, email unconfirmed",
      { last_sign_in_at: null, email_confirmed_at: null },
      "invited",
    ],
    [
      "confirmed but never signed in",
      { last_sign_in_at: null, email_confirmed_at: AT },
      "active",
    ],
    ["signed in", { last_sign_in_at: AT, email_confirmed_at: AT }, "active"],
  ])("%s → %s", (_case, user, status) => {
    expect(staffStatus(true, asUser(user))).toBe(status)
  })

  it("deactivation wins, and a missing auth user is still invited", () => {
    expect(
      staffStatus(
        false,
        asUser({ last_sign_in_at: AT, email_confirmed_at: AT })
      )
    ).toBe("inactive")
    expect(staffStatus(true, null)).toBe("invited")
  })
})

function context(user: AuthFields) {
  const profile = {
    id: ID,
    role: "staff",
    active: true,
    display_name: "DEV FIXTURE Manager A",
  }
  const maybeSingle = vi.fn(async () => ({ data: profile, error: null }))
  const caller = {
    from: vi.fn(() => ({
      select: vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle })) })),
    })),
  } as unknown as Db
  const service = {
    auth: {
      admin: {
        getUserById: vi.fn(async () => ({
          data: { user: { id: ID, email: EMAIL, ...user } },
          error: null,
        })),
      },
    },
  } as unknown as Db
  const mailer = vi.fn(async () => ({ error: null }))
  const ctx: AccountsContext = { caller, service, mailer }
  return { ctx, mailer }
}

describe("resendInvitation follows the same rule", () => {
  beforeEach(() => vi.clearAllMocks())

  it("resends while the invitation is open", async () => {
    const { ctx, mailer } = context({
      last_sign_in_at: null,
      email_confirmed_at: null,
    })
    expect(await resendInvitation(ctx, ID)).toEqual({ ok: true })
    expect(mailer).toHaveBeenCalledExactlyOnceWith(EMAIL)
  })

  it("refuses a confirmed account that never signed in, without asking GoTrue", async () => {
    const { ctx, mailer } = context({
      last_sign_in_at: null,
      email_confirmed_at: AT,
    })
    expect(await resendInvitation(ctx, ID)).toMatchObject({
      ok: false,
      code: "already_signed_in",
    })
    expect(mailer).not.toHaveBeenCalled()
  })
})
