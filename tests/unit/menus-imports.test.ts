// B04-e (b04-design §8; task B04-05): the import server functions check
// inputs before calling the database and map its codes to plain messages;
// today's activation path maps the new guard code. The database behaviour is
// pinned by tests/security/menus-imports-b04.test.ts. Synthetic values only.
import { describe, expect, it, vi } from "vitest"

import { menuRpcFailure } from "@/lib/server/menus/errors"
import {
  confirmRelease,
  decideTradingProposal,
  importDryRun,
  importsRpcFailure,
} from "@/lib/server/menus/imports"
import type { MediaActor } from "@/lib/server/media/types"

const ID = "11111111-1111-4111-8111-111111111111"
const KEY = "33333333-3333-4333-8333-333333333333"

function actorWith(handler: () => object = () => ({})) {
  const rpc = vi.fn(async () => {
    const out = handler() as { data?: unknown; error?: unknown }
    return { data: out.data ?? null, error: out.error ?? null }
  })
  const db = { rpc }
  return {
    actor: { db, service: db, profile: { id: "p" } } as unknown as MediaActor,
    rpc,
  }
}

describe("input checks", () => {
  it("needs an amount exactly when editing", async () => {
    const { actor, rpc } = actorWith()
    for (const input of [
      { decision: "edited", amount: null },
      { decision: "accepted", amount: "9.95" },
      { decision: "maybe", amount: null },
    ])
      expect(
        await decideTradingProposal(actor, {
          proposalId: ID,
          expectedRevision: 1,
          requestKey: KEY,
          ...(input as { decision: "edited"; amount: string | null }),
        })
      ).toMatchObject({ ok: false, status: 400 })
    expect(rpc).not.toHaveBeenCalled()
  })

  it("passes an edited amount as text, and a confirmation needs a full hash", async () => {
    const { actor, rpc } = actorWith(() => ({ data: { decision: "edited" } }))
    await decideTradingProposal(actor, {
      proposalId: ID,
      expectedRevision: 2,
      decision: "edited",
      amount: " 9.95 ",
      requestKey: KEY,
    })
    expect(rpc).toHaveBeenCalledWith("menu_trading_proposal_decide", {
      p_proposal: ID,
      p_expected_revision: 2,
      p_decision: "edited",
      p_value: { amount: "9.95" },
      p_request_key: KEY,
    })
    expect(
      await confirmRelease(actor, {
        releaseId: ID,
        expectedHash: "abc",
        requestKey: KEY,
      })
    ).toMatchObject({ ok: false, status: 409 })
  })

  it("returns already_imported as a result, not a failure", async () => {
    const { actor } = actorWith(() => ({
      data: { status: "already_imported", runId: ID },
    }))
    expect(
      await importDryRun(actor, { snapshotId: ID, requestKey: KEY })
    ).toMatchObject({
      ok: true,
      result: { status: "already_imported", runId: ID, replayed: false },
    })
  })
})

describe("error mapping", () => {
  it.each([
    ["import_base_changed", 409, "Compare again"],
    ["menu_release_stale", 409, "confirm them again"],
    ["crosswalk_not_run", 409, "crosswalk"],
    ["menu_trading_proposal_unmapped", 409, "not matched"],
    ["menu_trading_conflict", 409, "changed elsewhere"],
  ] as const)("%s", (message, status, text) => {
    const out = importsRpcFailure({ message, code: "P0001" }, "test")
    expect(out.status).toBe(status)
    expect(out.message).toContain(text)
  })

  it("maps the activation guard on today's path", () => {
    expect(
      menuRpcFailure(
        { message: "menu_release_required", code: "P0001" },
        "activate"
      )
    ).toMatchObject({
      status: 409,
      message: expect.stringContaining("price release"),
    })
  })
})
