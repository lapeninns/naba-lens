// Contribution groups seam (B02-05, W1): parsers, the work-client services
// that call the RPCs directly (a missing function keeps B01's single photos),
// My contributions' group ids, and the Server Functions Add and Review use.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))
const server = vi.hoisted(() => ({
  knowledgeRpcFailure: vi.fn((error: { code?: string }) => ({
    ok: false,
    code: error.code === "P0001" ? "state_conflict" : "unavailable",
    status: error.code === "P0001" ? 409 : 503,
    message: "failed",
  })),
}))
vi.mock("@/lib/server/knowledge", () => server)
const rpc = vi.hoisted(() => ({ knowledgeRpc: vi.fn() }))
vi.mock("@/lib/server/knowledge/rpc", () => rpc)
const auth = vi.hoisted(() => ({
  getMediaActor: vi.fn(),
  getAmenityActor: vi.fn(),
}))
vi.mock("@/lib/server/media/context", () => ({
  getMediaActor: auth.getMediaActor,
}))
vi.mock("@/lib/server/amenities", () => ({
  getAmenityActor: auth.getAmenityActor,
}))
vi.mock("@/lib/server/lifecycle/remove", () => ({ removeMediaAsset: vi.fn() }))

import {
  addToPhotoSet,
  readPhotoSets,
  startPhotoSet,
} from "@/app/_media/actions"
import type { MediaActor } from "@/lib/server/media/types"
import {
  parseAssetGroups,
  parseGroupId,
  parseGroupMembers,
} from "@/lib/work-client/parse"
import { workServices } from "@/lib/work-client/services"

const actor = { db: {}, profile: { venueId: "v1" } } as unknown as MediaActor
const id = (n: number) =>
  `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`
const GROUP = id(0x6001)
const A1 = id(0xa1)
const A2 = id(0xa2)
const ITEM = id(0xc1)

beforeEach(() => {
  vi.clearAllMocks()
  auth.getMediaActor.mockResolvedValue({ ok: true, actor })
  auth.getAmenityActor.mockResolvedValue({ ok: true, actor })
})
afterEach(() => {
  delete process.env.NABALENS_CONTRIBUTION_ENTRY
  delete process.env.NABALENS_MANAGER_TRIAGE
})

describe("group parsers", () => {
  it("reads a group id, a member count and asset rows", () => {
    expect(parseGroupId(GROUP)).toEqual({ groupId: GROUP })
    expect(parseGroupId("not-a-uuid")).toBeNull()
    expect(parseGroupId(null)).toBeNull()
    expect(parseGroupMembers(3)).toEqual({ members: 3 })
    expect(parseGroupMembers(-1)).toBeNull()
    expect(parseGroupMembers("3")).toBeNull()
    expect(
      parseAssetGroups([
        { asset_id: A1, group_id: GROUP },
        { assetId: A2, groupId: GROUP },
        { asset_id: A1, group_id: id(0x6002) },
      ])
    ).toEqual([
      { assetId: A1, groupId: GROUP },
      { assetId: A2, groupId: GROUP },
    ])
  })

  it("refuses a lookup it can't read as a whole", () => {
    expect(parseAssetGroups(null)).toBeNull()
    expect(parseAssetGroups([{ asset_id: A1 }])).toBeNull()
    expect(parseAssetGroups([{ asset_id: "x", group_id: GROUP }])).toBeNull()
    expect(parseAssetGroups(["row"])).toBeNull()
  })
})

describe("group services", () => {
  it("starts a group with the client's key and subject", async () => {
    rpc.knowledgeRpc.mockResolvedValue({ data: GROUP, error: null })
    const result = await workServices.startGroup(actor, {
      key: "0f2c9a1e-key",
      subject: { kind: "menu_item", id: ITEM },
    })
    expect(rpc.knowledgeRpc).toHaveBeenCalledWith(
      actor.db,
      "contribution_group_start",
      {
        p_key: "0f2c9a1e-key",
        p_subject_kind: "menu_item",
        p_subject_id: ITEM,
      }
    )
    expect(result).toEqual({ status: "ok", value: { groupId: GROUP } })
  })

  it("refuses a bad key or subject without calling the database", async () => {
    for (const input of [
      { key: "short", subject: { kind: "menu_item", id: ITEM } },
      { key: "a-valid-key", subject: { kind: "dish", id: ITEM } },
      { key: "a-valid-key", subject: { kind: "none", id: ITEM } },
      { key: "a-valid-key", subject: { kind: "task", id: null } },
    ])
      expect(
        await workServices.startGroup(actor, input as never)
      ).toMatchObject({ status: "failed", failure: { code: "invalid_input" } })
    expect(rpc.knowledgeRpc).not.toHaveBeenCalled()
  })

  it("is missing, not failed, before the groups migration", async () => {
    for (const code of ["PGRST202", "42883"]) {
      rpc.knowledgeRpc.mockResolvedValueOnce({ data: null, error: { code } })
      expect(
        await workServices.addToGroup(actor, {
          groupId: GROUP,
          assetIds: [A1, A2],
        })
      ).toEqual({ status: "missing" })
    }
  })

  it("passes a refusal through the server's mapping", async () => {
    rpc.knowledgeRpc.mockResolvedValue({ data: null, error: { code: "P0001" } })
    expect(
      await workServices.addToGroup(actor, {
        groupId: GROUP,
        assetIds: [A1],
      })
    ).toMatchObject({ status: "failed", failure: { code: "state_conflict" } })
  })

  it("adds at most 10 distinct photos", async () => {
    const many = Array.from({ length: 11 }, (_, i) => id(0xb00 + i))
    expect(
      await workServices.addToGroup(actor, { groupId: GROUP, assetIds: many })
    ).toMatchObject({ status: "failed" })
    expect(
      await workServices.addToGroup(actor, {
        groupId: GROUP,
        assetIds: [A1, A1],
      })
    ).toMatchObject({ status: "failed" })
    expect(rpc.knowledgeRpc).not.toHaveBeenCalled()
  })

  it("looks up groups for at most 100 photos, none without a call", async () => {
    expect(await workServices.getAssetGroups(actor, [])).toEqual({
      status: "ok",
      value: [],
    })
    rpc.knowledgeRpc.mockResolvedValue({
      data: [{ asset_id: A1, group_id: GROUP }],
      error: null,
    })
    expect(await workServices.getAssetGroups(actor, [A1, A2])).toEqual({
      status: "ok",
      value: [{ assetId: A1, groupId: GROUP }],
    })
    expect(rpc.knowledgeRpc).toHaveBeenCalledTimes(1)
    const many = Array.from({ length: 101 }, (_, i) => id(0xd00 + i))
    expect(await workServices.getAssetGroups(actor, many)).toMatchObject({
      status: "failed",
    })
  })

  it("gives My contributions' photo rows their group, or leaves it out", async () => {
    const feed = {
      items: [
        {
          type: "photo",
          key: "p:1",
          at: "2026-11-06T10:00:00.000Z",
          assetId: A1,
          venueId: "v1",
          venueName: "TEST Inn",
          mediaType: "image",
          uploadState: "ready",
          sentAt: "2026-11-06T10:00:00.000Z",
          labels: {},
          menuDecisions: [],
          menuUseAccepted: false,
        },
      ],
      nextCursor: null,
    }
    rpc.knowledgeRpc
      .mockResolvedValueOnce({ data: feed, error: null })
      .mockResolvedValueOnce({
        data: [{ asset_id: A1, group_id: GROUP }],
        error: null,
      })
    const ok = await workServices.getContributions(actor)
    expect(ok.status === "ok" && ok.value.items[0]).toMatchObject({
      groupId: GROUP,
    })

    rpc.knowledgeRpc
      .mockResolvedValueOnce({ data: feed, error: null })
      .mockResolvedValueOnce({ data: null, error: { code: "PGRST202" } })
    const missing = await workServices.getContributions(actor)
    expect(missing.status).toBe("ok")
    expect(missing.status === "ok" && "groupId" in missing.value.items[0]).toBe(
      false
    )
  })
})

describe("set Server Functions", () => {
  it("start and add as the uploader, with retry only where it may help", async () => {
    rpc.knowledgeRpc.mockResolvedValueOnce({ data: GROUP, error: null })
    expect(
      await startPhotoSet({
        key: "a-valid-key",
        subject: { kind: "task", id: ITEM },
      })
    ).toEqual({ status: "ok", groupId: GROUP })
    // Staff, and a manager account at its venue (B02-c).
    expect(auth.getMediaActor).toHaveBeenCalledWith(["staff", "manager"])

    rpc.knowledgeRpc.mockResolvedValueOnce({ data: 2, error: null })
    expect(await addToPhotoSet({ groupId: GROUP, assetIds: [A1, A2] })).toEqual(
      { status: "ok", members: 2 }
    )

    rpc.knowledgeRpc.mockResolvedValueOnce({
      data: null,
      error: { code: "P0001" },
    })
    expect(await addToPhotoSet({ groupId: GROUP, assetIds: [A1] })).toEqual({
      status: "failed",
      retry: false,
    })
    rpc.knowledgeRpc.mockResolvedValueOnce({
      data: null,
      error: { code: "08006" },
    })
    expect(await addToPhotoSet({ groupId: GROUP, assetIds: [A1] })).toEqual({
      status: "failed",
      retry: true,
    })
  })

  it("never starts a set for an account that isn't staff, or with the entry off", async () => {
    auth.getMediaActor.mockResolvedValueOnce({
      ok: false,
      status: 403,
      message: "no",
    })
    expect(
      await startPhotoSet({ key: "a-valid-key", subject: { kind: "none" } })
    ).toEqual({ status: "failed", retry: false })
    process.env.NABALENS_CONTRIBUTION_ENTRY = "b01"
    expect(
      await startPhotoSet({ key: "a-valid-key", subject: { kind: "none" } })
    ).toEqual({ status: "missing" })
    expect(rpc.knowledgeRpc).not.toHaveBeenCalled()
  })

  it("reads Review's sets as the reviewer, and not with triage off", async () => {
    rpc.knowledgeRpc.mockResolvedValueOnce({
      data: [{ asset_id: A1, group_id: GROUP }],
      error: null,
    })
    expect(await readPhotoSets({ assetIds: [A1, A2] })).toEqual({
      status: "ok",
      groups: [{ assetId: A1, groupId: GROUP }],
    })
    expect(auth.getAmenityActor).toHaveBeenCalled()
    process.env.NABALENS_MANAGER_TRIAGE = "b01"
    expect(await readPhotoSets({ assetIds: [A1] })).toEqual({
      status: "missing",
    })
    expect(rpc.knowledgeRpc).toHaveBeenCalledTimes(1)
  })
})
