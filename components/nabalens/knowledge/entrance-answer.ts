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

/**
 * Whether the answer in use is the viewer's own finding: their latest
 * finding is the one in use (the server's `current` state), so its check
 * date is theirs. Anything else reads as someone's, never named.
 */
export function checkedByViewer(
  slot: Partial<Pick<WorkingSlot, "myLatest">>
): boolean {
  return slot.myLatest?.state === "current"
}
