import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  run: vi.fn(),
  getMediaActor: vi.fn(),
  signEvidence: vi.fn(),
  revalidatePath: vi.fn(),
  getCoverageActor: vi.fn(),
  submitPhotos: vi.fn(),
  listMySubmittablePhotos: vi.fn(),
  grantVenueManager: vi.fn(),
}))

vi.mock("@/lib/server/coverage/preparation", () => ({
  runScheduledPreparation: mocks.run,
}))
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }))
vi.mock("@/lib/server/media/context", () => ({
  getMediaActor: mocks.getMediaActor,
}))
vi.mock("@/lib/server/coverage/evidence", () => ({
  signEvidence: mocks.signEvidence,
}))
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }))
vi.mock("@/lib/server/coverage", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getCoverageActor: mocks.getCoverageActor,
  submitPhotos: mocks.submitPhotos,
  listMySubmittablePhotos: mocks.listMySubmittablePhotos,
  grantVenueManager: mocks.grantVenueManager,
}))

const SECRET = "s".repeat(40)

beforeEach(() => {
  for (const m of Object.values(mocks)) m.mockReset()
})
afterEach(() => vi.unstubAllEnvs())

function cron(method: "GET" | "POST", token?: string) {
  return new Request(
    "http://local.test/api/internal/coverage/monthly-preparation",
    {
      method,
      headers: token ? { authorization: `Bearer ${token}` } : {},
    }
  )
}

const RUN = {
  id: crypto.randomUUID(),
  period: "2026-11",
  venueId: null,
  trigger: "scheduled",
  startedAt: "2026-11-02T07:00:00Z",
  finishedAt: "2026-11-02T07:00:01Z",
  status: "succeeded",
  staffConsidered: 5,
  targetsCopied: 2,
  placeholdersCreated: 3,
  alreadyPresent: 0,
  candidatesAdded: 12,
  errorCode: null,
}

describe("scheduled monthly preparation route", () => {
  it("is unavailable without a configured secret of at least 32 characters", async () => {
    const { GET } =
      await import("@/app/api/internal/coverage/monthly-preparation/route")
    vi.stubEnv("CLEANUP_SECRET", "")
    let res = await GET(cron("GET", SECRET))
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ error: "not_configured" })
    vi.stubEnv("CLEANUP_SECRET", "s".repeat(31))
    res = await GET(cron("GET", "s".repeat(31)))
    expect(res.status).toBe(503)
    expect(mocks.run).not.toHaveBeenCalled()
  })

  it("refuses a missing or wrong bearer token", async () => {
    const { GET, POST } =
      await import("@/app/api/internal/coverage/monthly-preparation/route")
    vi.stubEnv("CLEANUP_SECRET", SECRET)
    for (const res of [
      await GET(cron("GET")),
      await GET(cron("GET", `${SECRET}x`)),
      await POST(cron("POST", "wrong")),
    ]) {
      expect(res.status).toBe(401)
      expect(res.headers.get("cache-control")).toBe("private, no-store")
    }
    expect(mocks.run).not.toHaveBeenCalled()
  })

  it("runs once per call and returns counts only, uncached", async () => {
    const { GET, POST } =
      await import("@/app/api/internal/coverage/monthly-preparation/route")
    vi.stubEnv("CLEANUP_SECRET", SECRET)
    mocks.run.mockResolvedValue({ ok: true, failed: false, runs: [RUN] })
    for (const res of [
      await GET(cron("GET", SECRET)),
      await POST(cron("POST", SECRET)),
    ]) {
      expect(res.status).toBe(200)
      expect(res.headers.get("cache-control")).toBe("private, no-store")
      const body = await res.json()
      expect(body).toEqual({
        status: "succeeded",
        runs: [
          {
            period: "2026-11",
            status: "succeeded",
            staffConsidered: 5,
            targetsCopied: 2,
            placeholdersCreated: 3,
            alreadyPresent: 0,
            candidatesAdded: 12,
            errorCode: null,
          },
        ],
      })
      expect(JSON.stringify(body)).not.toContain(RUN.id)
    }
    expect(mocks.run).toHaveBeenCalledTimes(2)
  })

  it("reports a failed run or call as 500 without database text", async () => {
    const { GET } =
      await import("@/app/api/internal/coverage/monthly-preparation/route")
    vi.stubEnv("CLEANUP_SECRET", SECRET)
    const log = vi.spyOn(console, "error").mockImplementation(() => {})
    mocks.run.mockResolvedValueOnce({
      ok: true,
      failed: true,
      runs: [{ ...RUN, status: "failed", errorCode: "23505" }],
    })
    let res = await GET(cron("GET", SECRET))
    expect(res.status).toBe(500)
    expect((await res.json()).status).toBe("failed")
    mocks.run.mockResolvedValueOnce({ ok: false })
    res = await GET(cron("GET", SECRET))
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: "preparation_failed" })
    mocks.run.mockRejectedValueOnce(new Error("secret connection string"))
    res = await GET(cron("GET", SECRET))
    expect(res.status).toBe(500)
    expect(JSON.stringify(log.mock.calls)).not.toContain(
      "secret connection string"
    )
    log.mockRestore()
  })
})

describe("task evidence routes", () => {
  const ctx = (assetId: string) => ({ params: Promise.resolve({ assetId }) })
  const actor = { profile: { id: "u", active: true } }

  it("answers an unauthenticated caller privately without signing", async () => {
    const { GET } =
      await import("@/app/api/coverage/evidence/[assetId]/thumb/route")
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

  it("redirects to the signed derivative with private, no-store headers", async () => {
    const thumb =
      await import("@/app/api/coverage/evidence/[assetId]/thumb/route")
    const preview =
      await import("@/app/api/coverage/evidence/[assetId]/preview/route")
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
      expect(res.headers.get("x-content-type-options")).toBe("nosniff")
      expect(mocks.signEvidence).toHaveBeenLastCalledWith(actor, id, which)
    }
  })

  it("passes a not-found answer through unchanged", async () => {
    const { GET } =
      await import("@/app/api/coverage/evidence/[assetId]/preview/route")
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

describe("signEvidence authorises before any service-role step", () => {
  function fakeActor(rows: unknown[] | null, rpcError: unknown = null) {
    const signed = vi.fn().mockResolvedValue({
      data: { signedUrl: "http://127.0.0.1/s" },
      error: null,
    })
    const serviceFrom = vi.fn(() => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: {
              thumbnail_path: "u/a/thumb.webp",
              preview_path: "u/a/preview.webp",
              upload_state: "ready",
              deleted_at: null,
            },
            error: null,
          }),
        }),
      }),
    }))
    const actor = {
      profile: { id: "u", active: true },
      db: { rpc: vi.fn().mockResolvedValue({ data: rows, error: rpcError }) },
      service: {
        from: serviceFrom,
        storage: { from: () => ({ createSignedUrl: signed }) },
      },
    }
    return { actor, signed, serviceFrom }
  }
  const row = {
    asset_id: "a",
    venue_id: "v",
    uploader_id: "u",
    media_type: "image",
    validated_mime_type: "image/jpeg",
    has_preview: true,
    has_thumbnail: true,
    width: 1,
    height: 1,
  }

  it("never touches the service role when the caller-scoped check finds nothing", async () => {
    const { signEvidence } = await vi.importActual<
      typeof import("@/lib/server/coverage/evidence")
    >("@/lib/server/coverage/evidence")
    const id = crypto.randomUUID()
    for (const rows of [
      [],
      [{ ...row, media_type: "video" }],
      [{ ...row, has_thumbnail: false }],
    ]) {
      const { actor, serviceFrom, signed } = fakeActor(rows)
      const result = await signEvidence(actor as never, id, "thumbnail")
      expect(result).toMatchObject({ ok: false, status: 404 })
      expect(actor.db.rpc).toHaveBeenCalledWith("task_evidence_asset", {
        p_asset_id: id,
      })
      expect(serviceFrom).not.toHaveBeenCalled()
      expect(signed).not.toHaveBeenCalled()
    }
    const bad = fakeActor([row])
    expect(
      await signEvidence(bad.actor as never, "not-a-uuid", "preview")
    ).toMatchObject({ status: 404 })
    expect(bad.actor.db.rpc).not.toHaveBeenCalled()
    const down = fakeActor(null, { message: "x", code: "XX000" })
    expect(
      await signEvidence(down.actor as never, id, "preview")
    ).toMatchObject({ status: 503 })
  })

  it("signs only the requested derivative for at most 60 seconds", async () => {
    const { signEvidence } = await vi.importActual<
      typeof import("@/lib/server/coverage/evidence")
    >("@/lib/server/coverage/evidence")
    const { actor, signed } = fakeActor([row])
    expect(
      await signEvidence(actor as never, crypto.randomUUID(), "preview")
    ).toEqual({
      ok: true,
      url: "http://127.0.0.1/s",
    })
    const [path, ttl] = signed.mock.calls[0]!
    expect(path).toBe("u/a/preview.webp")
    expect(ttl).toBeGreaterThan(0)
    expect(ttl).toBeLessThanOrEqual(60)
  })
})

describe("coverage server actions", () => {
  const actor = { profile: { id: "u" } }

  it("returns the auth failure and calls no service", async () => {
    const { submitPhotosAction } = await import("@/app/_coverage/actions")
    mocks.getCoverageActor.mockResolvedValue({
      ok: false,
      code: "unauthenticated",
      status: 401,
      message: "Sign in to continue.",
    })
    expect(await submitPhotosAction({})).toMatchObject({
      code: "unauthenticated",
    })
    expect(mocks.submitPhotos).not.toHaveBeenCalled()
    expect(mocks.revalidatePath).not.toHaveBeenCalled()
  })

  it("passes input through unchanged and refreshes coverage pages only after a successful write", async () => {
    const {
      submitPhotosAction,
      loadSubmittablePhotosAction,
      grantVenueManagerAction,
    } = await import("@/app/_coverage/actions")
    mocks.getCoverageActor.mockResolvedValue({ ok: true, actor })
    const input = { requestId: "r", requirementId: null, assetIds: [] }

    mocks.submitPhotos.mockResolvedValueOnce({
      ok: false,
      code: "invalid_input",
      status: 400,
      message: "x",
    })
    await submitPhotosAction(input)
    expect(mocks.submitPhotos).toHaveBeenLastCalledWith(actor, input)
    expect(mocks.revalidatePath).not.toHaveBeenCalled()

    mocks.submitPhotos.mockResolvedValueOnce({
      ok: true,
      submitted: [],
      skipped: [],
      replayed: false,
    })
    expect(await submitPhotosAction(input)).toMatchObject({ ok: true })
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/staff", "layout")
    expect(mocks.revalidatePath).toHaveBeenCalledWith(
      "/admin/coverage",
      "layout"
    )

    mocks.revalidatePath.mockReset()
    mocks.listMySubmittablePhotos.mockResolvedValueOnce({
      ok: true,
      items: [],
      nextCursor: null,
    })
    await loadSubmittablePhotosAction({ requirementId: null })
    expect(mocks.revalidatePath).not.toHaveBeenCalled()

    mocks.grantVenueManager.mockResolvedValueOnce({ ok: true, grantId: "g" })
    await grantVenueManagerAction({ staffId: "s", venueId: "v" })
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/admin/staff", "layout")
  })
})
