import { describe, expect, it, vi } from "vitest"

import type { MediaActor } from "@/lib/server/media/types"

// Defence in depth (spec §4.5): the label services refuse a manager actor
// before touching the database, whichever actor the caller built.
vi.mock("server-only", () => ({}))

const { getAssetLabelContext, getLabellingCatalogue, saveAssetLabels } =
  await import("@/lib/server/labels")

const ASSET = "0a6f3c2e-6a51-4f43-9a6a-2f1f8d1c0a01"
const VENUE = "0a6f3c2e-6a51-4f43-9a6a-2f1f8d1c0a02"

function managerActor() {
  const db = {
    from: vi.fn(() => {
      throw new Error("must not query")
    }),
    rpc: vi.fn(() => {
      throw new Error("must not call an RPC")
    }),
  }
  const actor = {
    profile: { id: "m1", role: "manager", venueId: VENUE, active: true },
    db,
    service: db,
    storage: { url: "http://127.0.0.1:1", serviceKey: "x" },
  } as unknown as MediaActor
  return { actor, db }
}

const refused = {
  ok: false,
  status: 403,
  message: "Labels are edited by staff and admins.",
}

describe("label services refuse managers", () => {
  it("catalogue", async () => {
    const { actor, db } = managerActor()
    expect(await getLabellingCatalogue(actor, VENUE)).toEqual(refused)
    expect(db.from).not.toHaveBeenCalled()
  })

  it("editor context", async () => {
    const { actor, db } = managerActor()
    expect(await getAssetLabelContext(actor, [ASSET])).toEqual(refused)
    expect(db.from).not.toHaveBeenCalled()
  })

  it("save", async () => {
    const { actor, db } = managerActor()
    const result = await saveAssetLabels(actor, {
      assetId: ASSET,
      expectedRevision: 0,
      catalogueVersionId: null,
      contentTypes: [],
      note: null,
      items: [],
      missingItem: null,
    } as never)
    expect(result).toEqual({
      ok: false,
      assetId: ASSET,
      code: "forbidden",
      message: refused.message,
    })
    expect(db.rpc).not.toHaveBeenCalled()
  })
})
