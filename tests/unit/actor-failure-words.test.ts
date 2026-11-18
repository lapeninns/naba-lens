import { beforeEach, describe, expect, it, vi } from "vitest"

// S3-R6, review V6: a failed account check is reported in its own words.
// Only a signed-out caller is told to sign in again; the second sign-in step
// (MFA), an inactive account and a failed profile read (retry) keep theirs.
vi.mock("server-only", () => ({}))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
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
const service = vi.hoisted(() => ({ called: 0 }))
vi.mock("@/lib/server/library/service", () => {
  const never = async () => {
    service.called++
    return { ok: true, data: {} }
  }
  return {
    correctAssetVenue: never,
    restoreAsset: never,
    saveCollection: never,
    saveTag: never,
    setCollectionItems: never,
    tagAssets: never,
    withdrawAsset: never,
  }
})
vi.mock("@/lib/server/exports/service", () => {
  const never = async () => {
    service.called++
    return { ok: true }
  }
  return {
    createExportPackage: never,
    rebuildExportPackage: never,
    recordPublication: never,
    saveDestination: never,
    setExportProfile: never,
  }
})

vi.mock("@/lib/server/requests", () => {
  const never = async () => {
    service.called++
    return { ok: true }
  }
  return {
    cancelShotList: never,
    closeRequest: never,
    createRequest: never,
    createShotList: never,
    editRequest: never,
    setRequestBlocked: never,
  }
})
vi.mock("@/lib/server/album", () => {
  const never = async () => {
    service.called++
    return { ok: true, changed: false }
  }
  return { setAlbumBrief: never, setAlbumPlace: never }
})

const { actorFailureMessage, getMediaActor, MFA_REQUIRED, SIGN_IN_AGAIN } =
  await import("@/lib/server/media/context")
const library = await import("@/app/admin/library/actions")
const publishing = await import("@/app/admin/publishing/actions")
const requests = await import("@/app/manager/requests/actions")
const album = await import("@/app/manager/album/actions")

const CASES = [
  { state: { status: "signed_out" }, words: SIGN_IN_AGAIN },
  {
    state: { status: "mfa_required", requirement: "verify" },
    words: MFA_REQUIRED.message,
  },
  { state: { status: "inactive" }, words: "Your account is not active." },
  {
    state: new Error("db down"),
    words: "Could not check your account right now. Try again in a moment.",
  },
] as const

function arrange(state: (typeof CASES)[number]["state"]) {
  if (state instanceof Error) getAuthState.mockRejectedValue(state)
  else getAuthState.mockResolvedValue(state)
}

describe("actorFailureMessage", () => {
  beforeEach(() => {
    getAuthState.mockReset()
    service.called = 0
    vi.spyOn(console, "error").mockImplementation(() => {})
  })

  it("keeps each failure's own words; only signed out says sign in again", async () => {
    for (const c of CASES) {
      arrange(c.state)
      const auth = await getMediaActor("admin")
      if (auth.ok) throw new Error("expected a failure")
      expect(actorFailureMessage(auth), JSON.stringify(c.state)).toBe(c.words)
    }
  })

  it("admin Library actions report the same words and do nothing", async () => {
    for (const c of CASES) {
      arrange(c.state)
      expect(
        await library.restoreAssetAction({ assetId: "a", reason: "r" })
      ).toEqual({ ok: false, error: c.words })
      expect(
        await library.withdrawAssetAction({ assetId: "a", reason: "r" })
      ).toEqual({ ok: false, error: c.words })
    }
    expect(service.called).toBe(0)
  })

  it("Publishing actions report the same words and do nothing", async () => {
    for (const c of CASES) {
      arrange(c.state)
      expect(
        await publishing.rebuildPackageAction({
          requestKey: "k",
          packageId: "p",
        })
      ).toEqual({ ok: false, message: c.words })
    }
    expect(service.called).toBe(0)
  })

  // S3-R11: the manager files the first pass left out (review V6).
  it("manager Requests and Album actions report the same words and do nothing", async () => {
    for (const c of CASES) {
      arrange(c.state)
      const failed = { ok: false, error: c.words }
      expect(await requests.createRequestAction({ type: "dish" })).toEqual(
        failed
      )
      const target = { requestId: "r", revision: 1 }
      expect(
        await requests.editRequestAction({ ...target, patch: {} })
      ).toEqual(failed)
      expect(
        await requests.setRequestBlockedAction({ ...target, reason: "x" })
      ).toEqual(failed)
      expect(
        await requests.closeRequestAction({
          ...target,
          state: "done",
          reason: "x",
        })
      ).toEqual(failed)
      expect(await requests.createShotListAction({})).toEqual(failed)
      expect(
        await requests.cancelShotListAction({
          shotListId: "s",
          revision: 1,
          reason: "x",
        })
      ).toEqual(failed)
      expect(
        await album.setAlbumPlaceAction({
          source: "menu_section",
          key: "k",
          subjectId: "s",
        })
      ).toEqual({ ok: false, message: c.words })
      expect(
        await album.setAlbumBriefAction({
          source: "menu_item",
          key: "k",
          brief: "b",
        })
      ).toEqual({ ok: false, message: c.words })
    }
    expect(service.called).toBe(0)
  })
})
