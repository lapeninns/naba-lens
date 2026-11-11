import { describe, expect, it, vi } from "vitest"

import type { MediaActor } from "@/lib/server/media/types"

// B02-c (owner decisions Q1, Q4): the label services no longer turn a manager
// actor away before the database. The database admits a manager account for
// its own manager-era uploads at its managed venue and refuses the rest, and
// the services report that refusal as for anyone else.
vi.mock("server-only", () => ({}))

const { getLabellingCatalogue, saveAssetLabels } =
  await import("@/lib/server/labels")

const ASSET = "0a6f3c2e-6a51-4f43-9a6a-2f1f8d1c0a01"
const VENUE = "0a6f3c2e-6a51-4f43-9a6a-2f1f8d1c0a02"

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

function managerActor(rpcResult: Result) {
  const db = {
    from: vi.fn((table: string) =>
      query(
        table === "venues"
          ? { data: { id: VENUE, name: "TEST Venue" }, error: null }
          : { data: null, error: null }
      )
    ),
    rpc: vi.fn(async () => rpcResult),
  }
  const actor = {
    profile: { id: "m1", role: "manager", venueId: VENUE, active: true },
    db,
    service: db,
    storage: { url: "http://127.0.0.1:1", serviceKey: "x" },
  } as unknown as MediaActor
  return { actor, db }
}

describe("label services with a manager account", () => {
  it("read its managed venue's catalogue through the database", async () => {
    const { actor, db } = managerActor({ data: null, error: null })
    expect(await getLabellingCatalogue(actor, VENUE)).toEqual({
      ok: true,
      catalogue: { status: "none", venueId: VENUE, venueName: "TEST Venue" },
    })
    expect(db.from).toHaveBeenCalledWith("menu_versions")
  })

  it("save through the database and report its refusal", async () => {
    const { actor, db } = managerActor({
      data: null,
      error: { message: "media_asset_not_found", code: "P0002" },
    })
    const result = await saveAssetLabels(actor, {
      assetId: ASSET,
      expectedRevision: 0,
      catalogueVersionId: null,
      contentTypes: ["dish"],
      note: null,
      items: [],
      missingItem: null,
    } as never)
    expect(result).toMatchObject({
      ok: false,
      assetId: ASSET,
      code: "not_found",
    })
    expect(db.rpc).toHaveBeenCalledWith(
      "save_media_labels",
      expect.objectContaining({ p_asset_id: ASSET })
    )
  })
})
