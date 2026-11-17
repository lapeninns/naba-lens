// Other jobs (goals-not-tasks decision 10): how many jobs wait on the person
// that are not food and drink photos. Pure, so Album Home, Me and the tests
// count the same way.

import type { MyAmenityTask } from "@/lib/amenities/contract"
import type { RecheckTask, WorkingSlot } from "@/lib/knowledge-client/contract"

import { slotRow } from "../knowledge/copy"
import type { MyTasksView } from "./types"

/**
 * Open non-menu requirements I'm assigned to, amenity checks assigned to me,
 * working list questions that wait on me and my open rechecks (B03-e), each
 * check once. Menu sections are never counted.
 */
export function otherJobsCount({
  tasks,
  amenityTasks,
  slots,
  rechecks = null,
}: {
  tasks: Pick<MyTasksView, "assignments"> | null
  amenityTasks: readonly MyAmenityTask[] | null
  slots: readonly WorkingSlot[] | null
  rechecks?: readonly RecheckTask[] | null
}): number {
  const requirements = (tasks?.assignments ?? []).filter(
    (a) =>
      a.requirement.kind !== "menu_section" &&
      a.canSubmit &&
      !a.requirement.progress.satisfied
  ).length
  const checks = new Set((amenityTasks ?? []).map((task) => task.id))
  for (const slot of slots ?? [])
    if (slotRow(slot).needsMe) checks.add(slot.checkId)
  for (const task of rechecks ?? []) checks.add(task.checkId)
  return requirements + checks.size
}
