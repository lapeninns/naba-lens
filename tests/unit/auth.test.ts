import { describe, expect, it, vi } from "vitest"

import { normaliseEmail, sendSignInLink } from "@/lib/auth/magic-link"
import {
  toAuthState,
  uploadBlockReason,
  type CurrentProfile,
} from "@/lib/auth/profile"
import { homePathFor, isProtectedPath } from "@/lib/auth/routes"

const base: CurrentProfile = {
  id: "u1",
  email: "a@example.test",
  displayName: "A",
  avatarPath: null,
  jobTitle: null,
  role: "staff",
  venueId: "v1",
  venue: { id: "v1", name: "V", slug: "v", active: true },
  active: true,
}

describe("role routing", () => {
  it("sends staff to /staff and admins to /admin", () => {
    expect(homePathFor("staff")).toBe("/staff")
    expect(homePathFor("admin")).toBe("/admin")
  })

  it("protects only the app areas", () => {
    expect(isProtectedPath("/staff")).toBe(true)
    expect(isProtectedPath("/admin/staff/123")).toBe(true)
    expect(isProtectedPath("/administrator")).toBe(false)
    expect(isProtectedPath("/login")).toBe(false)
    expect(isProtectedPath("/auth/confirm")).toBe(false)
  })
})

describe("toAuthState", () => {
  it("distinguishes signed-out, missing, inactive and active accounts", () => {
    expect(toAuthState(null, null)).toEqual({ status: "signed_out" })
    expect(toAuthState({ id: "u1", email: null }, null).status).toBe(
      "no_profile"
    )
    expect(
      toAuthState({ id: "u1", email: null }, { ...base, active: false }).status
    ).toBe("inactive")
    expect(toAuthState({ id: "u1", email: null }, base).status).toBe("active")
  })
})

describe("uploadBlockReason", () => {
  it("allows active staff at an active venue", () => {
    expect(uploadBlockReason(base)).toBeNull()
  })

  it("blocks admins, missing venues and inactive venues", () => {
    expect(uploadBlockReason({ ...base, role: "admin" })).toBe("not_staff")
    expect(uploadBlockReason({ ...base, venueId: null, venue: null })).toBe(
      "no_venue"
    )
    expect(
      uploadBlockReason({ ...base, venue: { ...base.venue!, active: false } })
    ).toBe("venue_inactive")
  })
})

describe("magic link", () => {
  it("normalises and validates email input", () => {
    expect(normaliseEmail("  Chef@Example.COM ")).toBe("chef@example.com")
    expect(normaliseEmail("not-an-email")).toBeNull()
    expect(normaliseEmail(null)).toBeNull()
  })

  it("never creates users and answers neutrally on errors", async () => {
    const signInWithOtp = vi.fn().mockResolvedValue({
      error: {
        code: "otp_disabled",
        status: 422,
        message: "Signups not allowed for otp",
      },
    })
    const supabase = { auth: { signInWithOtp } } as never
    await expect(
      sendSignInLink(supabase, "nobody@example.test", "http://x/auth/callback")
    ).resolves.toEqual({ status: "sent" })
    expect(signInWithOtp).toHaveBeenCalledWith({
      email: "nobody@example.test",
      options: {
        shouldCreateUser: false,
        emailRedirectTo: "http://x/auth/callback",
      },
    })
  })
})
