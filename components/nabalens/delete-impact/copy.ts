// The photo delete dialog's warning lines (UI design §8.8, HM-04), worded from
// WS1's delete-impact read. Each line describes the answer as it was when the
// dialog opened; items that aren't the person's own carry only the venue and
// the question.

import type { DeleteImpact, ImpactLine } from "@/lib/work-client/contract"

export const DELETE_IMPACT_UNCHECKED =
  "We couldn't check whether this photo is evidence for a venue answer."

function line(item: ImpactLine): string | null {
  const q = `“${item.question}”`
  const venue = item.venueName
  switch (item.effect) {
    case "withdrawn":
      return item.yours
        ? `It's evidence for your answer to ${q} at ${venue}. Deleting it takes that answer out of use until it's checked again.`
        : `It's evidence for an answer at ${venue} to ${q}. Deleting it takes that answer out of use until it's checked again.`
    case "needs_recheck":
      return item.yours
        ? `Your answer to ${q} at ${venue} needs this photo as evidence. Without it, the question goes back to be checked again.`
        : `An answer at ${venue} to ${q} needs this photo as evidence. Without it, the question goes back to be checked again.`
    case "pending_loses_evidence":
      return item.yours
        ? `Your finding on ${q} at ${venue} is waiting for a manager. Without this photo it may not be confirmed; if you still delete it, send the finding again with another photo.`
        : `It's evidence for a finding being decided at ${venue} on ${q}. Without it, that finding may not be confirmed.`
    case "none":
      // An answer in use keeps enough evidence: nothing to say.
      return item.kind === "earlier_answer"
        ? `It stays, hidden, in the history of your earlier answer to ${q} at ${venue}.`
        : null
  }
}

export type DeleteWarning = {
  lines: string[]
  confirmLabel: "Delete" | "Delete anyway"
}

/**
 * Null `impact` means the read failed: today's dialog plus the unchecked
 * line. An empty list keeps today's dialog unchanged.
 */
export function deleteWarning(impact: DeleteImpact | null): DeleteWarning {
  if (!impact || impact.status === "unknown")
    return { lines: [DELETE_IMPACT_UNCHECKED], confirmLabel: "Delete" }
  const lines = impact.items.flatMap((item) => line(item) ?? [])
  // D14: an own pending finding losing its evidence also asks "anyway".
  const serious = impact.items.some(
    (item) =>
      item.effect === "withdrawn" ||
      item.effect === "needs_recheck" ||
      (item.effect === "pending_loses_evidence" && item.yours)
  )
  return { lines, confirmLabel: serious ? "Delete anyway" : "Delete" }
}
