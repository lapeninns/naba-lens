import { describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))
const signOut = vi.fn()
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { signOut } }),
}))

const { POST } = await import("@/app/auth/logout/route")

describe("POST /auth/logout with an ended session", () => {
  it("still lands on the signed-out login page", async () => {
    signOut.mockResolvedValue({
      error: { name: "AuthSessionMissingError", status: 400 },
    })
    const res = await POST()
    expect(res.status).toBe(303)
    expect(res.headers.get("location")).toBe("/login?signed_out=1")
    expect(signOut).toHaveBeenCalledWith({ scope: "local" })
  })
})
