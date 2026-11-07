import { beforeEach, describe, expect, it, vi } from "vitest"

import type { AccountsContext, Db } from "@/lib/server/accounts/context"
import { resendInvitation } from "@/lib/server/accounts/invite"

// An invited staff account can be converted to manager before its first
// sign-in; the admin must still be able to resend that invitation.
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

function context(role: string) {
  const profile = { id: ID, role, active: true, display_name: "Invitee" }
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
          data: { user: { id: ID, email: EMAIL, last_sign_in_at: null } },
          error: null,
        })),
      },
    },
  } as unknown as Db
  const mailer = vi.fn(async () => ({ error: null }))
  const ctx: AccountsContext = { caller, service, mailer }
  return { ctx, mailer }
}

describe("resendInvitation roles", () => {
  beforeEach(() => vi.clearAllMocks())

  it.each(["staff", "manager"])("resends to an invited %s", async (role) => {
    const { ctx, mailer } = context(role)
    expect(await resendInvitation(ctx, ID)).toEqual({ ok: true })
    expect(mailer).toHaveBeenCalledExactlyOnceWith(EMAIL)
  })

  it("refuses an admin profile as not found", async () => {
    const { ctx, mailer } = context("admin")
    expect(await resendInvitation(ctx, ID)).toMatchObject({
      ok: false,
      code: "not_found",
    })
    expect(mailer).not.toHaveBeenCalled()
  })
})
