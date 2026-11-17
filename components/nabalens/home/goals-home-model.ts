// Goal-led Home (goals-not-tasks G-1, decisions 9 to 12): what Home shows
// and which one action leads. Pure, so the page, the shell badge and the
// preview fixtures all decide the same way.

import type { MyAmenityTask } from "@/lib/amenities/contract"
import type { RecheckTask, WorkingSlot } from "@/lib/knowledge-client/contract"
import type { OurMenuItem, RetakeNote } from "@/lib/server/coverage/types"

import { slotRow } from "../knowledge/copy"
import { retakeNoteKey } from "../tasks/retake-notes-model"
import type { MyTasksView } from "../tasks/types"

export type { RetakeNote }

/** How many Still needed dishes Home lists before "See all". */
export const STILL_NEEDED_ON_HOME = 4

/**
 * Our menu on goal-led Home. `stillNeeded` is the first few dishes with no
 * accepted photo, in menu order; null when that list couldn't be read (the
 * totals still show). `needs_setup` is a person with no venue.
 */
export type OurMenuGoal =
  | {
      state: "ready"
      covered: number
      total: number
      gaps: number
      needsRecheck: number
      stillNeeded: OurMenuItem[] | null
    }
  | { state: "no_menu" | "empty" | "unavailable" | "needs_setup" }

/** Every dish and drink on the active menu has an accepted photo. */
export function menuComplete(menu: OurMenuGoal | null): boolean {
  return (
    menu?.state === "ready" &&
    menu.total > 0 &&
    menu.gaps === 0 &&
    menu.needsRecheck === 0
  )
}

/**
 * Decision 10: jobs that are not food and drink photos. Open non-menu
 * requirements I'm assigned to, amenity checks assigned to me, working list
 * questions that wait on me and my open rechecks (B03-e), each check once.
 * Menu sections are never counted.
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

/** Home's one main action (decision 12). */
export type GoalsPrimary =
  | { kind: "reshoot"; noteKey: string }
  | { kind: "dish"; itemId: string }
  | { kind: "add_photos" }
  | null

/**
 * Retake when a retake note is open, else the first Still needed dish, else
 * Add photos when the menu is complete. A person who may not add photos
 * gets no dish or Add photos action; a note still leads (it explains itself).
 * `notes` are the notes Home shows (`homeRetakeNotes`): open and retakeable.
 */
export function goalsPrimary({
  notes,
  menu,
  canAdd,
}: {
  notes: readonly RetakeNote[]
  menu: OurMenuGoal | null
  canAdd: boolean
}): GoalsPrimary {
  if (notes.length > 0)
    return { kind: "reshoot", noteKey: retakeNoteKey(notes[0]) }
  if (!canAdd) return null
  const first = menu?.state === "ready" ? menu.stillNeeded?.[0] : undefined
  if (first) return { kind: "dish", itemId: first.itemId }
  return menuComplete(menu) ? { kind: "add_photos" } : null
}

/** A card on Home that asks this person to act (the badge counts these). */
export type GoalsHomeCard =
  "setup" | "retake" | "labels" | "other_jobs" | "review_photos"

/**
 * The actionable cards on Home, in page order. Goals (Our menu, Your month)
 * and colleagues' photos are not cards to act on, and dishes are never
 * counted: a busy menu must not read as a long list of homework.
 */
export function goalsHomeCards({
  setupComplete,
  notes,
  labels = false,
  otherJobs,
  reviewCount,
}: {
  setupComplete: boolean
  /** The notes Home shows (`homeRetakeNotes`). */
  notes: readonly RetakeNote[]
  /** Decision 19: the person's own photos need labels (or a save failed). */
  labels?: boolean
  otherJobs: number
  reviewCount: number
}): GoalsHomeCard[] {
  const cards: GoalsHomeCard[] = []
  if (!setupComplete) cards.push("setup")
  if (notes.length > 0) cards.push("retake")
  if (labels) cards.push("labels")
  if (otherJobs > 0) cards.push("other_jobs")
  if (reviewCount > 0) cards.push("review_photos")
  return cards
}
