// Amenity evidence media routes and server actions: every request
// re-authorises, unknown and forbidden are the same 404, video playback is
// inline with no filename, and actions refresh pages only after a write.
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  getMediaActor: vi.fn(),
  signEvidence: vi.fn(),
  streamOriginal: vi.fn(),
  revalidatePath: vi.fn(),
}))

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }))
vi.mock("@/lib/server/media/context", () => ({
  getMediaActor: mocks.getMediaActor,
  ROLE_NOT_ALLOWED: { ok: false, status: 403, message: "Not allowed." },
}))
vi.mock("@/lib/server/coverage/evidence", () => ({
  signEvidence: mocks.signEvidence,
}))
vi.mock("@/lib/server/media/access", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  streamOriginal: mocks.streamOriginal,
}))
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }))

const ASSET = "55555555-5555-4555-8555-555555555555"
/** Staff, manager accounts and admins reach every amenity surface. */
const ROLES = ["staff", "manager", "admin"]
const CHECK = "33333333-3333-4333-8333-333333333333"

beforeEach(() => {
  for (const m of Object.values(mocks)) m.mockReset()
})

type Row = Record<string, unknown>

function actor(opts: {
  gate?: Row[] | { error: { message: string } }
  asset?: Row | null
  active?: boolean
}) {
  const rpc = vi.fn(async () =>
    Array.isArray(opts.gate) || opts.gate === undefined
      ? { data: opts.gate ?? [], error: null }
      : { data: null, error: opts.gate.error }
  )
  const maybeSingle = vi.fn(async () => ({
    data: opts.asset ?? null,
    error: null,
  }))
  const from = vi.fn(() => ({
    select: () => ({ eq: () => ({ maybeSingle }) }),
  }))
  return {
    value: {
      profile: { id: "u", active: opts.active ?? true, role: "staff" },
      db: { rpc },
      service: { from },
      storage: {},
    },
    rpc,
    from,
  }
}

const photoRoutes = {
  thumb: () => import("@/app/api/amenities/evidence/[assetId]/thumb/route"),
  preview: () => import("@/app/api/amenities/evidence/[assetId]/preview/route"),
}

const params = (assetId: string) => ({ params: Promise.resolve({ assetId }) })
const get = (which: string, range?: string) =>
  new Request(`http://local.test/api/amenities/evidence/${ASSET}/${which}`, {
    headers: range ? { range } : {},
  })

describe("amenity evidence photo routes", () => {
  it.each(["thumb", "preview"] as const)(
    "%s signs through the amenity gate and redirects",
    async (which) => {
      const route = await photoRoutes[which]()
      const a = actor({})
      mocks.getMediaActor.mockResolvedValue({ ok: true, actor: a.value })
      mocks.signEvidence.mockResolvedValue({
        ok: true,
        url: "https://storage.test/signed",
      })
      const res = await route.GET(get(which), params(ASSET))
      expect(res.status).toBe(302)
      expect(res.headers.get("location")).toBe("https://storage.test/signed")
      expect(res.headers.get("cache-control")).toBe("private, no-store")
      expect(mocks.getMediaActor).toHaveBeenCalledWith(ROLES)
      expect(mocks.signEvidence).toHaveBeenCalledWith(
        a.value,
        ASSET,
        which === "thumb" ? "thumbnail" : "preview",
        "amenity_evidence_asset"
      )
    }
  )

  it.each(["thumb", "preview"] as const)(
    "%s answers 404 for forbidden and 401 when signed out",
    async (which) => {
      const route = await photoRoutes[which]()
      mocks.getMediaActor.mockResolvedValue({
        ok: true,
        actor: actor({}).value,
      })
      mocks.signEvidence.mockResolvedValue({
        ok: false,
        status: 404,
        message: "Not found.",
      })
      const res = await route.GET(get(which), params(ASSET))
      expect(res.status).toBe(404)
      expect(await res.text()).toBe("Not found.")

      mocks.getMediaActor.mockResolvedValue({
        ok: false,
        status: 401,
        message: "Sign in.",
      })
      const out = await route.GET(get(which), params(ASSET))
      expect(out.status).toBe(401)
    }
  )
})

describe("amenity evidence video stream", () => {
  const video = {
    id: ASSET,
    uploader_id: "u2",
    media_type: "video",
    original_path: "u2/a/original.mp4",
    validated_mime_type: "video/mp4",
    size_bytes: 1234,
    upload_state: "ready",
    deleted_at: null,
  }

  async function stream(a: ReturnType<typeof actor>, assetId = ASSET) {
    const { GET } =
      await import("@/app/api/amenities/evidence/[assetId]/stream/route")
    mocks.getMediaActor.mockResolvedValue({ ok: true, actor: a.value })
    return GET(get("stream", "bytes=0-"), params(assetId))
  }

  it("is the same 404 for unknown, forbidden, photos and bad ids, without reading storage paths", async () => {
    for (const a of [
      actor({ gate: [] }),
      actor({
        gate: [
          {
            asset_id: ASSET,
            media_type: "image",
            has_thumbnail: true,
            has_preview: true,
          },
        ],
      }),
    ]) {
      const res = await stream(a)
      expect(res.status).toBe(404)
      expect(a.from).not.toHaveBeenCalled()
    }
    const bad = actor({ gate: [] })
    expect((await stream(bad, "not-a-uuid")).status).toBe(404)
    expect(bad.rpc).not.toHaveBeenCalled()
    const inactive = actor({ gate: [], active: false })
    expect((await stream(inactive)).status).toBe(404)
    expect(mocks.streamOriginal).not.toHaveBeenCalled()
  })

  it("answers 404 when the asset was deleted after the gate and 503 on a database error", async () => {
    const gate = [
      {
        asset_id: ASSET,
        media_type: "video",
        has_thumbnail: false,
        has_preview: false,
      },
    ]
    expect(
      (await stream(actor({ gate, asset: { ...video, deleted_at: "now" } })))
        .status
    ).toBe(404)
    const res = await stream(actor({ gate: { error: { message: "boom" } } }))
    expect(res.status).toBe(503)
    expect(res.headers.get("retry-after")).toBe("5")
  })

  it("streams an authorised video inline with no filename, re-checking on each request", async () => {
    mocks.streamOriginal.mockResolvedValue(
      new Response("bytes", { status: 206 })
    )
    const a = actor({
      gate: [
        {
          asset_id: ASSET,
          media_type: "video",
          has_thumbnail: false,
          has_preview: false,
        },
      ],
      asset: video,
    })
    expect((await stream(a)).status).toBe(206)
    expect((await stream(a)).status).toBe(206)
    expect(mocks.getMediaActor).toHaveBeenCalledWith(ROLES)
    expect(a.rpc).toHaveBeenCalledTimes(2)
    expect(a.rpc).toHaveBeenCalledWith("amenity_evidence_asset", {
      p_asset_id: ASSET,
    })
    expect(mocks.streamOriginal).toHaveBeenCalledWith(
      a.value,
      {
        id: ASSET,
        uploaderId: "u2",
        mediaType: "video",
        originalPath: "u2/a/original.mp4",
        previewPath: null,
        thumbnailPath: null,
        mimeType: "video/mp4",
        sizeBytes: 1234,
        originalFilename: null,
      },
      "bytes=0-"
    )
  })
})

describe("amenity server actions", () => {
  it("returns the auth failure without calling the database", async () => {
    const actions = await import("@/app/_amenities/actions")
    mocks.getMediaActor.mockResolvedValue({
      ok: false,
      status: 401,
      message: "Sign in.",
    })
    expect(
      await actions.archiveCheckAction({ checkId: CHECK, revision: 1 })
    ).toMatchObject({ ok: false, code: "unauthenticated", status: 401 })
    expect(mocks.getMediaActor).toHaveBeenCalledWith(ROLES)
    mocks.getMediaActor.mockResolvedValue({
      ok: false,
      status: 403,
      message: "Not allowed.",
    })
    expect(await actions.getCheckAction({ checkId: CHECK })).toMatchObject({
      code: "not_permitted",
      status: 403,
    })
    mocks.getMediaActor.mockResolvedValue({
      ok: false,
      status: 403,
      message: "Your account is not active.",
    })
    expect(await actions.getCheckAction({ checkId: CHECK })).toMatchObject({
      code: "account_inactive",
    })
    mocks.getMediaActor.mockResolvedValue({
      ok: false,
      status: 503,
      message: "Could not check your account right now.",
    })
    expect(await actions.getCheckAction({ checkId: CHECK })).toMatchObject({
      code: "unavailable",
      status: 503,
    })
    expect(mocks.revalidatePath).not.toHaveBeenCalled()
  })

  it("refreshes staff, manager and admin coverage pages only after a successful write", async () => {
    const actions = await import("@/app/_amenities/actions")
    const rpc = vi.fn(async (fn: string) =>
      fn === "amenity_archive_check"
        ? { data: 2, error: null }
        : {
            data: null,
            error: { message: "amenity_conflict", details: '{"revision":4}' },
          }
    )
    mocks.getMediaActor.mockResolvedValue({
      ok: true,
      actor: { profile: { id: "u", active: true }, db: { rpc } },
    })
    expect(
      await actions.archiveCheckAction({ checkId: CHECK, revision: 1 })
    ).toEqual({ ok: true, revision: 2 })
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/staff", "layout")
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/manager", "layout")
    expect(mocks.revalidatePath).toHaveBeenCalledWith(
      "/admin/coverage",
      "layout"
    )
    mocks.revalidatePath.mockReset()
    expect(
      await actions.restoreCheckAction({ checkId: CHECK, revision: 1 })
    ).toMatchObject({ code: "revision_conflict", currentRevision: 4 })
    expect(mocks.revalidatePath).not.toHaveBeenCalled()
    // Untrusted input is validated before any database call.
    rpc.mockClear()
    expect(await actions.getCheckAction("junk")).toMatchObject({
      code: "not_found",
    })
    expect(rpc).not.toHaveBeenCalled()
  })
})
