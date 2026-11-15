// Goal-led Home (goals-not-tasks G-1, decisions 9 to 12): what Home shows
// and which one action leads. Pure, so the page, the shell badge and the
// preview fixtures all decide the same way.

import type { MyAmenityTask } from "@/lib/amenities/contract"
import type { WorkingSlot } from "@/lib/knowledge-client/contract"
import type { OurMenuItem } from "@/lib/server/coverage/types"

import { slotRow } from "../knowledge/copy"
import type { RetakeRequest } from "../tasks/next-actions-model"
import type { MyTasksView, SubmissionView } from "../tasks/types"

/** How many Still needed dishes Home lists before "See all". */
export const STILL_NEEDED_ON_HOME = 4

/**
 * A retake note (v0.5 §2): a reviewer asked this person for another photo.
 * `menu` is a menu photo of a dish they can retake now; `send` is a photo
 * they sent to the month or to a non-menu job. G-3 replaces how these are
 * read (`my_retake_notes()`); the slot takes them as props either way.
 */
export type RetakeNote =
  | { kind: "menu"; key: string; request: RetakeRequest }
  | { kind: "send"; key: string; submission: SubmissionView }

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
 * Open retake notes: menu notes first (newest decision first, as read), then
 * coverage "needs another photo" requests on a job that is still open to me.
 */
export function retakeNotes({
  retakes,
  tasks,
}: {
  retakes: readonly RetakeRequest[] | null
  tasks: Pick<MyTasksView, "assignments" | "needsAnotherPhoto"> | null
}): RetakeNote[] {
  const notes: RetakeNote[] = (retakes ?? []).map((request) => ({
    kind: "menu",
    key: `menu:${request.photoId}`,
    request,
  }))
  if (!tasks) return notes
  const open = new Set(
    tasks.assignments.filter((a) => a.canSubmit).map((a) => a.requirement.id)
  )
  for (const submission of tasks.needsAnotherPhoto) {
    // A closed job needs no replacement, so it asks nothing of anyone.
    if (submission.requirement && !open.has(submission.requirement.id)) continue
    notes.push({ kind: "send", key: `send:${submission.id}`, submission })
  }
  return notes
}

/**
 * Decision 10: jobs that are not food and drink photos. Open non-menu
 * requirements I'm assigned to, amenity checks assigned to me, and working
 * list questions that wait on me. Menu sections are never counted.
 */
export function otherJobsCount({
  tasks,
  amenityTasks,
  slots,
}: {
  tasks: Pick<MyTasksView, "assignments"> | null
  amenityTasks: readonly MyAmenityTask[] | null
  slots: readonly WorkingSlot[] | null
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
  return requirements + checks.size
}

/** Home's one main action (decision 12). */
export type GoalsPrimary =
  | { kind: "reshoot"; noteKey: string }
  | { kind: "dish"; itemId: string }
  | { kind: "open_camera" }
  | null

/**
 * Reshoot when a retake note is open, else the first Still needed dish, else
 * Open camera when the menu is complete. A person who may not add photos
 * gets no dish or camera action; a note still leads (it explains itself).
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
  if (notes.length > 0) return { kind: "reshoot", noteKey: notes[0].key }
  if (!canAdd) return null
  const first = menu?.state === "ready" ? menu.stillNeeded?.[0] : undefined
  if (first) return { kind: "dish", itemId: first.itemId }
  return menuComplete(menu) ? { kind: "open_camera" } : null
}

/** A card on Home that asks this person to act (the badge counts these). */
export type GoalsHomeCard = "setup" | "retake" | "other_jobs" | "review_photos"

/**
 * The actionable cards on Home, in page order. Goals (Our menu, Your month)
 * and colleagues' photos are not cards to act on, and dishes are never
 * counted: a busy menu must not read as a long list of homework.
 */
export function goalsHomeCards({
  setupComplete,
  notes,
  otherJobs,
  reviewCount,
}: {
  setupComplete: boolean
  notes: readonly RetakeNote[]
  otherJobs: number
  reviewCount: number
}): GoalsHomeCard[] {
  const cards: GoalsHomeCard[] = []
  if (!setupComplete) cards.push("setup")
  if (notes.length > 0) cards.push("retake")
  if (otherJobs > 0) cards.push("other_jobs")
  if (reviewCount > 0) cards.push("review_photos")
  return cards
}
