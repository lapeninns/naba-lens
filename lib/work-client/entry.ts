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
