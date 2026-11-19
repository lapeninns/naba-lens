// S3-R3 V7 (AC11): a matched file carries the venue it was matched for to the
// reservation, so a file whose turn comes after a venue switch is refused
// (wrong_venue) instead of being reserved at the new active venue.
import { describe, expect, it, vi } from "vitest"

import { rpcFailure } from "@/lib/server/media/errors"
import { reserveAsset, type ReserveRequest } from "@/lib/server/media/reserve"
import type { MediaActor } from "@/lib/server/media/types"

vi.mock("@/lib/server/lifecycle/cleanup", () => ({
  touchMediaReservation: vi.fn(),
}))

const VENUE_A = "30000000-0000-4000-8000-00000000000a"

function actor() {
  const rpc = vi
    .fn()
    .mockResolvedValue({ data: null, error: { message: "stop", code: "X" } })
  const value = {
    profile: {
      id: "30000000-0000-4000-8000-000000000001",
      role: "staff",
      venueId: "30000000-0000-4000-8000-00000000000b",
      venue: { id: "30000000-0000-4000-8000-00000000000b", active: true },
      active: true,
    },
    db: { rpc },
    service: {},
    storage: { url: "http://storage.test", serviceKey: "test" },
  } as unknown as MediaActor
  return { actor: value, rpc }
}

const request = (extra: Partial<ReserveRequest> = {}): ReserveRequest => ({
  idempotencyKey: "venue-key-1",
  filename: "soup.jpg",
  sizeBytes: 1024,
  contentType: "image/jpeg",
  mediaType: "image",
  preferResumable: false,
  ...extra,
})

describe("reserveAsset venue (V7)", () => {
  it("sends the matched venue as p_venue_id", async () => {
    const { actor: a, rpc } = actor()
    await reserveAsset(a, request({ venueId: VENUE_A }))
    expect(rpc).toHaveBeenCalledWith(
      "reserve_media_asset",
      expect.objectContaining({ p_venue_id: VENUE_A })
    )
  })

  it("names no venue when the browser sends none (the active one)", async () => {
    const { actor: a, rpc } = actor()
    await reserveAsset(a, request())
    expect(rpc.mock.calls[0]![1]).not.toHaveProperty("p_venue_id")
  })

  it("refuses a malformed venue before reserving", async () => {
    const { actor: a, rpc } = actor()
    const result = await reserveAsset(a, request({ venueId: "nope" }))
    expect(result).toMatchObject({ ok: false, status: 400 })
    expect(rpc).not.toHaveBeenCalled()
  })

  it("explains wrong_venue as a photo matched for another venue", () => {
    expect(
      rpcFailure({ message: "wrong_venue", code: "42501" } as never)
    ).toMatchObject({
      ok: false,
      status: 409,
      message: expect.stringContaining("matched for another venue"),
    })
  })
})
