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
    const res = await POST(new Request("http://127.0.0.1:3000/auth/logout"))
    expect(res.status).toBe(303)
    expect(res.headers.get("location")).toBe("/login?signed_out=1")
    expect(signOut).toHaveBeenCalledWith({ scope: "local" })
  })
})

describe("POST /auth/logout from another site", () => {
  const post = (headers: Record<string, string>) =>
    POST(
      new Request("http://127.0.0.1:3000/auth/logout", {
        method: "POST",
        headers,
      })
    )

  it("refuses a cross-site form and keeps the session", async () => {
    signOut.mockClear()
    const res = await post({
      origin: "https://evil.example",
      host: "app.nabalens.test",
    })
    expect(res.status).toBe(403)
    expect(signOut).not.toHaveBeenCalled()
    expect(
      (await post({ origin: "null", host: "app.nabalens.test" })).status
    ).toBe(403)
    expect(signOut).not.toHaveBeenCalled()
  })

  it("signs out a form from this site, behind a proxy, or with no Origin", async () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "http://127.0.0.1:3000")
    signOut.mockClear()
    signOut.mockResolvedValue({ error: null })
    const cases: Record<string, string>[] = [
      { origin: "https://app.nabalens.test", host: "app.nabalens.test" },
      {
        origin: "https://app.nabalens.test",
        host: "internal:3000",
        "x-forwarded-host": "app.nabalens.test",
      },
      // The configured site URL (NEXT_PUBLIC_SITE_URL, 127.0.0.1:3000 by default).
      { origin: "http://127.0.0.1:3000", host: "localhost:3000" },
      { host: "app.nabalens.test" },
    ]
    for (const headers of cases) {
      const res = await post(headers)
      expect(res.status, JSON.stringify(headers)).toBe(303)
    }
    expect(signOut).toHaveBeenCalledTimes(4)
    vi.unstubAllEnvs()
  })
})
