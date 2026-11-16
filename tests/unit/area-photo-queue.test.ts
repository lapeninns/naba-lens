import { describe, expect, it, vi } from "vitest"

import { listAreaPhotoQueue } from "@/lib/server/area-photos"
import type { ManagerPhotoCtx } from "@/lib/server/menu-photos"

// G-9, Codex P2 on PR #32: decided area photos stay reachable after a reload.
// "decided" reads accepted and needs-another-photo by state on the server, so
// a backlog of waiting or withdrawn photos never fills the limit first.

const id = (n: number) =>
  `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`

const row = (n: number, state: string, decidedAt: string | null) => ({
  label_id: id(n),
  asset_id: id(0x1000 + n),
  author_name: "Priya",
  subject_label: "Garden",
  uploaded_at: "2026-11-14T12:00:00Z",
  labelled_at: "2026-11-14T12:01:00Z",
  credit_month: "2026-11-01",
  state,
  reason: null,
  decided_at: decidedAt,
  can_decide: true,
  has_thumbnail: false,
  has_preview: false,
})

function ctx(byStatus: Record<string, unknown[]>) {
  const rpc = vi.fn(async (name: string, args: { p_status: string }) => {
    if (name !== "area_photo_queue") throw new Error(`unexpected rpc ${name}`)
    return { data: byStatus[args.p_status] ?? [], error: null }
  })
  return {
    rpc,
    ctx: {
      actor: { db: { rpc } },
      venueId: id(0xe1),
    } as unknown as ManagerPhotoCtx,
  }
}

describe("listAreaPhotoQueue", () => {
  it("reads decided photos by state, never through the waiting backlog", async () => {
    const { rpc, ctx: c } = ctx({
      // 50 waiting photos would fill an "all" read's limit.
      all: Array.from({ length: 50 }, (_, i) => row(i + 1, "pending", null)),
      accepted: [row(0x100, "accepted", "2026-11-15T09:00:00Z")],
      needs_another_photo: [
        row(0x101, "needs_another_photo", "2026-11-15T10:00:00Z"),
      ],
    })
    const result = await listAreaPhotoQueue(c, "decided")
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(rpc.mock.calls.map(([, a]) => a.p_status).sort()).toEqual([
      "accepted",
      "needs_another_photo",
    ])
    // Most recently decided first.
    expect(result.cards.map((card) => card.state)).toEqual([
      "needs_another_photo",
      "accepted",
    ])
  })

  it("reads only waiting photos for the queue", async () => {
    const { rpc, ctx: c } = ctx({
      pending: [row(1, "pending", null)],
    })
    const result = await listAreaPhotoQueue(c, "pending")
    expect(rpc).toHaveBeenCalledTimes(1)
    expect(rpc.mock.calls[0]![1].p_status).toBe("pending")
    expect(result.ok && result.cards.map((card) => card.state)).toEqual([
      "pending",
    ])
  })

  it("fails the read when either state's read fails", async () => {
    const rpc = vi.fn(async (_: string, args: { p_status: string }) =>
      args.p_status === "accepted"
        ? { data: null, error: { code: "42501", message: "not_venue_manager" } }
        : { data: [], error: null }
    )
    const result = await listAreaPhotoQueue(
      {
        actor: { db: { rpc } },
        venueId: id(0xe1),
      } as unknown as ManagerPhotoCtx,
      "decided"
    )
    expect(result.ok).toBe(false)
  })
})
