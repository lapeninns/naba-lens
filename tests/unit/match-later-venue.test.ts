// S3-R3 V9: Match later lists only photos sent to the active venue. A photo
// at another venue could never be matched against this venue's slots, so it
// stays off the list (and the Album count) until the person works there.
import { describe, expect, it, vi } from "vitest"

vi.mock("@/lib/server/area-photos", () => ({
  getMyAreaLabels: async () => ({ ok: true, labels: [] }),
}))
vi.mock("@/lib/server/label-help", () => ({
  myLabelHelp: async () => ({ ok: true, assetIds: new Set<string>() }),
}))

import { listMatchLater } from "@/app/staff/_shell/match-later"

function actorAt(venueId: string | null) {
  const filters: [string, unknown][] = []
  const query = {
    select: () => query,
    is: () => query,
    eq: (column: string, value: unknown) => {
      filters.push([column, value])
      return query
    },
    or: () => query,
    order: () => query,
    limit: async () => ({ data: [], error: null }),
  }
  const actor = {
    profile: { id: "staff-1", role: "staff", venueId, active: true },
    db: { from: () => query },
  }
  return { actor: actor as never, filters }
}

describe("Match later (V9)", () => {
  it("reads only the active venue's photos", async () => {
    const { actor, filters } = actorAt("venue-b")
    await expect(listMatchLater(actor)).resolves.toEqual([])
    expect(filters).toContainEqual(["uploader_id", "staff-1"])
    expect(filters).toContainEqual(["venue_id", "venue-b"])
  })

  it("lists nothing without an active venue", async () => {
    const { actor, filters } = actorAt(null)
    await expect(listMatchLater(actor)).resolves.toEqual([])
    expect(filters).toEqual([])
  })
})
