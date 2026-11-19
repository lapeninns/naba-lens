// FA-23 (spec §3.2): admins pass a TOTP second step every session; anyone
// who has a factor is asked for it. lib/auth/mfa.ts decides; getAuthState
// returns mfa_required before any page or Server Function runs.
import { beforeEach, describe, expect, it, vi } from "vitest"

import {
  assuranceLevel,
  mayEnrolMfa,
  mfaRequirement,
  normaliseTotpCode,
  readsFactors,
  readVerifiedFactors,
} from "@/lib/auth/mfa"

describe("mfaRequirement", () => {
  it("asks an admin without a factor to set one up, and with one for its code", () => {
    expect(mfaRequirement("admin", "aal1", 0)).toBe("enrol")
    expect(mfaRequirement("admin", "aal1", null)).toBe("enrol")
    expect(mfaRequirement("admin", "aal1", 2)).toBe("verify")
    expect(mfaRequirement("admin", "aal2", 1)).toBeNull()
  })

  it("asks a manager or staff member only once they have a factor", () => {
    for (const role of ["manager", "staff"] as const) {
      expect(mfaRequirement(role, "aal1", 0)).toBeNull()
      expect(mfaRequirement(role, "aal1", null)).toBeNull()
      expect(mfaRequirement(role, "aal1", 1)).toBe("verify")
      expect(mfaRequirement(role, "aal2", 1)).toBeNull()
    }
  })

  it("reads the level from the claims and factors only where they matter", () => {
    expect(assuranceLevel({ aal: "aal2" })).toBe("aal2")
    expect(assuranceLevel({ aal: "aal1" })).toBe("aal1")
    expect(assuranceLevel({})).toBe("aal1")
    expect(assuranceLevel({ aal: "AAL2" })).toBe("aal1")
    expect(readsFactors("admin")).toBe(true)
    expect(readsFactors("manager")).toBe(true)
    expect(readsFactors("staff")).toBe(false)
    expect(mayEnrolMfa("manager")).toBe(true)
    expect(mayEnrolMfa("staff")).toBe(false)
  })

  it("accepts six digits, spaces allowed", () => {
    expect(normaliseTotpCode("123456")).toBe("123456")
    expect(normaliseTotpCode(" 123 456 ")).toBe("123456")
    for (const bad of ["12345", "1234567", "12345a", null, 123456])
      expect(normaliseTotpCode(bad)).toBeNull()
  })
})

describe("readVerifiedFactors", () => {
  it("returns the count, and throws when it cannot be read", async () => {
    const client = (result: unknown) =>
      ({ rpc: vi.fn().mockResolvedValue(result) }) as never
    expect(
      await readVerifiedFactors(
        client({ data: { aal: "aal1", verifiedFactors: 2 }, error: null })
      )
    ).toBe(2)
    expect(await readVerifiedFactors(client({ data: null, error: null }))).toBe(
      0
    )
    await expect(
      readVerifiedFactors(client({ data: null, error: { code: "PGRST202" } }))
    ).rejects.toThrow("Could not read MFA status")
  })
})

// getAuthState, with Supabase and the profile read mocked.
const claims = vi.fn()
const rpc = vi.fn()
const profile = vi.fn()
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getClaims: claims }, rpc }),
}))
vi.mock("@/lib/auth/profile", async (original) => ({
  ...(await original<typeof import("@/lib/auth/profile")>()),
  loadProfile: (...args: unknown[]) => profile(...args),
}))

describe("getAuthState", () => {
  const active = (role: "staff" | "manager" | "admin") => ({
    id: "u1",
    email: null,
    displayName: "A",
    avatarPath: null,
    jobTitle: null,
    role,
    venueId: null,
    venue: null,
    active: true,
    work: null,
  })

  beforeEach(() => {
    vi.resetModules()
    claims.mockReset()
    rpc.mockReset()
    profile.mockReset()
  })

  async function stateFor(
    role: "staff" | "manager" | "admin",
    aal: string,
    factors: number
  ) {
    claims.mockResolvedValue({ data: { claims: { sub: "u1", aal } } })
    profile.mockResolvedValue(active(role))
    rpc.mockResolvedValue({
      data: { aal, verifiedFactors: factors },
      error: null,
    })
    const { getAuthState } = await import("@/lib/auth")
    return getAuthState()
  }

  it("holds an admin at aal1 and lets an aal2 admin through", async () => {
    expect(await stateFor("admin", "aal1", 0)).toMatchObject({
      status: "mfa_required",
      requirement: "enrol",
    })
    expect(await stateFor("admin", "aal1", 1)).toMatchObject({
      status: "mfa_required",
      requirement: "verify",
    })
    expect(await stateFor("admin", "aal2", 1)).toMatchObject({
      status: "active",
    })
  })

  it("holds a manager with a factor, never staff without the read", async () => {
    expect(await stateFor("manager", "aal1", 1)).toMatchObject({
      status: "mfa_required",
      requirement: "verify",
    })
    expect(await stateFor("manager", "aal1", 0)).toMatchObject({
      status: "active",
    })
    rpc.mockClear()
    expect(await stateFor("staff", "aal1", 1)).toMatchObject({
      status: "active",
    })
    expect(rpc).not.toHaveBeenCalled()
  })
})
