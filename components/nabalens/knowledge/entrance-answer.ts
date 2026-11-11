// A step-free entrance Yes in use, in words (B03 UI design §2.3 S1, §3.5):
// the entrances saved as Step-free are in the same sentence as the Yes, from
// the venue's own Places read. When a label can't be read the sentence names
// no place and never reads as a Yes for the whole venue. Other headlines,
// keys and answers from before the question had detail keep their words.

import type { AnswerInUse, WorkingSlot } from "@/lib/knowledge-client/contract"

import { ACCESS_COPY } from "./accessibility-detail"

export const ENTRANCE_ANSWER_COPY = {
  unnamed: "Yes, at an entrance this screen can't name",
} as const

function joinLabels(labels: readonly string[]): string {
  return labels.length > 1
    ? `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`
    : (labels[0] ?? "")
}

/** A step-free Yes in use with recorded detail; never a qualified answer. */
export function isStepFreeYes(
  answer: AnswerInUse
): answer is AnswerInUse & { stepFreeEntranceIds: string[] } {
  return (
    answer.status === "available" &&
    answer.value === "yes" &&
    !answer.qualified &&
    Array.isArray(answer.stepFreeEntranceIds)
  )
}

/**
 * "Yes, at ⟨Main entrance⟩", "Yes, at ⟨Garden gate⟩ and ⟨Side door⟩", or the
 * unnamed fallback. Null when this isn't a step-free Yes with detail.
 */
export function stepFreeAnswerWords(answer: AnswerInUse): string | null {
  if (!isStepFreeYes(answer)) return null
  const labels = answer.entranceLabels
  return labels?.length && labels.length === answer.stepFreeEntranceIds.length
    ? `Yes, at ${joinLabels(labels)}`
    : ENTRANCE_ANSWER_COPY.unnamed
}

/** The S3 line for a named step-free Yes; null otherwise. */
export function stepFreeCoversLine(answer: AnswerInUse): string | null {
  const words = stepFreeAnswerWords(answer)
  if (!words || words === ENTRANCE_ANSWER_COPY.unnamed) return null
  return ACCESS_COPY.covers(joinLabels(answer.entranceLabels!))
}

/** Contributions whose observation date is their sender's own check. */
const OBSERVED_BY_SENDER = new Set(["finding", "change_report", "detail"])

/**
 * Whether the viewer made the check the answer in use is dated from: their
 * latest contribution is the one in use (the server's `current` state) and
 * it is their own observation. A correction is the corrector's contribution
 * but carries the original observer's date, and an import is no one's check,
 * so both read as someone's, never named.
 */
export function checkedByViewer(
  slot: Partial<Pick<WorkingSlot, "myLatest">>,
  answer: Pick<AnswerInUse, "source">
): boolean {
  const mine = slot.myLatest
  return (
    mine?.state === "current" &&
    OBSERVED_BY_SENDER.has(mine.kind) &&
    (answer.source === undefined ||
      answer.source === "staff_finding" ||
      answer.source === "manager_statement")
  )
}
