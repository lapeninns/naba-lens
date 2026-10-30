import { beforeEach, describe, expect, it, vi } from "vitest"

// Load follow-up: when the profile read fails (PostgREST 5xx), `loadProfile`
// throws. Reserve/finalise used to surface that as an HTTP 500; they must
// answer a typed, retryable 503 instead, while real denials stay 401/403.
vi.mock("server-only", () => ({}))
const getAuthState = vi.fn()
vi.mock("@/lib/auth", () => ({ getAuthState: () => getAuthState() }))
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }))
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }))
vi.mock("@/lib/supabase/env", () => ({
  getSupabasePublicEnv: () => ({
    url: "http://127.0.0.1:1",
    publishableKey: "x",
  }),
}))

const { getMediaActor } = await import("@/lib/server/media/context")
const { finaliseUpload, reserveUpload } = await import("@/app/staff/actions")
const { GET: download } = await import("@/app/api/media/[id]/download/route")

const ID = "0a6f3c2e-6a51-4f43-9a6a-2f1f8d1c0a01"
const downloadRequest = () =>
  download(new Request(`http://localhost/api/media/${ID}/download`), {
    params: Promise.resolve({ id: ID }),
  })

describe("media actor when the profile read fails", () => {
  beforeEach(() => {
    getAuthState.mockReset()
    getAuthState.mockRejectedValue(new Error("Could not load profile: 500"))
  })

  it("answers 503 with retry guidance instead of throwing", async () => {
    await expect(getMediaActor("staff")).resolves.toEqual({
      ok: false,
      status: 503,
      message: expect.stringMatching(/try again/i),
    })
  })

  it("reserve and finalise return the 503 as a value", async () => {
    for (const action of [reserveUpload, finaliseUpload]) {
      await expect(action({})).resolves.toMatchObject({
        ok: false,
        status: 503,
        message: expect.stringMatching(/try again/i),
      })
    }
  })

  it("the download route answers 503 with Retry-After, not 404 or 500", async () => {
    const res = await downloadRequest()
    expect(res.status).toBe(503)
    expect(res.headers.get("retry-after")).toBe("5")
    expect(res.headers.get("cache-control")).toBe("private, no-store")
  })

  it("keeps real denials: signed out 401, inactive 403, non-admin download 404", async () => {
    getAuthState.mockResolvedValue({ status: "signed_out" })
    await expect(getMediaActor("staff")).resolves.toMatchObject({ status: 401 })
    getAuthState.mockResolvedValue({ status: "inactive", profile: {} })
    await expect(getMediaActor("staff")).resolves.toMatchObject({ status: 403 })
    await expect(reserveUpload({})).resolves.toMatchObject({
      ok: false,
      status: 403,
    })
    getAuthState.mockResolvedValue({
      status: "active",
      profile: { id: ID, role: "staff" },
    })
    expect((await downloadRequest()).status).toBe(404)
  })
})
