// Home's next actions on the B02 layout (UI design §2, §3.1): every piece of
// work that waits on this person becomes one card with a stable key, so the
// lists below To do can leave it out and only count it.

import { PROGRESS_LABEL, type MyAmenityTask } from "@/lib/amenities/contract"
import type { WorkingSlot } from "@/lib/knowledge-client/contract"
import type { LabelWork } from "@/lib/work-client/contract"
import { orderTodo, type TodoEntry } from "@/lib/work-client/todo"

import { slotRow } from "../knowledge/copy"
import type { MyAssignment, MyTasksView, SubmissionView } from "./types"

const DUE_SOON_MS = 7 * 24 * 60 * 60 * 1000

export const checkKey = (checkId: string) => `check:${checkId}`
export const taskKey = (requirementId: string) => `task:${requirementId}`

/** A better photo a reviewer asked for, of a dish still on the menu (D13). */
export type RetakeRequest = {
  photoId: string
  itemId: string
  variantId: string | null
  itemName: string
  variantName: string | null
  reason: string | null
}

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

export type NextAction = TodoEntry &
  (
    | { kind: "replacement"; submission: SubmissionView; closed: boolean }
    | { kind: "retake"; request: RetakeRequest }
    | { kind: "finding"; slot: WorkingSlot }
    | { kind: "recheck" | "check"; check: CheckCard }
    | { kind: "overdue" | "due_soon"; assignment: MyAssignment }
    | { kind: "labels"; work: LabelWork }
    | { kind: "setup" }
    | { kind: "review_photos"; count: number }
  )

export type NextActionInputs = {
  tasks: Pick<MyTasksView, "scope" | "assignments" | "needsAnotherPhoto">
  now?: Date
  reviewCount?: number
  /** Amenity checks assigned to me (the old list's read). */
  amenityChecks?: readonly MyAmenityTask[]
  /** My venue's working list rows; empty when the venue has none. */
  slots?: readonly WorkingSlot[]
  retakes?: readonly RetakeRequest[]
  /** Null when the labels card is hidden (can't label, or no B02 read). */
  labels?: LabelWork | null
}

function checkFromTask(task: MyAmenityTask, action: string): CheckCard {
  return {
    checkId: task.id,
    question: task.entry.question,
    category: task.entry.category,
    evidenceRule: task.entry.evidenceRule,
    chip: PROGRESS_LABEL[task.progress],
    recheckReason:
      task.progress === "needs_recheck" ? task.recheckReason : null,
    action,
  }
}

function isOpenAndUnfinished(a: MyAssignment) {
  return a.canSubmit && !a.requirement.progress.satisfied
}

/**
 * To do in the D1 order. Working-list rows that need me (`slotRow().needsMe`)
 * come here and nowhere else; assigned checks off the working list join them.
 */
export function nextActions({
  tasks,
  now = new Date(),
  reviewCount = 0,
  amenityChecks = [],
  slots = [],
  retakes = [],
  labels = null,
}: NextActionInputs): NextAction[] {
  const { scope, assignments, needsAnotherPhoto } = tasks
  const openTaskIds = new Set(
    assignments.filter((a) => a.canSubmit).map((a) => a.requirement.id)
  )
  const replacing = new Set(
    needsAnotherPhoto.flatMap((s) => (s.requirement ? [s.requirement.id] : []))
  )
  const assigned = new Map(amenityChecks.map((task) => [task.id, task]))
  const entries: NextAction[] = []

  if (!scope.setup.complete)
    entries.push({
      key: "setup",
      kind: "setup",
      members: 1,
      blocking: !scope.canSubmit,
    })
  for (const submission of needsAnotherPhoto) {
    const closed =
      submission.requirement !== null &&
      !openTaskIds.has(submission.requirement.id)
    entries.push({
      key: `replacement:${submission.id}`,
      kind: "replacement",
      // A closed replacement needs nothing, so it isn't counted.
      members: closed ? 0 : 1,
      submission,
      closed,
    })
  }
  for (const request of retakes)
    entries.push({
      key: `retake:${request.photoId}`,
      kind: "retake",
      members: 1,
      request,
    })

  for (const slot of slots) {
    const row = slotRow(slot)
    if (!row.needsMe) continue
    const key = checkKey(slot.checkId)
    if (slot.myLatest?.state === "needs_attention") {
      entries.push({ key, kind: "finding", members: 1, slot })
      continue
    }
    const task = assigned.get(slot.checkId)
    const action = row.action ?? "Start check"
    entries.push({
      key,
      kind: slot.progress === "needs_recheck" ? "recheck" : "check",
      members: 1,
      check: task
        ? checkFromTask(task, action)
        : {
            checkId: slot.checkId,
            question: slot.question,
            category: slot.category,
            evidenceRule: slot.evidenceRule,
            chip: PROGRESS_LABEL[slot.progress],
            recheckReason: null,
            action,
          },
    })
  }
  // A check on the working list is that list's row (above), whatever it says.
  const onList = new Set(slots.map((slot) => slot.checkId))
  for (const task of amenityChecks) {
    if (onList.has(task.id)) continue
    entries.push({
      key: checkKey(task.id),
      kind: task.progress === "needs_recheck" ? "recheck" : "check",
      members: 1,
      check: checkFromTask(task, "Start check"),
    })
  }

  const pending = assignments.filter(
    (a) => isOpenAndUnfinished(a) && !replacing.has(a.requirement.id)
  )
  for (const assignment of pending) {
    const { due, progress, id } = assignment.requirement
    const key = taskKey(id)
    if (progress.overdue)
      entries.push({ key, kind: "overdue", members: 1, assignment })
    else if (due && new Date(due.dueAt).getTime() - now.getTime() <= DUE_SOON_MS)
      entries.push({ key, kind: "due_soon", members: 1, assignment })
  }

  if (labels && labels.needsLabels + labels.needsAttention > 0)
    entries.push({
      key: "labels",
      kind: "labels",
      members: labels.needsLabels + labels.needsAttention,
      work: labels,
    })
  if (reviewCount > 0)
    entries.push({
      key: "review:photos",
      kind: "review_photos",
      members: reviewCount,
      count: reviewCount,
    })

  return orderTodo(entries)
}

/**
 * The assignments To do already stands for: overdue and due-soon cards, and
 * a task with an open replacement card.
 */
export function tasksInTodo(actions: readonly NextAction[]): Set<string> {
  const keys = new Set<string>()
  for (const action of actions) {
    if (action.kind === "overdue" || action.kind === "due_soon")
      keys.add(action.key)
    else if (
      action.kind === "replacement" &&
      !action.closed &&
      action.submission.requirement
    )
      keys.add(taskKey(action.submission.requirement.id))
  }
  return keys
}
