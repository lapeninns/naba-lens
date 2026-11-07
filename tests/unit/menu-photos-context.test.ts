import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({ getMediaActor: vi.fn() }))

vi.mock("server-only", () => ({}))
vi.mock("@/lib/server/media/context", () => ({
  getMediaActor: mocks.getMediaActor,
  ROLE_NOT_ALLOWED: { ok: false, status: 403, message: "Not allowed." },
}))

const { getManagerPhotoCtx } = await import("@/lib/server/menu-photos/context")

const VENUE = "0a6f3c2e-6a51-4f43-9a6a-2f1f8d1c0a01"
const OTHER = "0a6f3c2e-6a51-4f43-9a6a-2f1f8d1c0a02"

function actor(role: string, scope: Record<string, unknown> | null = null) {
  const rpc = vi.fn().mockResolvedValue({
    data: scope ? [scope] : [],
    error: null,
  })
  return {
    actor: { profile: { id: "u1", role, active: true }, db: { rpc } },
    rpc,
  }
}

const effective = { effective: true, venue_id: VENUE }

beforeEach(() => mocks.getMediaActor.mockReset())

describe("getManagerPhotoCtx", () => {
  it("admits only manager and admin accounts", async () => {
    mocks.getMediaActor.mockResolvedValue({
      ok: false,
      status: 403,
      message: "Not allowed.",
    })
    expect(await getManagerPhotoCtx()).toMatchObject({
      ok: false,
      code: "not_permitted",
    })
    expect(mocks.getMediaActor).toHaveBeenCalledWith(["manager", "admin"])
  })

  it("staff → not_permitted", async () => {
    const { actor: a, rpc } = actor("staff", effective)
    mocks.getMediaActor.mockResolvedValue({ ok: true, actor: a })
    expect(await getManagerPhotoCtx()).toMatchObject({
      ok: false,
      code: "not_permitted",
    })
    expect(rpc).not.toHaveBeenCalled()
  })

  it("manager without effective scope → not_permitted", async () => {
    for (const scope of [
      null,
      { effective: false, venue_id: VENUE },
      { effective: true, venue_id: null },
    ]) {
      const { actor: a } = actor("manager", scope)
      mocks.getMediaActor.mockResolvedValue({ ok: true, actor: a })
      expect(await getManagerPhotoCtx(), JSON.stringify(scope)).toMatchObject({
        ok: false,
        code: "not_permitted",
      })
    }
  })

  it("manager with effective scope gets the scope's venue", async () => {
    const { actor: a, rpc } = actor("manager", effective)
    mocks.getMediaActor.mockResolvedValue({ ok: true, actor: a })
    expect(await getManagerPhotoCtx()).toMatchObject({
      ok: true,
      ctx: { venueId: VENUE, role: "manager" },
    })
    expect(await getManagerPhotoCtx(VENUE)).toMatchObject({ ok: true })
    expect(rpc).toHaveBeenCalledWith("manager_workspace_scope")
  })

  it("manager with other venueId → wrong_venue", async () => {
    const { actor: a } = actor("manager", effective)
    mocks.getMediaActor.mockResolvedValue({ ok: true, actor: a })
    expect(await getManagerPhotoCtx(OTHER)).toMatchObject({
      ok: false,
      code: "wrong_venue",
    })
  })

  it("admin without venueId → invalid_input", async () => {
    const { actor: a, rpc } = actor("admin")
    mocks.getMediaActor.mockResolvedValue({ ok: true, actor: a })
    expect(await getManagerPhotoCtx()).toMatchObject({
      ok: false,
      code: "invalid_input",
    })
    expect(await getManagerPhotoCtx("nope")).toMatchObject({
      ok: false,
      code: "invalid_input",
    })
    expect(await getManagerPhotoCtx(OTHER)).toMatchObject({
      ok: true,
      ctx: { venueId: OTHER, role: "admin" },
    })
    expect(rpc).not.toHaveBeenCalled()
  })

  it("a scope read failure is unavailable, never access", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {})
    const rpc = vi
      .fn()
      .mockResolvedValue({ data: null, error: { message: "boom", code: "X" } })
    mocks.getMediaActor.mockResolvedValue({
      ok: true,
      actor: { profile: { role: "manager", active: true }, db: { rpc } },
    })
    expect(await getManagerPhotoCtx()).toMatchObject({
      ok: false,
      code: "unavailable",
    })
    log.mockRestore()
  })

  it("signed out and inactive keep their codes", async () => {
    mocks.getMediaActor.mockResolvedValue({
      ok: false,
      status: 401,
      message: "Sign in to continue.",
    })
    expect(await getManagerPhotoCtx()).toMatchObject({
      code: "unauthenticated",
    })
    mocks.getMediaActor.mockResolvedValue({
      ok: false,
      status: 403,
      message: "Your account is not active.",
    })
    expect(await getManagerPhotoCtx()).toMatchObject({
      code: "account_inactive",
    })
  })
})
