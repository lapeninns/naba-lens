import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  getMediaActor: vi.fn(),
  signEvidence: vi.fn(),
}))

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }))
vi.mock("@/lib/server/media/context", () => ({
  getMediaActor: mocks.getMediaActor,
}))
vi.mock("@/lib/server/coverage/evidence", () => ({
  signEvidence: mocks.signEvidence,
}))

beforeEach(() => {
  for (const m of Object.values(mocks)) m.mockReset()
})

const ctx = (assetId: string) => ({ params: Promise.resolve({ assetId }) })
const actor = { profile: { id: "u", active: true } }

describe("Our menu photo routes", () => {
  it("answers an unauthenticated caller privately without signing", async () => {
    const { GET } = await import("@/app/api/menu-photos/[assetId]/thumb/route")
    mocks.getMediaActor.mockResolvedValue({
      ok: false,
      status: 401,
      message: "Sign in to continue.",
    })
    const res = await GET(
      new Request("http://local.test"),
      ctx(crypto.randomUUID())
    )
    expect(res.status).toBe(401)
    expect(res.headers.get("cache-control")).toBe("private, no-store")
    expect(mocks.signEvidence).not.toHaveBeenCalled()
  })

  it("signs with the item-photo check and redirects privately", async () => {
    const thumb = await import("@/app/api/menu-photos/[assetId]/thumb/route")
    const preview =
      await import("@/app/api/menu-photos/[assetId]/preview/route")
    mocks.getMediaActor.mockResolvedValue({ ok: true, actor })
    mocks.signEvidence.mockResolvedValue({
      ok: true,
      url: "http://127.0.0.1/signed",
    })
    const id = crypto.randomUUID()
    for (const [route, which] of [
      [thumb, "thumbnail"],
      [preview, "preview"],
    ] as const) {
      const res = await route.GET(new Request("http://local.test"), ctx(id))
      expect(res.status).toBe(302)
      expect(res.headers.get("location")).toBe("http://127.0.0.1/signed")
      expect(res.headers.get("cache-control")).toBe("private, no-store")
      expect(res.headers.get("referrer-policy")).toBe("no-referrer")
      expect(mocks.signEvidence).toHaveBeenLastCalledWith(
        actor,
        id,
        which,
        "menu_item_photo_asset"
      )
    }
  })

  it("passes a not-found answer through unchanged", async () => {
    const { GET } =
      await import("@/app/api/menu-photos/[assetId]/preview/route")
    mocks.getMediaActor.mockResolvedValue({ ok: true, actor })
    mocks.signEvidence.mockResolvedValue({
      ok: false,
      status: 404,
      message: "Not found.",
    })
    const res = await GET(new Request("http://local.test"), ctx("nope"))
    expect(res.status).toBe(404)
    expect(res.headers.get("cache-control")).toBe("private, no-store")
  })
})

describe("Our menu photo routes for manager accounts", () => {
  const routes = async () =>
    [
      [
        await import("@/app/api/menu-photos/[assetId]/thumb/route"),
        "thumbnail",
      ],
      [
        await import("@/app/api/menu-photos/[assetId]/preview/route"),
        "preview",
      ],
    ] as const

  it("manager actor is admitted by thumb and preview", async () => {
    mocks.getMediaActor.mockResolvedValue({ ok: true, actor })
    mocks.signEvidence.mockResolvedValue({ ok: true, url: "http://x/s" })
    for (const [route] of await routes()) {
      const res = await route.GET(
        new Request("http://local.test"),
        ctx(crypto.randomUUID())
      )
      expect(res.status).toBe(302)
    }
    for (const call of mocks.getMediaActor.mock.calls)
      expect(call[0]).toEqual(["staff", "manager", "admin"])
  })

  it("staff and admin still admitted", async () => {
    const roles = mocks.getMediaActor.mock
    mocks.getMediaActor.mockResolvedValue({ ok: true, actor })
    mocks.signEvidence.mockResolvedValue({ ok: true, url: "http://x/s" })
    for (const [route] of await routes())
      await route.GET(new Request("http://local.test"), ctx("a"))
    for (const call of roles.calls) {
      expect(call[0]).toContain("staff")
      expect(call[0]).toContain("admin")
    }
  })

  it("RPC zero rows → 404", async () => {
    mocks.getMediaActor.mockResolvedValue({ ok: true, actor })
    const { signEvidence } = await vi.importActual<
      typeof import("@/lib/server/coverage/evidence")
    >("@/lib/server/coverage/evidence")
    mocks.signEvidence.mockImplementation((a, id, which, check) =>
      signEvidence(
        {
          profile: { active: true },
          db: { rpc: vi.fn().mockResolvedValue({ data: [], error: null }) },
          service: { from: vi.fn() },
        } as never,
        id,
        which,
        check
      )
    )
    for (const [route] of await routes()) {
      const res = await route.GET(
        new Request("http://local.test"),
        ctx(crypto.randomUUID())
      )
      expect(res.status).toBe(404)
      expect(res.headers.get("cache-control")).toBe("private, no-store")
    }
  })
})

describe("signEvidence with the item-photo check", () => {
  it("runs the named check and signs nothing when it finds nothing", async () => {
    const { signEvidence } = await vi.importActual<
      typeof import("@/lib/server/coverage/evidence")
    >("@/lib/server/coverage/evidence")
    const rpc = vi.fn().mockResolvedValue({ data: [], error: null })
    const serviceFrom = vi.fn()
    const result = await signEvidence(
      {
        profile: { active: true },
        db: { rpc },
        service: { from: serviceFrom },
      } as never,
      crypto.randomUUID(),
      "preview",
      "menu_item_photo_asset"
    )
    expect(result).toMatchObject({ ok: false, status: 404 })
    expect(rpc).toHaveBeenCalledWith("menu_item_photo_asset", {
      p_asset_id: expect.any(String),
    })
    expect(serviceFrom).not.toHaveBeenCalled()
  })
})
