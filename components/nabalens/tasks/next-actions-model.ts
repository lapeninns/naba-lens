// Other jobs' recheck cards (B03-e): each open recheck task as its check's
// card, with the server's cause.

import {
  ANSWER_LABEL,
  PROGRESS_LABEL,
  type MyAmenityTask,
} from "@/lib/amenities/contract"
import type { RecheckTask, WorkingSlot } from "@/lib/knowledge-client/contract"

import { recheckCauseLine } from "../knowledge/copy"

/** One amenity check as its card shows it, from the working list or the old list. */
export type CheckCard = {
  checkId: string
  question: string
  category: string
  evidenceRule: MyAmenityTask["entry"]["evidenceRule"]
  chip: string
  recheckReason: string | null
  /** The card's action word, as the working list words it. */
  action: string
}

/** B03-e: an open recheck task as its check's card, with the server's cause. */
function recheckCard(
  task: RecheckTask,
  slot: WorkingSlot | undefined,
  assigned: ReadonlyMap<string, MyAmenityTask>
): CheckCard {
  const previous = slot?.answerInUse.value ?? slot?.previousAnswer ?? null
  return {
    checkId: task.checkId,
    question: task.question,
    category:
      slot?.category ?? assigned.get(task.checkId)?.entry.category ?? "",
    evidenceRule:
      slot?.evidenceRule ??
      assigned.get(task.checkId)?.entry.evidenceRule ??
      "photo",
    chip: PROGRESS_LABEL.needs_recheck,
    recheckReason: recheckCauseLine(task, {
      previous: previous ? ANSWER_LABEL[previous] : null,
    }),
    action: "Recheck",
  }
}

/**
 * Other jobs: my open recheck tasks as check cards, in due order.
 */
export function recheckCards({
  rechecks,
  slots = [],
  amenityChecks = [],
}: {
  rechecks: readonly RecheckTask[]
  slots?: readonly WorkingSlot[]
  amenityChecks?: readonly MyAmenityTask[]
}): CheckCard[] {
  const bySlot = new Map(slots.map((slot) => [slot.checkId, slot]))
  const assigned = new Map(amenityChecks.map((task) => [task.id, task]))
  return [...rechecks]
    .sort((a, b) => a.dueAt.localeCompare(b.dueAt))
    .map((task) => recheckCard(task, bySlot.get(task.checkId), assigned))
}
