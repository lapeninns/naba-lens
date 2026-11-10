import { describe, expect, it, vi } from "vitest"

import type { MediaActor } from "@/lib/server/media/types"

// B02-c: a manager account finishes an upload only while it still manages the
// upload's venue; the check runs before finalise touches the reservation.
vi.mock("server-only", () => ({}))

const { finaliseAsset } = await import("@/lib/server/media/finalise")

const ASSET = "0a6f3c2e-6a51-4f43-9a6a-2f1f8d1c0a01"
const VENUE = "0a6f3c2e-6a51-4f43-9a6a-2f1f8d1c0a02"
const OTHER = "0a6f3c2e-6a51-4f43-9a6a-2f1f8d1c0a03"
const KEY = "TEST-key-0001"

type Result = { data: unknown; error: unknown }

/** A query builder: every call chains, and awaiting it gives `result`. */
function query(result: Result): unknown {
  const builder: unknown = new Proxy(() => builder, {
    get: (_target, prop) =>
      prop === "then"
        ? (resolve: (r: Result) => void) => resolve(result)
        : () => builder,
  })
  return builder
}

function managerActor(capabilities: Result) {
  const row = {
    id: ASSET,
    uploader_id: "m1",
    venue_id: VENUE,
    original_path: `m1/${ASSET}/original.jpg`,
    original_filename: "x.jpg",
    media_type: "image",
    upload_state: "uploading",
    client_upload_key: KEY,
    size_bytes: 4,
    updated_at: "2026-11-10T09:00:00Z",
  }
  const db = {
    from: vi.fn(() => query({ data: row, error: null })),
    rpc: vi.fn(async () => capabilities),
  }
  const service = {
    from: vi.fn(() => {
      throw new Error("must not touch the reservation")
    }),
  }
  const actor = {
    profile: { id: "m1", role: "manager", venueId: VENUE, active: true },
    db,
    service,
    storage: { url: "http://127.0.0.1:1", serviceKey: "x" },
  } as unknown as MediaActor
  return { actor, db, service }
}

describe("finalise for a manager account", () => {
  it.each([
    ["the grant has ended", { canUpload: false, venueId: null }],
    ["it manages another venue now", { canUpload: true, venueId: OTHER }],
  ])("refuses when %s", async (_, caps) => {
    const { actor, db, service } = managerActor({ data: caps, error: null })
    expect(
      await finaliseAsset(actor, { assetId: ASSET, idempotencyKey: KEY })
    ).toMatchObject({ ok: false, status: 403 })
    expect(db.rpc).toHaveBeenCalledWith("my_venue_capabilities", {
      p_venue_id: null,
    })
    expect(service.from).not.toHaveBeenCalled()
  })

  it("asks to retry when the check can't be read", async () => {
    const { actor, service } = managerActor({
      data: null,
      error: { message: "boom", code: "XX000" },
    })
    expect(
      await finaliseAsset(actor, { assetId: ASSET, idempotencyKey: KEY })
    ).toMatchObject({ ok: false, status: 503 })
    expect(service.from).not.toHaveBeenCalled()
  })
})
