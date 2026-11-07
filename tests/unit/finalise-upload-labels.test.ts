import { beforeEach, describe, expect, it, vi } from "vitest"

import { EMPTY_LABEL_SUMMARY } from "@/lib/menus/types"

// finaliseUpload (the browser's finalise) hands on what finalise did with
// labels stored while the file was uploading (C2), so the sheet can show
// "Saved" without asking the attention list.
const mocks = vi.hoisted(() => ({
  getMediaActor: vi.fn(),
  finaliseAsset: vi.fn(),
}))

vi.mock("server-only", () => ({}))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
vi.mock("@/lib/server/media/context", () => ({
  getMediaActor: mocks.getMediaActor,
}))
vi.mock("@/lib/server/media/finalise", () => ({
  finaliseAsset: mocks.finaliseAsset,
}))
vi.mock("@/lib/server/media/library", () => ({ listOwnMedia: vi.fn() }))
vi.mock("@/lib/server/media/reserve", () => ({ reserveAsset: vi.fn() }))
vi.mock("@/lib/server/accounts/work-profile", () => ({
  saveWorkProfile: vi.fn(),
  setWelcomeDismissed: vi.fn(),
  skipWorkProfile: vi.fn(),
}))

const { finaliseUpload } = await import("@/app/staff/actions")

const INPUT = {
  assetId: "0a6f3c2e-6a51-4f43-9a6a-2f1f8d1c0a01",
  idempotencyKey: "key-1",
}
const SAVED = {
  state: "saved" as const,
  labels: { ...EMPTY_LABEL_SUMMARY, revision: 1, hasLabels: true },
}

beforeEach(() => {
  mocks.getMediaActor.mockResolvedValue({ ok: true, actor: {} })
  mocks.finaliseAsset.mockReset()
})

describe("finaliseUpload labels", () => {
  it("passes labels finalise applied through to the browser", async () => {
    mocks.finaliseAsset.mockResolvedValue({
      ok: true,
      state: "ready",
      labels: SAVED,
    })
    await expect(finaliseUpload(INPUT)).resolves.toEqual({
      ok: true,
      result: { state: "ready", labels: SAVED },
    })
  })

  it("passes a needs-attention answer through as it came", async () => {
    const attention = {
      state: "needs_attention" as const,
      code: "catalogue_changed" as const,
      message: "The menu changed.",
    }
    mocks.finaliseAsset.mockResolvedValue({
      ok: true,
      state: "ready",
      labels: attention,
    })
    await expect(finaliseUpload(INPUT)).resolves.toEqual({
      ok: true,
      result: { state: "ready", labels: attention },
    })
  })

  it("has no labels field when nothing was stored", async () => {
    mocks.finaliseAsset.mockResolvedValue({ ok: true, state: "ready" })
    const result = await finaliseUpload(INPUT)
    expect(result).toEqual({ ok: true, result: { state: "ready" } })
    expect(result.ok && "labels" in result.result).toBe(false)
  })

  it("keeps a failure as it was", async () => {
    mocks.finaliseAsset.mockResolvedValue({
      ok: true,
      state: "failed",
      error: "Not a photo.",
    })
    await expect(finaliseUpload(INPUT)).resolves.toEqual({
      ok: true,
      result: { state: "failed", error: "Not a photo." },
    })
  })
})
