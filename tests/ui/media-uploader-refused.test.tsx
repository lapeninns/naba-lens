// @vitest-environment jsdom
// useMediaUploader turns finaliseUpload's 403 into a refusal the queue won't
// retry; its 503 stays retryable.
import { cleanup, renderHook } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { UploadContext } from "@/components/nabalens/upload-queue"

const actions = vi.hoisted(() => ({
  reserveUpload: vi.fn(),
  finaliseUpload: vi.fn(),
}))
vi.mock("@/app/staff/actions", () => actions)
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
        data: { session: { user: { id: "user-1" }, access_token: "jwt" } },
      }),
    },
  }),
}))

import { useMediaUploader } from "@/app/_media/use-media-uploader"

const ENDED =
  "Your venue manager access has ended, so this upload can't be finished."
const UNCHECKED = "Could not check this file right now. Try again."

const photo = () =>
  new File([new Uint8Array(64)], "dish.jpg", { type: "image/jpeg" })

function context(): UploadContext {
  return {
    signal: new AbortController().signal,
    onProgress: () => {},
    onProcessing: () => {},
    resumeToken: undefined,
    setResumeToken: () => {},
    attempt: 1,
  }
}

// Unmount each hook's tree: vitest globals are off, so RTL won't do it.
afterEach(cleanup)

beforeEach(() => {
  localStorage.clear()
  actions.reserveUpload.mockResolvedValue({
    ok: true,
    reservation: {
      assetId: "asset-1",
      objectKey: "u/asset-1/original.jpg",
      bucket: "media",
      resumable: false,
      state: "processing",
    },
  })
})

async function failureOf(status: number, message: string) {
  actions.finaliseUpload.mockResolvedValue({ ok: false, status, message })
  const { result } = renderHook(() => useMediaUploader())
  return result.current(photo(), context()).then(
    () => null,
    (error: { error?: unknown }) => error.error
  )
}

describe("finaliseUpload's refusal reaches the queue", () => {
  it("403: not retryable, the server's message", async () => {
    expect(await failureOf(403, ENDED)).toEqual({
      code: "finalise_refused",
      message: ENDED,
      retryable: false,
    })
  })

  it("503: retryable, as today", async () => {
    expect(await failureOf(503, UNCHECKED)).toEqual({
      code: "finalise_failed",
      message: UNCHECKED,
      retryable: true,
    })
  })
})
