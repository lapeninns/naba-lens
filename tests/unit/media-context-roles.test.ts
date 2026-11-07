import { beforeEach, describe, expect, it, vi } from "vitest"

import type { AppRole } from "@/lib/auth/routes"

// D15: getMediaActor admits staff and admins by default, never venue managers;
// a surface opens to managers only by naming "manager" (string or list form).
vi.mock("server-only", () => ({}))
const getAuthState = vi.fn()
vi.mock("@/lib/auth", () => ({ getAuthState: () => getAuthState() }))
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({})),
}))
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => ({})),
}))
vi.mock("@/lib/supabase/env", () => ({
  getSupabasePublicEnv: () => ({
    url: "http://127.0.0.1:1",
    publishableKey: "x",
  }),
}))

const { getMediaActor, DEFAULT_MEDIA_ROLES } =
  await import("@/lib/server/media/context")

function signedInAs(role: AppRole) {
  getAuthState.mockResolvedValue({
    status: "active",
    profile: {
      id: "u1",
      email: null,
      displayName: "A",
      avatarPath: null,
      jobTitle: null,
      role,
      venueId: "v1",
      venue: null,
      active: true,
    },
  })
}

const denied = { ok: false, status: 403, message: "Not allowed." }

describe("getMediaActor roles", () => {
  beforeEach(() => {
    getAuthState.mockReset()
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "test-service-key")
  })

  it("defaults to staff and admin only", async () => {
    expect(DEFAULT_MEDIA_ROLES).toEqual(["staff", "admin"])
    for (const role of ["staff", "admin"] as const) {
      signedInAs(role)
      expect((await getMediaActor()).ok, role).toBe(true)
    }
    signedInAs("manager")
    expect(await getMediaActor()).toEqual(denied)
  })

  it("still accepts a single role", async () => {
    signedInAs("staff")
    expect((await getMediaActor("staff")).ok).toBe(true)
    expect(await getMediaActor("admin")).toEqual(denied)
    signedInAs("manager")
    expect((await getMediaActor("manager")).ok).toBe(true)
    expect(await getMediaActor("staff")).toEqual(denied)
  })

  it("accepts a list of roles", async () => {
    signedInAs("manager")
    expect((await getMediaActor(["manager", "admin"])).ok).toBe(true)
    expect(await getMediaActor(["staff", "admin"])).toEqual(denied)
    signedInAs("staff")
    expect(await getMediaActor(["manager", "admin"])).toEqual(denied)
    expect(await getMediaActor([])).toEqual(denied)
  })

  it("checks the account state before the role", async () => {
    getAuthState.mockResolvedValue({ status: "signed_out" })
    expect(await getMediaActor(["manager"])).toMatchObject({ status: 401 })
    getAuthState.mockResolvedValue({
      status: "inactive",
      profile: { role: "manager" },
    })
    expect(await getMediaActor(["manager"])).toMatchObject({
      ok: false,
      status: 403,
      message: "Your account is not active.",
    })
  })
})
