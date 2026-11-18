import { describe, expect, it, vi } from "vitest"

import type { MediaActor } from "@/lib/server/media/types"

// B02-c: a manager account finishes an upload only while it still manages the
// upload's venue; the check runs before finalise touches the reservation.
// K2 (review R10): "manages the upload's venue" is the role held there, read
// from my_venue_memberships, not the active venue.
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

function managerActor(
  memberships: Result,
  {
    activeVenue = VENUE,
    role = "manager",
    uploaderRole = "manager",
  }: { activeVenue?: string; role?: string; uploaderRole?: string | null } = {}
) {
  const row = {
    id: ASSET,
    uploader_id: "m1",
    venue_id: VENUE,
    uploader_role: uploaderRole,
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
    rpc: vi.fn(async () => memberships),
  }
  const service = {
    from: vi.fn(() => {
      throw new Error("must not touch the reservation")
    }),
  }
  const actor = {
    profile: { id: "m1", role, venueId: activeVenue, active: true },
    db,
    service,
    storage: { url: "http://127.0.0.1:1", serviceKey: "x" },
  } as unknown as MediaActor
  return { actor, db, service }
}

const member = (venueId: string, role: string) => ({
  venue_id: venueId,
  venue_name: "x",
  role,
  is_active_venue: false,
})

/** Refused before finalise touches the reservation. */
async function refused(actor: MediaActor, service: { from: unknown }) {
  const result = await finaliseAsset(actor, {
    assetId: ASSET,
    idempotencyKey: KEY,
  })
  expect(service.from).not.toHaveBeenCalled()
  return result
}

describe("finalise for a manager account", () => {
  it.each([
    ["no longer has the venue", []],
    ["is only staff there now", [member(VENUE, "staff")]],
    ["manages another venue only", [member(OTHER, "manager")]],
  ])("refuses when it %s", async (_, rows) => {
    const { actor, db, service } = managerActor({ data: rows, error: null })
    expect(await refused(actor, service)).toMatchObject({
      ok: false,
      status: 403,
      message: expect.stringContaining("manager access has ended"),
    })
    expect(db.rpc).toHaveBeenCalledWith("my_venue_memberships")
  })

  it("passes the check while it manages the upload's venue, active or not (R10)", async () => {
    // Switched to OTHER since reserving: still the manager at VENUE.
    const { actor, db, service } = managerActor(
      { data: [member(OTHER, "staff"), member(VENUE, "manager")], error: null },
      { activeVenue: OTHER, role: "staff" }
    )
    // Past the access check, finalise touches the reservation (the stub
    // refuses there): reaching it is the proof.
    await finaliseAsset(actor, { assetId: ASSET, idempotencyKey: KEY })
    expect(service.from).toHaveBeenCalled()
    expect(db.rpc).toHaveBeenCalledWith("my_venue_memberships")
  })

  it("asks to retry when the check can't be read", async () => {
    const { actor, service } = managerActor({
      data: null,
      error: { message: "boom", code: "XX000" },
    })
    expect(await refused(actor, service)).toMatchObject({
      ok: false,
      status: 503,
    })
  })
})

describe("finalise for a staff-era upload (K2, R10)", () => {
  it("finishes after a switch to another of the person's venues", async () => {
    const { actor, service } = managerActor(
      { data: [member(VENUE, "staff"), member(OTHER, "staff")], error: null },
      { activeVenue: OTHER, role: "staff", uploaderRole: "staff" }
    )
    await finaliseAsset(actor, { assetId: ASSET, idempotencyKey: KEY })
    expect(service.from).toHaveBeenCalled()
  })

  it("refuses once the membership at the upload's venue has ended", async () => {
    const { actor, service } = managerActor(
      { data: [member(OTHER, "staff")], error: null },
      { activeVenue: OTHER, role: "staff", uploaderRole: "staff" }
    )
    expect(await refused(actor, service)).toMatchObject({
      ok: false,
      status: 403,
      message: expect.stringContaining("can no longer add photos"),
    })
  })
})
