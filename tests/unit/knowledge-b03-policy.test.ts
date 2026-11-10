// B03-c policy and qualified answers (docs/knowledge/b03-design.md §3.8,
// §5, A4, A19, A21): the value-list service, the legacy check views for a
// qualified answer, and the error mapping. Mocked RPC client.
import { describe, expect, it, vi } from "vitest"

import type { CheckRow, SubmissionRow } from "@/lib/amenities/contract"
import {
  checkPermissions,
  checkSummary,
  myTasks,
  submissionViews,
} from "@/lib/server/amenities/views"
import type { Access } from "@/lib/server/coverage/context"
import * as knowledge from "@/lib/server/knowledge"
import { knowledgeRpcFailure } from "@/lib/server/knowledge/errors"
import type { MediaActor } from "@/lib/server/media/types"

vi.mock("server-only", () => ({}))

function actorWith(handlers: Record<string, (args: object) => object>) {
  const rpc = vi.fn(async (fn: string, args: object = {}) => {
    const handler = handlers[fn]
    if (!handler) throw new Error(`unexpected rpc ${fn}`)
    const out = handler(args) as { data?: unknown; error?: unknown }
    return { data: out.data ?? null, error: out.error ?? null }
  })
  const db = { rpc }
  return { actor: { db, service: db } as unknown as MediaActor, rpc }
}

const VENUE = "33333333-3333-4333-8333-333333333333"
const USER = "55555555-5555-4555-8555-555555555555"

function row(over: Partial<CheckRow> = {}): CheckRow {
  return {
    id: "44444444-4444-4444-8444-444444444444",
    venue_id: VENUE,
    template_key: "guest_toilets",
    category: "Facilities",
    question: "Are there guest toilets?",
    capture_brief: "Photo of the sign",
    evidence_rule: "photo",
    is_core: true,
    position: 1,
    catalogue_version: 1,
    status: "active",
    progress: "complete",
    answer: "yes",
    current_submission_id: "66666666-6666-4666-8666-666666666666",
    assignee_user_id: USER,
    assignee_name: "Sam Staff",
    answered_by: USER,
    answered_by_name: "Sam Staff",
    answered_at: "2026-11-10T10:00:00Z",
    recheck_reason: null,
    notes: null,
    revision: 3,
    updated_at: "2026-11-10T10:00:00Z",
    ...over,
  }
}

const manager: Access = {
  userId: "77777777-7777-4777-8777-777777777777",
  isAdmin: false,
  isStaff: false,
  isManager: true,
  venueId: null,
  venueActive: true,
  department: null,
  managerVenueId: VENUE,
}

describe("legacy check views for a qualified answer (A19, A21)", () => {
  const qualified = row({
    progress: "needs_recheck",
    recheck_reason: "Temporarily unavailable. Check whether it is back.",
    qualification: "temporarily_unavailable",
  })

  it("carry the qualification only when set, keeping today's shape otherwise", () => {
    expect(checkSummary(qualified)).toMatchObject({
      progress: "needs_recheck",
      qualification: "temporarily_unavailable",
    })
    expect(checkSummary(row())).not.toHaveProperty("qualification")
    expect(checkSummary(row({ qualification: null }))).not.toHaveProperty(
      "qualification"
    )
  })

  it("keep Reopen for a qualified answer, which is stored complete", () => {
    expect(checkPermissions(qualified, manager).canReopen).toBe(true)
    expect(checkPermissions(row(), manager).canReopen).toBe(true)
    expect(
      checkPermissions(row({ progress: "needs_recheck" }), manager).canReopen
    ).toBe(false)
  })

  it("never make a qualified answer a staff task", () => {
    expect(myTasks([qualified], USER)).toEqual([])
    expect(myTasks([row({ progress: "needs_recheck" })], USER)).toHaveLength(1)
  })

  it("mark a qualified submission", () => {
    const sub = (over: Partial<SubmissionRow>): SubmissionRow => ({
      id: "66666666-6666-4666-8666-666666666666",
      check_id: "44444444-4444-4444-8444-444444444444",
      answer: "yes",
      finding: null,
      limitations: null,
      reason: null,
      submitted_by: USER,
      submitted_by_name: "Sam Staff",
      created_at: "2026-11-10T10:00:00Z",
      template_version: 1,
      evidence_rule: "photo",
      internal_metadata: null,
      ...over,
    })
    const [q] = submissionViews(
      [sub({ qualification: "conditional" })],
      [],
      null
    )
    expect(q).toMatchObject({ qualification: "conditional" })
    const [plain] = submissionViews([sub({ qualification: null })], [], null)
    expect(plain).not.toHaveProperty("qualification")
  })
})

describe("value lists (A4, A9)", () => {
  it("read one named list, refusing any other name without a call", async () => {
    const valueList = { list: "policy_condition_types", items: [] }
    const { actor, rpc } = actorWith({
      knowledge_value_list: () => ({ data: valueList }),
    })
    expect(
      await knowledge.getValueList(actor, { list: "policy_condition_types" })
    ).toEqual({ ok: true, valueList })
    expect(rpc.mock.calls[0]![1]).toEqual({ p_list: "policy_condition_types" })
    for (const bad of [{ list: "colours" }, {}, null])
      expect(await knowledge.getValueList(actor, bad)).toMatchObject({
        code: "invalid_input",
        fieldErrors: { list: expect.any(String) },
      })
    expect(rpc).toHaveBeenCalledTimes(1)
  })
})

describe("B03-c errors", () => {
  it("map to non-retryable 4xx codes", () => {
    expect(
      knowledgeRpcFailure({ code: "22023", message: "invalid_value_list" }, "t")
    ).toMatchObject({
      code: "invalid_input",
      fieldErrors: { list: expect.any(String) },
    })
    // An admin rule or an organisation-scope policy refuses a manager's confirm.
    expect(
      knowledgeRpcFailure({ code: "42501", message: "not_active_admin" }, "t")
    ).toMatchObject({ code: "not_permitted", status: 403 })
  })
})
