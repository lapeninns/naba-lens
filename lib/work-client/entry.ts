import type { WorkingSlot } from "@/lib/knowledge-client/contract"

import type { VenueCapabilities } from "./contract"

// The shared entry's choices (UI design §4.1), in display order.
export const ENTRY_INTENTS = [
  "dish",
  "task",
  "question",
  "change",
  "photos",
] as const
export type EntryIntent = (typeof ENTRY_INTENTS)[number]

export type EntryContext = {
  /** The venue has an open working list. */
  hasWorkingList: boolean
  /** At least one working-list question has an answer to report a change on. */
  hasAnsweredQuestions: boolean
  /** The person has task assignments to send photos for. */
  hasTasks: boolean
}

/**
 * Only the choices the caller can complete. Null when capabilities couldn't
 * be read: the caller keeps today's entry for its shell (R8 fallback).
 */
export function entryIntents(
  capabilities: VenueCapabilities | null,
  context: EntryContext
): EntryIntent[] | null {
  if (!capabilities) return null
  const { canUpload, canLabel, canSendFindings, canBeAssigned } = capabilities
  const offered: Record<EntryIntent, boolean> = {
    // A dish photo is an upload with a dish label preset.
    dish: canUpload && canLabel,
    task: canUpload && canBeAssigned && context.hasTasks,
    question: canSendFindings && context.hasWorkingList,
    change: canSendFindings && context.hasAnsweredQuestions,
    photos: canUpload,
  }
  return ENTRY_INTENTS.filter((intent) => offered[intent])
}

// ---- The entry's choices for one person (§4.1) -------------------------------

/** One working-list question a choice opens. */
export type EntryQuestion = { checkId: string; question: string }

/** What the intent step offers, read on the server for one person. */
export type EntryMenu = {
  venueName: string
  intents: EntryIntent[]
  /** Tasks the person can send photos to now. */
  tasks: { id: string; title: string }[]
  /** Questions to answer, open ones first. */
  questions: EntryQuestion[]
  /** Answered questions a change can be reported on (change mode, B01-03). */
  answered: EntryQuestion[]
}

type EntrySlot = Pick<
  WorkingSlot,
  "checkId" | "question" | "mode" | "progress" | "answerInUse"
>

type EntryTask = {
  requirement: { id: string; title: string }
  canSubmit: boolean
}

/**
 * The intent step for one person, or null when capabilities couldn't be
 * read or nothing can be offered: the caller keeps today's Add.
 */
export function entryMenu(
  capabilities: VenueCapabilities | null,
  {
    venueName,
    slots,
    tasks,
  }: { venueName: string; slots: EntrySlot[]; tasks: EntryTask[] }
): EntryMenu | null {
  // Answered: staff get it in change mode, managers in answer mode.
  const change = (slot: EntrySlot) =>
    slot.mode !== "none" &&
    slot.progress === "complete" &&
    slot.answerInUse.value !== null
  const questions = slots
    .filter((slot) => slot.mode !== "none" && !change(slot))
    // Stable: open questions first, each group in the list's own order.
    .map((slot, index) => ({ slot, index }))
    .sort(
      (a, b) =>
        Number(a.slot.progress === "complete") -
          Number(b.slot.progress === "complete") || a.index - b.index
    )
    .map(({ slot }) => ({ checkId: slot.checkId, question: slot.question }))
  const answered = slots
    .filter(change)
    .map((slot) => ({ checkId: slot.checkId, question: slot.question }))
  const open = tasks
    .filter((task) => task.canSubmit)
    .map((task) => ({
      id: task.requirement.id,
      title: task.requirement.title,
    }))
  const intents = entryIntents(capabilities, {
    hasWorkingList: questions.length > 0,
    hasAnsweredQuestions: answered.length > 0,
    hasTasks: open.length > 0,
  })
  if (!intents || intents.length === 0) return null
  return { venueName, intents, tasks: open, questions, answered }
}

// ---- Return paths (§4.3) -------------------------------------------------------

/** `?from=` on capture pages: where to go back to after sending. */
export const ENTRY_FROM_PARAM = "from"

export type EntryOrigin = "home" | "menu" | "me" | "task"

const ID = /^[A-Za-z0-9-]{1,64}$/
// Pages under /staff/tasks that are not a task.
const NOT_TASKS = new Set(["amenities", "guide", "welcome"])

/**
 * The page a `from` value names, or null for anything not allow-listed:
 * the caller keeps today's destination. Always a relative /staff path.
 */
export function fromHref(
  value: string | null | undefined
): { origin: EntryOrigin; href: string } | null {
  if (value === "home") return { origin: "home", href: "/staff/tasks" }
  if (value === "menu") return { origin: "menu", href: "/staff/menu" }
  if (value === "me") return { origin: "me", href: "/staff" }
  if (value?.startsWith("task:")) {
    const id = value.slice("task:".length)
    if (ID.test(id) && !NOT_TASKS.has(id))
      return { origin: "task", href: `/staff/tasks/${id}` }
  }
  return null
}

/** The `from` value for the page someone is on, or null for any other page. */
export function entryFrom(pathname: string | null | undefined): string | null {
  if (pathname === "/staff/tasks") return "home"
  if (pathname === "/staff/menu") return "menu"
  if (pathname === "/staff") return "me"
  const task = /^\/staff\/tasks\/([^/]+)$/.exec(pathname ?? "")
  return task && fromHref(`task:${task[1]}`) ? `task:${task[1]}` : null
}

/** `href` with `from` added to its query (unchanged without one). */
export function withFrom(href: string, from: string | null): string {
  if (!from) return href
  const [base, hash = ""] = href.split("#", 2)
  const join = base.includes("?") ? "&" : "?"
  return `${base}${join}${ENTRY_FROM_PARAM}=${encodeURIComponent(from)}${hash ? `#${hash}` : ""}`
}
