// POST /api/upload-labels: a refusal before the labels are read still names
// the asset (so the sheet and Me's Fix match it to the file), and an account
// that may not label (403) is "forbidden", never a Retry that cannot work.
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  getMediaActor: vi.fn(),
  stageAssetLabels: vi.fn(),
}))
vi.mock("@/lib/server/media/context", () => ({
  getMediaActor: mocks.getMediaActor,
}))
vi.mock("@/lib/server/labels", () => ({
  discardPendingLabels: vi.fn(),
  getLabellingCatalogue: vi.fn(),
  listPendingLabels: vi.fn(),
  stageAssetLabels: mocks.stageAssetLabels,
}))

import { POST } from "@/app/api/upload-labels/route"

const ASSET = "6f1a1c3e-2b4d-4e8f-9a1b-2c3d4e5f6a7b"
const VENUE = "0b9e8d7c-6b5a-4f3e-8d2c-1b0a9f8e7d6c"

function post(input: unknown, contentType = "application/json") {
  return POST(
    new Request("http://x/api/upload-labels", {
      method: "POST",
      headers: { "content-type": contentType },
      body: JSON.stringify({ venueId: VENUE, input }),
    })
  )
}
const draft = { assetId: ASSET, expectedRevision: 0, items: [] }

beforeEach(() => {
  vi.clearAllMocks()
})

describe("POST /api/upload-labels refusals", () => {
  it("403 (may not label) is forbidden with its message and the asset", async () => {
    mocks.getMediaActor.mockResolvedValue({
      ok: false,
      status: 403,
      message: "Your account is not active.",
    })
    const response = await post(draft)
    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({
      ok: false,
      assetId: ASSET,
      code: "forbidden",
      message: "Your account is not active.",
    })
    expect(mocks.stageAssetLabels).not.toHaveBeenCalled()
  })

  it.each([401, 503])(
    "%i stays unavailable (worth retrying), naming the asset",
    async (status) => {
      mocks.getMediaActor.mockResolvedValue({
        ok: false,
        status,
        message: "Not now.",
      })
      const response = await post(draft)
      expect(response.status).toBe(status)
      expect(await response.json()).toMatchObject({
        assetId: ASSET,
        code: "unavailable",
      })
    }
  )

  it("an invalid draft names its asset when the id is a UUID, else none", async () => {
    mocks.getMediaActor.mockResolvedValue({ ok: true, actor: {} })
    const wrongType = await post(draft, "text/plain")
    expect(wrongType.status).toBe(415)
    expect((await wrongType.json()).assetId).toBe("")
    const badVenue = await POST(
      new Request("http://x/api/upload-labels", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ venueId: "nope", input: draft }),
      })
    )
    expect(badVenue.status).toBe(400)
    expect(await badVenue.json()).toMatchObject({
      assetId: ASSET,
      code: "invalid",
    })
    const badAsset = await post({ ...draft, assetId: "nope" })
    expect((await badAsset.json()).assetId).toBe("")
  })
})
