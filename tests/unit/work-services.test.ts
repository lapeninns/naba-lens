import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))
const server = vi.hoisted(() => ({
  knowledgeRpcFailure: vi.fn(() => ({
    ok: false,
    code: "unavailable",
    status: 503,
    message: "failed",
  })),
}))
vi.mock("@/lib/server/knowledge", () => server)
const rpc = vi.hoisted(() => ({ knowledgeRpc: vi.fn() }))
vi.mock("@/lib/server/knowledge/rpc", () => rpc)

import type { MediaActor } from "@/lib/server/media/types"
import { workServices } from "@/lib/work-client/services"

const actor = { db: {} } as MediaActor
const ASSET = "8a000000-0000-4000-8000-000000000201"

beforeEach(() => vi.clearAllMocks())

describe("work services seam", () => {
  it("reads capabilities for the caller's own venue by default", async () => {
    rpc.knowledgeRpc.mockResolvedValue({
      data: {
        accountKind: "manager",
        venueId: "v1",
        canUpload: false,
        canLabel: false,
        canSendFindings: true,
        canConfirmFindings: true,
        canSelfConfirm: {},
        canReviewMenuPhotos: true,
        canDecideOwnMenuPhoto: false,
        canReviewChecklist: false,
        canBeAssigned: false,
      },
      error: null,
    })
    const result = await workServices.getCapabilities(actor)
    expect(rpc.knowledgeRpc).toHaveBeenCalledWith(
      actor.db,
      "my_venue_capabilities",
      { p_venue_id: null }
    )
    expect(result).toMatchObject({
      status: "ok",
      value: {
        accountKind: "manager",
        canUpload: false,
        canSendFindings: true,
      },
    })
  })

  it("is missing, not failed, before the B02 migrations", async () => {
    for (const code of ["PGRST202", "42883"]) {
      rpc.knowledgeRpc.mockResolvedValueOnce({
        data: null,
        error: { code, message: "function does not exist" },
      })
      expect(await workServices.getLabelWork(actor)).toEqual({
        status: "missing",
      })
    }
    expect(server.knowledgeRpcFailure).not.toHaveBeenCalled()
  })

  it("passes any other error through the server's mapping", async () => {
    const error = { code: "42501", message: "permission denied" }
    rpc.knowledgeRpc.mockResolvedValue({ data: null, error })
    const result = await workServices.getTriage(actor, "v1")
    expect(rpc.knowledgeRpc).toHaveBeenCalledWith(
      actor.db,
      "manager_triage_summary",
      { p_venue_id: "v1" }
    )
    expect(server.knowledgeRpcFailure).toHaveBeenCalledWith(
      error,
      "manager triage"
    )
    expect(result.status).toBe("failed")
  })

  it("fails a reply it can't read rather than guessing", async () => {
    rpc.knowledgeRpc.mockResolvedValue({ data: [{}], error: null })
    expect(await workServices.getLabelWork(actor)).toMatchObject({
      status: "failed",
      failure: { code: "unavailable" },
    })
  })

  it("reads the label work row", async () => {
    rpc.knowledgeRpc.mockResolvedValue({
      data: [{ needs_labels: 4, needs_attention: 1 }],
      error: null,
    })
    expect(await workServices.getLabelWork(actor)).toEqual({
      status: "ok",
      value: { needsLabels: 4, needsAttention: 1 },
    })
  })

  it("reads a photo's delete impact, and refuses a malformed id", async () => {
    rpc.knowledgeRpc.mockResolvedValue({
      data: { assetId: ASSET, impacts: [] },
      error: null,
    })
    expect(await workServices.getDeleteImpact(actor, ASSET)).toEqual({
      status: "ok",
      value: { status: "known", items: [] },
    })
    expect(rpc.knowledgeRpc).toHaveBeenCalledWith(
      actor.db,
      "my_asset_delete_impact",
      { p_asset_id: ASSET }
    )
    rpc.knowledgeRpc.mockClear()
    expect(await workServices.getDeleteImpact(actor, "nope")).toMatchObject({
      status: "failed",
      failure: { code: "not_found" },
    })
    expect(rpc.knowledgeRpc).not.toHaveBeenCalled()
  })
})
