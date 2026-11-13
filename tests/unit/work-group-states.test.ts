// B05-m5 group read and replacement seam: the parsers ignore keys they don't
// know and refuse a read whose rendered keys are wrong (§1.6), the
// work-client services, the Server Functions Add uses, and the error mapping
// for the replacement's refusals.
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

import { readPhotoSet, replaceInPhotoSet } from "@/app/_media/actions"
import { knowledgeRpcFailure } from "@/lib/server/knowledge/errors"
import type { MediaActor } from "@/lib/server/media/types"
import {
  parseContributionsPage,
  parseGroupReplace,
  parseGroupView,
} from "@/lib/work-client/parse"
import { workServices } from "@/lib/work-client/services"

const actor = { db: {}, profile: { venueId: "v1" } } as unknown as MediaActor
const id = (n: number) =>
  `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`
const GROUP = id(0x6001)
const VENUE = id(0x7001)
const A1 = id(0xa1)
const A2 = id(0xa2)
const A3 = id(0xa3)

const SUMMARY = {
  live: 2,
  ready: 1,
  inProgress: 1,
  failed: 0,
  removed: 0,
  replaced: 1,
  finished: false,
}

/** A creator's read as B05-m5 returns it. */
const creatorView = () => ({
  groupId: GROUP,
  venueId: VENUE,
  createdAt: "2026-11-12T10:00:00.123456+00:00",
  mine: true,
  subject: { kind: "none", id: null, name: null },
  members: [
    {
      assetId: A1,
      position: 1,
      mediaType: "image",
      uploadState: "failed",
      mine: true,
      replacesAssetId: null,
      technical: "failed",
      stopped: false,
      stoppedAt: null,
      labels: "none",
      review: [],
      use: { state: "not_granted", destinations: [] },
      derivative: null,
    },
    {
      assetId: A2,
      position: 2,
      mediaType: "image",
      uploadState: "ready",
      mine: true,
      replacesAssetId: null,
      technical: "ready",
      stopped: false,
      stoppedAt: null,
      labels: "needs_attention",
      review: [{ target: "menu_item", id: A3, state: "accepted" }],
      use: {
        state: "granted",
        inForce: 1,
        withdrawn: 0,
        destinations: [{ label: "Website", state: "in_force", until: null }],
      },
      derivative: "none",
    },
    {
      assetId: A3,
      position: 3,
      mediaType: "video",
      uploadState: "uploading",
      mine: true,
      replacesAssetId: A1,
      technical: "uploading",
      stopped: true,
      stoppedAt: "2026-11-12T11:00:00.123456+00:00",
      labels: "labelled",
      review: [],
      use: null,
      derivative: null,
    },
  ],
  summary: { ...SUMMARY },
})

/** A colleague's read: members, the creator's first name, no states. */
const colleagueView = () => ({
  groupId: GROUP,
  venueId: VENUE,
  createdAt: "2026-11-12T10:00:00Z",
  mine: false,
  subject: { kind: "menu_item", id: A3, name: "Tandoori chicken" },
  members: [
    {
      assetId: A2,
      position: 2,
      mediaType: "image",
      uploadState: "ready",
      mine: false,
      replacesAssetId: null,
    },
  ],
  creatorFirstName: "Sam",
})

beforeEach(() => {
  vi.clearAllMocks()
  auth.getMediaActor.mockResolvedValue({ ok: true, actor })
  auth.getAmenityActor.mockResolvedValue({ ok: true, actor })
})
afterEach(() => {
  delete process.env.NABALENS_CONTRIBUTION_ENTRY
})

describe("parseGroupView (§1.6)", () => {
  it("reads a creator's and a colleague's view as returned", () => {
    expect(parseGroupView(creatorView())).toEqual(creatorView())
    expect(parseGroupView(colleagueView())).toEqual(colleagueView())
  })

  it("still reads a B02 view, before B05-m5 is applied", () => {
    const b02 = colleagueView() as Record<string, unknown>
    delete b02.creatorFirstName
    const members = b02.members as Record<string, unknown>[]
    delete members[0]!.replacesAssetId
    expect(parseGroupView(b02)).toEqual(b02)
  })

  it("ignores and leaves out keys it doesn't know, at every level", () => {
    const raw = creatorView() as Record<string, unknown>
    raw.futureGroupKey = { anything: true }
    ;(raw.summary as Record<string, unknown>).stopped = 1
    const members = raw.members as Record<string, unknown>[]
    members[0]!.retakeOf = A2
    members[1]!.derivativeProfile = "web"
    ;(members[1]!.use as Record<string, unknown>).granterNote = "x"
    ;(members[1]!.review as Record<string, unknown>[])[0]!.reason = "x"
    ;(members[1]!.review as Record<string, unknown>[]).push({
      target: "future_target",
      id: A1,
      state: "x",
    })
    expect(parseGroupView(raw)).toEqual(creatorView())
  })

  it("drops an unreadable pass-through key from its member only", () => {
    const raw = creatorView()
    const member = raw.members[1] as Record<string, unknown>
    member.labels = "maybe"
    member.review = "none"
    member.use = { state: "sold" }
    member.derivative = "queued"
    member.stoppedAt = "soon"
    const parsed = parseGroupView(raw)!
    expect(parsed.members[1]).toEqual({
      assetId: A2,
      position: 2,
      mediaType: "image",
      uploadState: "ready",
      mine: true,
      replacesAssetId: null,
      technical: "ready",
      stopped: false,
    })
    expect(parsed.members[0]).toEqual(creatorView().members[0])
  })

  it("refuses a read whose rendered keys are missing or wrong", () => {
    const broken: ((v: ReturnType<typeof creatorView>) => void)[] = [
      (v) => void ((v as Record<string, unknown>).groupId = "g1"),
      (v) => void ((v as Record<string, unknown>).createdAt = "yesterday"),
      (v) => void ((v as Record<string, unknown>).members = {}),
      (v) => void ((v.subject as Record<string, unknown>).kind = "dish"),
      (v) =>
        void ((v.members[0] as Record<string, unknown>).uploadState =
          "removed"),
      (v) =>
        void ((v.members[0] as Record<string, unknown>).technical = "stopped"),
      (v) => void ((v.members[0] as Record<string, unknown>).stopped = "yes"),
      (v) => void ((v.members[0] as Record<string, unknown>).position = 0),
      (v) => void ((v.members[0] as Record<string, unknown>).mine = "yes"),
      (v) =>
        void ((v.members[2] as Record<string, unknown>).replacesAssetId = "a1"),
      (v) => void ((v.summary as Record<string, unknown>).finished = "no"),
      (v) => void ((v.summary as Record<string, unknown>).live = -1),
      (v) => void ((v as Record<string, unknown>).summary = null),
      (v) => void ((v as Record<string, unknown>).creatorFirstName = 7),
    ]
    for (const [i, breakIt] of broken.entries()) {
      const v = creatorView()
      breakIt(v)
      expect(parseGroupView(v), `case ${i}`).toBeNull()
    }
    expect(parseGroupView(null)).toBeNull()
    expect(parseGroupView([creatorView()])).toBeNull()
  })

  it("keeps the feed's photo rows readable with the new use key", () => {
    const page = parseContributionsPage({
      nextCursor: null,
      items: [
        {
          type: "photo",
          key: `p:${A1}`,
          at: "2026-11-12T10:00:00Z",
          assetId: A1,
          venueName: "The Bell",
          uploadState: "ready",
          labels: {
            hasLabels: true,
            needsLabels: false,
            needsAttention: false,
          },
          menuDecisions: [],
          menuUseAccepted: false,
          use: { state: "granted", destinations: ["Website"] },
          futureKey: 1,
        },
      ],
    })
    expect(page?.items[0]).toMatchObject({
      use: { state: "granted", destinations: ["Website"] },
    })
  })
})

describe("parseGroupReplace", () => {
  it("reads the replacement and refuses anything else", () => {
    const ok = { groupId: GROUP, assetId: A3, replacesAssetId: A1, position: 4 }
    expect(parseGroupReplace({ ...ok, extra: true })).toEqual(ok)
    expect(parseGroupReplace({ ...ok, position: 0 })).toBeNull()
    expect(parseGroupReplace({ ...ok, replacesAssetId: null })).toBeNull()
    expect(parseGroupReplace(4)).toBeNull()
  })
})

describe("group read and replace services", () => {
  it("reads a group and refuses a bad id without the database", async () => {
    rpc.knowledgeRpc.mockResolvedValueOnce({ data: creatorView(), error: null })
    expect(await workServices.getGroup(actor, GROUP)).toEqual({
      status: "ok",
      value: creatorView(),
    })
    expect(rpc.knowledgeRpc).toHaveBeenCalledWith(
      actor.db,
      "contribution_group",
      {
        p_group_id: GROUP,
      }
    )
    expect(await workServices.getGroup(actor, "g1")).toMatchObject({
      status: "failed",
      failure: { code: "invalid_input" },
    })
    rpc.knowledgeRpc.mockResolvedValueOnce({
      data: { groupId: GROUP },
      error: null,
    })
    expect(await workServices.getGroup(actor, GROUP)).toMatchObject({
      status: "failed",
      failure: { code: "unavailable" },
    })
    expect(rpc.knowledgeRpc).toHaveBeenCalledTimes(2)
  })

  it("replaces one for one, missing before B05-m5, and checks ids first", async () => {
    const result = {
      groupId: GROUP,
      assetId: A3,
      replacesAssetId: A1,
      position: 3,
    }
    rpc.knowledgeRpc.mockResolvedValueOnce({ data: result, error: null })
    expect(
      await workServices.replaceInGroup(actor, {
        groupId: GROUP,
        failedAssetId: A1,
        newAssetId: A3,
      })
    ).toEqual({ status: "ok", value: result })
    expect(rpc.knowledgeRpc).toHaveBeenCalledWith(
      actor.db,
      "contribution_group_replace",
      { p_group_id: GROUP, p_failed_asset_id: A1, p_new_asset_id: A3 }
    )
    rpc.knowledgeRpc.mockResolvedValueOnce({
      data: null,
      error: { code: "PGRST202" },
    })
    expect(
      await workServices.replaceInGroup(actor, {
        groupId: GROUP,
        failedAssetId: A1,
        newAssetId: A3,
      })
    ).toEqual({ status: "missing" })
    for (const input of [
      { groupId: GROUP, failedAssetId: A1, newAssetId: A1 },
      { groupId: GROUP, failedAssetId: "x", newAssetId: A3 },
      { groupId: null, failedAssetId: A1, newAssetId: A3 },
    ])
      expect(
        await workServices.replaceInGroup(actor, input as never)
      ).toMatchObject({ status: "failed", failure: { code: "invalid_input" } })
    expect(rpc.knowledgeRpc).toHaveBeenCalledTimes(2)
  })
})

describe("set Server Functions (B05-m5)", () => {
  it("read and replace as the uploader, with the entry on", async () => {
    rpc.knowledgeRpc.mockResolvedValueOnce({ data: creatorView(), error: null })
    expect(await readPhotoSet({ groupId: GROUP })).toEqual({
      status: "ok",
      group: creatorView(),
    })
    expect(auth.getMediaActor).toHaveBeenCalledWith(["staff", "manager"])
    const result = {
      groupId: GROUP,
      assetId: A3,
      replacesAssetId: A1,
      position: 3,
    }
    rpc.knowledgeRpc.mockResolvedValueOnce({ data: result, error: null })
    expect(
      await replaceInPhotoSet({
        groupId: GROUP,
        failedAssetId: A1,
        newAssetId: A3,
      })
    ).toEqual({ status: "ok", ...result })
    rpc.knowledgeRpc.mockResolvedValueOnce({
      data: null,
      error: { code: "P0001" },
    })
    expect(
      await replaceInPhotoSet({
        groupId: GROUP,
        failedAssetId: A1,
        newAssetId: A3,
      })
    ).toEqual({
      status: "failed",
      retry: false,
      // No reason: set words, not the shared mapping's fallback.
      refusal: {
        code: "state_conflict",
        message: "This set of photos changed. Reload the page.",
      },
    })
    // The server's refusal reaches the screen with its reason.
    for (const failure of [
      { code: "asset_ineligible", assetId: A1, assetReason: "not_replaceable" },
      { code: "asset_ineligible", assetId: A3, assetReason: "in_group" },
      { code: "state_conflict", setReason: "already_replaced" },
      { code: "state_conflict", setReason: "set_full" },
    ]) {
      server.knowledgeRpcFailure.mockReturnValueOnce({
        ok: false,
        status: 409,
        message: "refused",
        ...failure,
      } as never)
      rpc.knowledgeRpc.mockResolvedValueOnce({
        data: null,
        error: { code: "P0001" },
      })
      const reply = await replaceInPhotoSet({
        groupId: GROUP,
        failedAssetId: A1,
        newAssetId: A3,
      })
      expect(reply).toEqual({
        status: "failed",
        retry: false,
        refusal: {
          code: failure.code,
          message: "refused",
          reason: failure.assetReason ?? failure.setReason,
          ...(failure.assetId ? { assetId: failure.assetId } : {}),
        },
      })
    }
    // A read that may work later says so, with its code.
    server.knowledgeRpcFailure.mockReturnValueOnce({
      ok: false,
      code: "unavailable",
      status: 503,
      message: "down",
    } as never)
    rpc.knowledgeRpc.mockResolvedValueOnce({
      data: null,
      error: { code: "08006" },
    })
    expect(await readPhotoSet({ groupId: GROUP })).toEqual({
      status: "failed",
      retry: true,
      refusal: {
        code: "unavailable",
        message:
          "This set of photos couldn't be loaded or changed right now. Try again shortly.",
      },
    })
  })

  it("never reads or replaces for a non-uploader, or with the entry off", async () => {
    auth.getMediaActor.mockResolvedValueOnce({
      ok: false,
      status: 403,
      message: "no",
    })
    expect(await readPhotoSet({ groupId: GROUP })).toEqual({
      status: "failed",
      retry: false,
    })
    process.env.NABALENS_CONTRIBUTION_ENTRY = "b01"
    expect(
      await replaceInPhotoSet({
        groupId: GROUP,
        failedAssetId: A1,
        newAssetId: A3,
      })
    ).toEqual({ status: "missing" })
    expect(rpc.knowledgeRpc).not.toHaveBeenCalled()
  })
})

describe("replacement refusals", () => {
  it("maps not_replaceable and in_group to asset_ineligible with their reason", () => {
    for (const reason of ["not_replaceable", "in_group"] as const)
      expect(
        knowledgeRpcFailure(
          {
            code: "P0001",
            message: "evidence_not_eligible",
            details: JSON.stringify({ assetId: A1, reason }),
          },
          "t"
        )
      ).toMatchObject({
        code: "asset_ineligible",
        status: 409,
        assetId: A1,
        assetReason: reason,
      })
  })

  it("tells the set refusals that share state_conflict apart, with set wording", () => {
    const full = knowledgeRpcFailure(
      { code: "P0001", message: "contribution_group_full" },
      "contribution group replace"
    )
    expect(full).toMatchObject({
      code: "state_conflict",
      status: 409,
      setReason: "set_full",
    })
    // True for the live cap and the 30-position limit alike.
    expect(full.message).not.toMatch(/10|30/)
    expect(
      knowledgeRpcFailure(
        { code: "P0001", message: "contribution_group_full" },
        "contribution group add"
      )
    ).toEqual(full)
    expect(
      knowledgeRpcFailure(
        { code: "P0001", message: "asset_in_other_group", details: "{}" },
        "contribution group replace"
      )
    ).toMatchObject({ code: "state_conflict", setReason: "in_other_group" })
    const replaced = knowledgeRpcFailure(
      { code: "P0001", message: "idempotency_key_reused" },
      "contribution group replace"
    )
    expect(replaced).toMatchObject({
      code: "state_conflict",
      setReason: "already_replaced",
    })
    expect(replaced.message).toMatch(/already replaced/)
    // Elsewhere the code keeps its own mapping.
    const elsewhere = knowledgeRpcFailure(
      { code: "P0001", message: "idempotency_key_reused" },
      "knowledge submit"
    )
    expect(elsewhere.code).toBe("state_conflict")
    expect(elsewhere).not.toHaveProperty("setReason")
    expect(elsewhere.message).not.toBe(replaced.message)
  })
})
