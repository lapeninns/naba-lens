// FA-21: removal of accepted media. Parsers of the database's JSON
// (lib/media/removal.ts) and the server calls' refusal mapping
// (lib/server/lifecycle/removal.ts), with the database mocked.
import { describe, expect, it, vi } from "vitest"

import {
  normaliseRemovalReason,
  parseRemovalImpact,
  parseRemovalRequests,
} from "@/lib/media/removal"
import {
  getRemovalImpact,
  removeAcceptedMediaAsset,
  requestMediaRemoval,
} from "@/lib/server/lifecycle/removal"
import type { MediaActor } from "@/lib/server/media/types"

vi.mock("@/lib/server/lifecycle/remove-media", () => ({
  removeTombstonedObjects: vi.fn().mockResolvedValue("removed"),
}))

const ASSET = "30000000-0000-4000-8000-000000000001"

const impact = {
  assetId: ASSET,
  venueId: "v",
  uploaderId: "u",
  removed: false,
  accepted: true,
  menuItems: [
    { itemId: "i", name: "Soup", state: "accepted", isPrimary: true },
  ],
  areas: [{ subjectId: "s", label: "Bar", state: "accepted" }],
  coverageSends: 0,
  amenityAnswers: "1",
  publicUses: 0,
  internalUses: 2,
  openRequests: 1,
  blocked: false,
  token: "abc",
}

const actor = (result: { data?: unknown; error?: unknown }) =>
  ({
    db: {
      rpc: vi.fn().mockResolvedValue({ data: null, error: null, ...result }),
    },
    service: {},
  }) as unknown as MediaActor & { db: { rpc: ReturnType<typeof vi.fn> } }

describe("parsers", () => {
  it("reads an impact preview and refuses an unknown shape", () => {
    expect(parseRemovalImpact(impact)).toMatchObject({
      accepted: true,
      amenityAnswers: 1,
      menuItems: [{ name: "Soup", isPrimary: true }],
      token: "abc",
    })
    expect(parseRemovalImpact({ ...impact, token: 1 })).toBeNull()
    expect(parseRemovalImpact({ ...impact, publicUses: -1 })).toBeNull()
    expect(parseRemovalImpact({ ...impact, areas: [{}] })).toBeNull()
    expect(parseRemovalImpact(null)).toBeNull()
  })

  it("keeps readable requests and drops the rest", () => {
    const row = {
      requestId: "r",
      assetId: ASSET,
      venueId: "v",
      venueName: "The Bell",
      requestedBy: "u",
      requesterName: "Sam",
      reason: "Shows a guest",
      state: "open",
      createdAt: "2026-11-18T10:00:00Z",
      decidedAt: null,
      decisionReason: null,
      mine: true,
    }
    expect(parseRemovalRequests([row, { ...row, state: "lost" }, 3])).toEqual([
      row,
    ])
    expect(parseRemovalRequests(null)).toEqual([])
  })

  it("takes a reason of 3 to 500 characters, trimmed", () => {
    expect(normaliseRemovalReason("  Old menu  ")).toBe("Old menu")
    expect(normaliseRemovalReason("no")).toBeNull()
    expect(normaliseRemovalReason("x".repeat(501))).toBeNull()
    expect(normaliseRemovalReason(undefined)).toBeNull()
  })
})

describe("server calls", () => {
  it("checks ids and reasons before calling the database", async () => {
    const a = actor({})
    expect(await requestMediaRemoval(a, "nope", "Reason")).toMatchObject({
      ok: false,
      status: 404,
    })
    expect(await requestMediaRemoval(a, ASSET, "x")).toMatchObject({
      ok: false,
      status: 400,
    })
    expect(a.db.rpc).not.toHaveBeenCalled()
  })

  it("maps the database's refusals to statuses and words", async () => {
    const cases: [string, number, RegExp][] = [
      ["withdraw_instead", 409, /remove it yourself/],
      ["media_asset_not_found", 404, /could not be found/],
      ["not_permitted", 403, /Not allowed/],
      ["impact_changed", 409, /Check the preview again/],
      ["media_asset_published", 409, /Withdraw its public uses/],
      ["something_else", 503, /Try again/],
    ]
    for (const [message, status, words] of cases) {
      const result = await requestMediaRemoval(
        actor({ error: { message } }),
        ASSET,
        "Reason"
      )
      expect(result, message).toMatchObject({ ok: false, status })
      if (!result.ok) expect(result.message).toMatch(words)
    }
  })

  it("returns a parsed preview, and removes with the token then the objects", async () => {
    expect(
      await getRemovalImpact(actor({ data: impact }), ASSET)
    ).toMatchObject({ ok: true, impact: { token: "abc" } })
    const a = actor({ data: { closedRequests: ["r1"] } })
    expect(
      await removeAcceptedMediaAsset(a, {
        assetId: ASSET,
        reason: "Personal information",
        impactToken: "abc",
      })
    ).toEqual({ ok: true, closedRequests: ["r1"], storage: "removed" })
    expect(a.db.rpc).toHaveBeenCalledWith("admin_delete_media_asset", {
      p_asset_id: ASSET,
      p_reason: "Personal information",
      p_impact_token: "abc",
    })
    const noToken = actor({})
    expect(
      await removeAcceptedMediaAsset(noToken, {
        assetId: ASSET,
        reason: "Personal information",
        impactToken: "",
      })
    ).toMatchObject({ ok: false, status: 409 })
    expect(noToken.db.rpc).not.toHaveBeenCalled()
  })
})
