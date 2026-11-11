// @vitest-environment jsdom
// The task and amenity screens upload through useMediaUploader without naming
// the account: their resume keys are still kept for the signed-in person
// only, as Add's are (audit finding 15), so another account signed in on the
// same phone never resumes them.
import { renderHook } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import type { UploadContext } from "@/components/nabalens/upload-queue"
import type { UploadKeyStore } from "@/lib/upload"

const mocks = vi.hoisted(() => ({
  userId: "user-1" as string | null,
  keys: null as UploadKeyStore | null,
}))

vi.mock("@/app/staff/actions", () => ({
  reserveUpload: vi.fn(),
  finaliseUpload: vi.fn(),
}))
vi.mock("@/lib/supabase/env", () => ({
  getSupabasePublicEnv: () => ({
    url: "http://127.0.0.1:1",
    publishableKey: "x",
  }),
}))
vi.mock("@/lib/supabase/browser", () => ({
  createClient: () => ({
    auth: {
      getSession: async () => ({
        data: {
          session: mocks.userId
            ? { user: { id: mocks.userId }, access_token: "jwt" }
            : null,
        },
      }),
    },
  }),
}))
vi.mock("@/lib/upload", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/upload")>()),
  // The bytes are already stored: straight to ready.
  createUploader: () =>
    Object.assign(async () => ({ assetId: "asset-1", state: "ready" }), {
      activeCount: () => 0,
      stoppableCount: () => 0,
    }),
  localUploadKeyStore: () => mocks.keys,
}))

const { useMediaUploader } = await import("@/app/_media/use-media-uploader")

function context(overrides: Partial<UploadContext> = {}): UploadContext {
  return {
    signal: new AbortController().signal,
    onProgress: () => {},
    onProcessing: () => {},
    resumeToken: undefined,
    setResumeToken: () => {},
    attempt: 1,
    ...overrides,
  }
}

const photo = () =>
  new File([new Uint8Array(8)], "a.jpg", { type: "image/jpeg" })

beforeEach(() => {
  mocks.userId = "user-1"
  mocks.keys = {
    get: vi.fn(async () => null),
    set: vi.fn(async () => {}),
    delete: vi.fn(async () => {}),
  }
})

describe("useMediaUploader resume keys", () => {
  it("are kept for the signed-in account when the caller does not say", async () => {
    const { result } = renderHook(() => useMediaUploader())
    await result.current(photo(), context({ purpose: "amenity" }))
    const scope = { purpose: "amenity", account: "user-1" }
    expect(mocks.keys!.get).toHaveBeenCalledWith(expect.any(File), scope)
    expect(mocks.keys!.set).toHaveBeenCalledWith(
      expect.any(File),
      expect.any(String),
      scope
    )
  })

  it("follow the account the caller names", async () => {
    const { result } = renderHook(() => useMediaUploader())
    await result.current(photo(), context({ account: "user-9" }))
    expect(mocks.keys!.get).toHaveBeenCalledWith(expect.any(File), {
      purpose: undefined,
      account: "user-9",
    })
  })

  it("are unscoped while nobody is signed in", async () => {
    mocks.userId = null
    const { result } = renderHook(() => useMediaUploader())
    await result.current(photo(), context())
    expect(mocks.keys!.get).toHaveBeenCalledWith(expect.any(File), {
      purpose: undefined,
      account: undefined,
    })
  })
})
