import { describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

import { stateConflictKind } from "@/lib/knowledge-client/contract"
import { knowledgeRpcFailure } from "@/lib/server/knowledge"

// WS1 reports these state conflicts by message only. Pinning the classifier
// to WS1's own mapper means a reworded message fails here (L4).
describe("stateConflictKind", () => {
  it.each([
    ["idempotency_key_reused", "reused_key"],
    ["amenity_check_archived", "archived"],
    ["knowledge_not_current", "other"],
    ["invalid_responds_to", "other"],
  ] as const)("reads WS1's %s as %s", (message, kind) => {
    const failure = knowledgeRpcFailure({ message }, "test")
    expect(failure.code).toBe("state_conflict")
    expect(stateConflictKind(failure)).toBe(kind)
  })

  it("is null for anything that isn't a state conflict", () => {
    expect(
      stateConflictKind({ code: "revision_conflict", message: "x" })
    ).toBeNull()
  })
})
