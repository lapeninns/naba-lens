// B02-b contribution group services (docs/knowledge/b02-design.md W1) with a
// mocked caller-scoped client: input checks before the database, error
// mapping, and My contributions photo rows gaining their group.
import { afterEach, describe, expect, it, vi } from "vitest"

import * as knowledge from "@/lib/server/knowledge"
import { knowledgeRpcFailure } from "@/lib/server/knowledge/errors"
import type { MediaActor } from "@/lib/server/media/types"

const GROUP = "99999999-9999-4999-8999-999999999999"
const ITEM = "33333333-3333-4333-8333-333333333333"
const A1 = "55555555-5555-4555-8555-555555555555"
const A2 = "66666666-6666-4666-8666-666666666666"

type Handler = (args: Record<string, unknown>) => {
  data?: unknown
  error?: { message?: string; code?: string; details?: string | null }
}

function actorWith(handlers: Record<string, Handler>) {
  const rpc = vi.fn(async (fn: string, args: Record<string, unknown> = {}) => {
    const handler = handlers[fn]
    if (!handler) throw new Error(`unexpected rpc ${fn}`)
    const out = handler(args)
    return { data: out.data ?? null, error: out.error ?? null }
  })
  const db = { rpc }
  return { actor: { db, service: db } as unknown as MediaActor, rpc }
}

afterEach(() => vi.restoreAllMocks())

describe("contribution groups (W1)", () => {
  it("starts a group for a subject and refuses bad input before the database", async () => {
    const { actor, rpc } = actorWith({
      contribution_group_start: () => ({ data: GROUP }),
    })
    expect(
      await knowledge.startContributionGroup(actor, {
        key: "TEST-group-1",
        subject: { kind: "menu_item", id: ITEM },
      })
    ).toEqual({ ok: true, groupId: GROUP })
    expect(rpc.mock.calls[0]![1]).toEqual({
      p_key: "TEST-group-1",
      p_subject_kind: "menu_item",
      p_subject_id: ITEM,
    })
    expect(
      await knowledge.startContributionGroup(actor, {
        key: "TEST-group-2",
        subject: { kind: "none" },
      })
    ).toMatchObject({ ok: true })
    expect(rpc.mock.calls[1]![1]).toMatchObject({ p_subject_id: null })
    for (const bad of [
      { key: "short", subject: { kind: "none" } },
      { key: "TEST-group-3", subject: { kind: "dish", id: ITEM } },
      { key: "TEST-group-3", subject: { kind: "task" } },
      { key: "TEST-group-3", subject: { kind: "none", id: ITEM } },
      { key: "TEST-group-3" },
    ])
      expect(
        await knowledge.startContributionGroup(actor, bad),
        JSON.stringify(bad)
      ).toMatchObject({ code: "invalid_input" })
    expect(rpc).toHaveBeenCalledTimes(2)
  })

  it("adds up to 10 distinct photos", async () => {
    const { actor, rpc } = actorWith({
      contribution_group_add: () => ({ data: 2 }),
    })
    expect(
      await knowledge.addToContributionGroup(actor, {
        groupId: GROUP,
        assetIds: [A1, A2],
      })
    ).toEqual({ ok: true, members: 2 })
    const many = Array.from(
      { length: 11 },
      (_, i) => `55555555-5555-4555-8555-${String(i).padStart(12, "0")}`
    )
    for (const assetIds of [[], [A1, A1], many, ["nope"]])
      expect(
        await knowledge.addToContributionGroup(actor, {
          groupId: GROUP,
          assetIds,
        })
      ).toMatchObject({ code: "invalid_input" })
    expect(
      await knowledge.addToContributionGroup(actor, { groupId: "x" })
    ).toMatchObject({ code: "not_found" })
    expect(rpc).toHaveBeenCalledTimes(1)
  })

  it("maps every group refusal to a non-retryable 4xx", () => {
    const cases: [string, string, string, number][] = [
      ["P0002", "contribution_group_not_found", "not_found", 404],
      ["P0002", "contribution_subject_not_found", "not_found", 404],
      ["P0001", "asset_in_other_group", "state_conflict", 409],
      ["P0001", "contribution_group_full", "state_conflict", 409],
      ["P0001", "idempotency_key_reused", "state_conflict", 409],
      ["22023", "invalid_group_key", "invalid_input", 400],
      ["22023", "invalid_subject", "invalid_input", 400],
      ["42501", "not_active_staff", "not_permitted", 403],
      ["P0001", "invalid_asset_list", "invalid_input", 400],
    ]
    for (const [code, message, mapped, status] of cases)
      expect(
        knowledgeRpcFailure({ code, message }, "t"),
        message
      ).toMatchObject({
        code: mapped,
        status,
      })
    expect(
      knowledgeRpcFailure(
        {
          code: "P0001",
          message: "evidence_not_eligible",
          details: JSON.stringify({ assetId: A1, reason: "not_own" }),
        },
        "t"
      )
    ).toMatchObject({
      code: "asset_ineligible",
      assetId: A1,
      assetReason: "not_own",
    })
  })

  it("adds groupId to My contributions photo rows, and survives a failed lookup", async () => {
    const photo = (assetId: string) => ({
      type: "photo",
      key: `p:${assetId}`,
      assetId,
    })
    const page = {
      items: [photo(A1), photo(A2), { type: "finding", key: "c:1" }],
      nextCursor: null,
    }
    const ok = actorWith({
      my_contributions_feed: () => ({ data: page }),
      contribution_groups_for_assets: (args) => {
        expect(args).toEqual({ p_asset_ids: [A1, A2] })
        return { data: [{ asset_id: A1, group_id: GROUP }] }
      },
    })
    const out = await knowledge.listMyContributions(ok.actor, {})
    expect(out).toMatchObject({
      ok: true,
      page: {
        items: [
          { assetId: A1, groupId: GROUP },
          { assetId: A2, groupId: null },
          { type: "finding" },
        ],
      },
    })
    if (out.ok) expect(out.page.items[2]).not.toHaveProperty("groupId")

    vi.spyOn(console, "error").mockImplementation(() => {})
    const failing = actorWith({
      my_contributions_feed: () => ({ data: page }),
      contribution_groups_for_assets: () => ({
        error: { code: "PGRST202", message: "Could not find the function" },
      }),
    })
    const fallback = await knowledge.listMyContributions(failing.actor, {})
    expect(fallback).toEqual({ ok: true, page })
  })
})
