import { describe, expect, it, vi } from "vitest"

// Final review F7: /auth/confirm/verify uses the shared isSameOriginRequest, so
// a proxy's X-Forwarded-Host list or a mixed-case Host does not refuse a
// same-origin Continue from a browser without Sec-Fetch-Site.
vi.mock("server-only", () => ({}))
const createClient = vi.fn()
vi.mock("@/lib/supabase/server", () => ({ createClient }))

const { POST } = await import("@/app/auth/confirm/verify/route")

// No form body: the link is invalid, so a passing origin check answers 303 to
// login's recovery state without touching Supabase.
const post = (headers: Record<string, string>) =>
  POST(
    new Request("http://internal:3000/auth/confirm/verify", {
      method: "POST",
      headers,
    }) as never
  )

describe("/auth/confirm/verify origin check (final review F7)", () => {
  it("accepts a forwarded-host list and a mixed-case Host", async () => {
    for (const headers of [
      {
        host: "internal:3000",
        "x-forwarded-host": "nabalens.example, edge.internal",
        origin: "https://nabalens.example",
      },
      { host: "NabaLens.Example", origin: "https://nabalens.example" },
    ]) {
      const res = await post(headers)
      expect(res.status).toBe(303)
      expect(res.headers.get("location")).toBe("/login?error=link_invalid")
    }
    expect(createClient).not.toHaveBeenCalled()
  })

  it("still refuses cross-site, same-site, foreign and null origins", async () => {
    for (const headers of [
      { host: "nabalens.example", "sec-fetch-site": "cross-site" },
      { host: "nabalens.example", "sec-fetch-site": "same-site" },
      { host: "nabalens.example", origin: "https://evil.example" },
      { host: "nabalens.example", origin: "null" },
    ]) {
      expect((await post(headers)).status).toBe(403)
    }
  })
})
