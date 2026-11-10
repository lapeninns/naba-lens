import { describe, expect, it } from "vitest"

import {
  DELETE_IMPACT_UNCHECKED,
  deleteWarning,
} from "@/components/nabalens/delete-impact/copy"
import type { DeleteImpactItem } from "@/lib/work-client/contract"

const VENUE = "The Old Crown"
const QUESTION = "Is there step-free access?"

function item(over: Partial<DeleteImpactItem>): DeleteImpactItem {
  return {
    kind: "answer_in_use",
    effect: "none",
    venueName: VENUE,
    question: QUESTION,
    yours: true,
    ...over,
  }
}

function warn(...items: DeleteImpactItem[]) {
  return deleteWarning({ status: "known", items })
}

describe("deleteWarning (HM-04)", () => {
  it("words withdrawn for mine and not mine", () => {
    expect(warn(item({ effect: "withdrawn" }))).toEqual({
      lines: [
        "It's evidence for your answer to “Is there step-free access?” at The Old Crown. Deleting it takes that answer out of use until it's checked again.",
      ],
      confirmLabel: "Delete anyway",
    })
    expect(warn(item({ effect: "withdrawn", yours: false })).lines).toEqual([
      "It's evidence for an answer at The Old Crown to “Is there step-free access?”. Deleting it takes that answer out of use until it's checked again.",
    ])
  })

  it("words needs_recheck for mine and not mine", () => {
    expect(warn(item({ effect: "needs_recheck" }))).toEqual({
      lines: [
        "Your answer to “Is there step-free access?” at The Old Crown needs this photo as evidence. Without it, the question goes back to be checked again.",
      ],
      confirmLabel: "Delete anyway",
    })
    expect(warn(item({ effect: "needs_recheck", yours: false })).lines).toEqual(
      [
        "An answer at The Old Crown to “Is there step-free access?” needs this photo as evidence. Without it, the question goes back to be checked again.",
      ]
    )
  })

  it("says nothing for an answer that keeps enough evidence", () => {
    expect(warn(item({ effect: "none" }))).toEqual({
      lines: [],
      confirmLabel: "Delete",
    })
  })

  it("says an earlier answer keeps it in history", () => {
    expect(warn(item({ kind: "earlier_answer", effect: "none" }))).toEqual({
      lines: [
        "It stays, hidden, in the history of your earlier answer to “Is there step-free access?” at The Old Crown.",
      ],
      confirmLabel: "Delete",
    })
  })

  it("asks 'anyway' for my pending finding only (D14)", () => {
    const pending = {
      kind: "pending_finding",
      effect: "pending_loses_evidence",
    } as const
    expect(warn(item(pending))).toEqual({
      lines: [
        "Your finding on “Is there step-free access?” at The Old Crown is waiting for a manager. Without this photo it may not be confirmed; if you still delete it, send the finding again with another photo.",
      ],
      confirmLabel: "Delete anyway",
    })
    expect(warn(item({ ...pending, yours: false }))).toEqual({
      lines: [
        "It's evidence for a finding being decided at The Old Crown on “Is there step-free access?”. Without it, that finding may not be confirmed.",
      ],
      confirmLabel: "Delete",
    })
  })

  it("keeps one line per item, in the read's order", () => {
    const lines = warn(
      item({ effect: "withdrawn", yours: false }),
      item({ kind: "earlier_answer", effect: "none" })
    ).lines
    expect(lines).toHaveLength(2)
    expect(lines[0]).toMatch(/^It's evidence for an answer at/)
  })

  it("keeps today's dialog for an unused photo", () => {
    expect(warn()).toEqual({ lines: [], confirmLabel: "Delete" })
  })

  it("never guesses when the read failed or can't be worded", () => {
    const unchecked = {
      lines: [DELETE_IMPACT_UNCHECKED],
      confirmLabel: "Delete",
    }
    expect(deleteWarning(null)).toEqual(unchecked)
    expect(deleteWarning({ status: "unknown" })).toEqual(unchecked)
  })
})
