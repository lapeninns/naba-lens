import { describe, expect, it, vi } from "vitest"

import { rpcFailure } from "@/lib/server/media/errors"
import { reserveAsset, type ReserveRequest } from "@/lib/server/media/reserve"
import type { MediaActor } from "@/lib/server/media/types"

vi.mock("@/lib/server/lifecycle/cleanup", () => ({
  touchMediaReservation: vi.fn(),
}))

const staffId = "30000000-0000-4000-8000-000000000001"

/** A staff actor whose reserve RPC fails, so reserveAsset stops after the call. */
function actor() {
  const rpc = vi
    .fn()
    .mockResolvedValue({ data: null, error: { message: "stop", code: "X" } })
  const value = {
    profile: {
      id: staffId,
      email: null,
      displayName: "Staff",
      avatarPath: null,
      jobTitle: null,
      role: "staff",
      venueId: "30000000-0000-4000-8000-000000000002",
      venue: { id: "30000000-0000-4000-8000-000000000002", active: true },
      active: true,
      work: null,
    },
    db: { rpc },
    service: {},
    storage: { url: "http://storage.test", serviceKey: "test" },
  } as unknown as MediaActor
  return { actor: value, rpc }
}

const request = (extra: Partial<ReserveRequest> = {}): ReserveRequest => ({
  idempotencyKey: "purpose-key-1",
  filename: "wifi.jpg",
  sizeBytes: 1024,
  contentType: "image/jpeg",
  mediaType: "image",
  preferResumable: false,
  ...extra,
})

describe("reserveAsset purpose", () => {
  it("reserves a general upload when the browser sends no purpose", async () => {
    const { actor: a, rpc } = actor()
    await reserveAsset(a, request())
    expect(rpc).toHaveBeenCalledWith(
      "reserve_media_asset",
      expect.objectContaining({ p_purpose: "general" })
    )
  })

  it("passes amenity through to reserve_media_asset", async () => {
    const { actor: a, rpc } = actor()
    await reserveAsset(a, request({ purpose: "amenity" }))
    expect(rpc).toHaveBeenCalledWith(
      "reserve_media_asset",
      expect.objectContaining({ p_purpose: "amenity" })
    )
  })

  it("rejects an unknown purpose before reserving", async () => {
    const { actor: a, rpc } = actor()
    const result = await reserveAsset(
      a,
      request({ purpose: "community" as never })
    )
    expect(result).toMatchObject({ ok: false, status: 400 })
    expect(rpc).not.toHaveBeenCalled()
  })

  it("maps reservation_purpose_mismatch to a 404, like a removed reservation", async () => {
    // The browser's reserve turns 404 into ReservationGoneError: the saved key
    // is discarded and the retry reserves a new asset with the new purpose.
    expect(
      rpcFailure({ message: "reservation_purpose_mismatch", code: "22023" })
    ).toMatchObject({ ok: false, status: 404 })
    const { actor: a, rpc } = actor()
    rpc.mockResolvedValueOnce({
      data: null,
      error: { message: "reservation_purpose_mismatch", code: "22023" },
    })
    expect(
      await reserveAsset(a, request({ purpose: "amenity" }))
    ).toMatchObject({ ok: false, status: 404 })
  })

  it("maps the database's invalid_purpose to a 400", () => {
    expect(rpcFailure({ message: "invalid_purpose" })).toMatchObject({
      ok: false,
      status: 400,
    })
  })
})
