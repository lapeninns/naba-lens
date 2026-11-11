import { beforeEach, describe, expect, it, vi } from "vitest"

import { OWN_MEDIA_ROLES } from "@/lib/server/media/roles"

const mocks = vi.hoisted(() => ({
  getMediaActor: vi.fn(),
  searchAssets: vi.fn(),
}))

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }))
vi.mock("@/lib/server/media/context", () => ({
  getMediaActor: mocks.getMediaActor,
}))
vi.mock("@/lib/server/media/search", () => ({
  searchAssets: mocks.searchAssets,
}))

beforeEach(() => {
  for (const m of Object.values(mocks)) m.mockReset()
})

const actor = { profile: { id: "u", active: true, role: "manager" } }
const UUID = "0b5a0f86-1b8e-4d5a-9f53-7d2b7c3c9e11"

const get = async (query = "", headers: Record<string, string> = {}) => {
  const { GET } = await import("@/app/api/media/search/route")
  return GET(
    new Request(`http://local.test/api/media/search${query}`, { headers })
  )
}

const page = { items: [], nextCursor: null }

describe("GET /api/media/search (B05-06)", () => {
  it("refuses a cross-origin request without asking the service", async () => {
    const res = await get("", { "sec-fetch-site": "cross-site" })
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({
      ok: false,
      code: "not_permitted",
      message: "Forbidden.",
    })
    expect(res.headers.get("cache-control")).toBe("private, no-store")
    expect(mocks.getMediaActor).not.toHaveBeenCalled()
    expect(mocks.searchAssets).not.toHaveBeenCalled()
  })

  it("answers a signed-out caller with signed_out", async () => {
    mocks.getMediaActor.mockResolvedValue({
      ok: false,
      status: 401,
      message: "Sign in to continue.",
    })
    const res = await get()
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({
      ok: false,
      code: "signed_out",
      message: "Sign in to continue.",
    })
    expect(res.headers.get("cache-control")).toBe("private, no-store")
    expect(mocks.searchAssets).not.toHaveBeenCalled()
  })

  it("passes 403 and 503 account answers through", async () => {
    mocks.getMediaActor.mockResolvedValueOnce({
      ok: false,
      status: 403,
      message: "Your account is not active.",
    })
    const refused = await get()
    expect(refused.status).toBe(403)
    expect((await refused.json()).code).toBe("not_permitted")
    mocks.getMediaActor.mockResolvedValueOnce({
      ok: false,
      status: 503,
      message: "Could not check your account right now. Try again in a moment.",
    })
    const down = await get()
    expect(down.status).toBe(503)
    expect((await down.json()).code).toBe("unavailable")
    expect(down.headers.get("retry-after")).toBe("5")
  })

  it("admits staff, managers and admins and lets the database decide", async () => {
    mocks.getMediaActor.mockResolvedValue({ ok: true, actor })
    mocks.searchAssets.mockResolvedValue({ ok: true, ...page })
    await get()
    expect(mocks.getMediaActor).toHaveBeenCalledWith(OWN_MEDIA_ROLES)
    expect(OWN_MEDIA_ROLES).toEqual(["staff", "manager", "admin"])
  })

  it("maps the query to the service input", async () => {
    mocks.getMediaActor.mockResolvedValue({ ok: true, actor })
    mocks.searchAssets.mockResolvedValue({ ok: true, ...page })
    await get(
      `?item=${UUID}&rights=in_force&destination=test_dest&menuState=&unknown=x` +
        `&submission=coverage:${UUID}&cursor=abc&limit=12`
    )
    expect(mocks.searchAssets).toHaveBeenLastCalledWith(actor, {
      filters: {
        item: UUID,
        rights: "in_force",
        destination: "test_dest",
        submission: { source: "coverage", id: UUID },
      },
      cursor: "abc",
      limit: 12,
    })

    await get("?submission=nonsense&limit=abc")
    expect(mocks.searchAssets).toHaveBeenLastCalledWith(actor, {
      filters: { submission: "nonsense" },
      cursor: null,
      limit: "abc",
    })

    await get()
    expect(mocks.searchAssets).toHaveBeenLastCalledWith(actor, {
      filters: {},
      cursor: null,
      limit: undefined,
    })
  })

  it("answers a page as { ok, page } privately", async () => {
    mocks.getMediaActor.mockResolvedValue({ ok: true, actor })
    const items = [{ id: UUID }]
    mocks.searchAssets.mockResolvedValue({
      ok: true,
      items,
      nextCursor: "next",
    })
    const res = await get()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      ok: true,
      page: { items, nextCursor: "next" },
    })
    expect(res.headers.get("cache-control")).toBe("private, no-store")
    expect(res.headers.get("retry-after")).toBeNull()
  })

  it.each([
    [400, "invalid_input", "Check the search filters.", { uploadedTo: "x" }],
    [403, "not_permitted", "You can search your own venue only.", undefined],
    [404, "not_found", "This venue could not be found.", undefined],
    [
      503,
      "unavailable",
      "Something went wrong. Try again in a moment.",
      undefined,
    ],
  ] as const)(
    "passes a %i service failure through with its code",
    async (status, code, message, fieldErrors) => {
      mocks.getMediaActor.mockResolvedValue({ ok: true, actor })
      mocks.searchAssets.mockResolvedValue({
        ok: false,
        status,
        code,
        message,
        ...(fieldErrors ? { fieldErrors } : {}),
      })
      const res = await get()
      expect(res.status).toBe(status)
      expect(await res.json()).toEqual({
        ok: false,
        code,
        message,
        ...(fieldErrors ? { fieldErrors } : {}),
      })
      expect(res.headers.get("cache-control")).toBe("private, no-store")
      expect(res.headers.get("retry-after")).toBe(status === 503 ? "5" : null)
    }
  )
})
