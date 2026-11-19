// S3-R13 X2: the Needs label list reads every queue page, not the first one.
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))
const read = vi.hoisted(() => ({ listReviewQueue: vi.fn() }))
vi.mock("@/lib/server/menu-photos", () => read)

import {
  listAllNeedsLabel,
  NEEDS_LABEL_PAGES,
} from "@/app/manager/review/_shared/needs-label"
import type { ManagerPhotoCtx } from "@/lib/server/menu-photos"

const ctx = {} as ManagerPhotoCtx
const card = (n: number) => ({ key: `k${n}`, kind: "unlabelled" })
const page = (from: number, count: number, next: string | null) => ({
  ok: true,
  items: Array.from({ length: count }, (_, i) => card(from + i)),
  nextCursor: next,
})

beforeEach(() => read.listReviewQueue.mockReset())

describe("listAllNeedsLabel", () => {
  it("follows the cursor until the last page (40 photos, two pages)", async () => {
    read.listReviewQueue
      .mockResolvedValueOnce(page(0, 24, "c1"))
      .mockResolvedValueOnce(page(24, 16, null))
    const out = await listAllNeedsLabel(ctx, { contributorId: "x" })
    expect(out.ok && out.items).toHaveLength(40)
    expect(out.ok && out.more).toBe(false)
    expect(read.listReviewQueue.mock.calls[0]![1]).toEqual({
      contributorId: "x",
      status: "unlabelled",
    })
    expect(read.listReviewQueue.mock.calls[1]![1]).toEqual({
      contributorId: "x",
      status: "unlabelled",
      cursor: "c1",
    })
  })

  it("stops at the page limit and says more wait", async () => {
    read.listReviewQueue.mockImplementation(async () => page(0, 24, "again"))
    const out = await listAllNeedsLabel(ctx, {})
    expect(read.listReviewQueue).toHaveBeenCalledTimes(NEEDS_LABEL_PAGES)
    expect(out.ok && out.more).toBe(true)
  })

  it("returns a failed read as it is", async () => {
    const failure = { ok: false, code: "unavailable", message: "x" }
    read.listReviewQueue.mockResolvedValueOnce(failure)
    expect(await listAllNeedsLabel(ctx, {})).toBe(failure)
  })
})
