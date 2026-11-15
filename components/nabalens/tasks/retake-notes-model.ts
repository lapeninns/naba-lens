// Which retake notes each surface shows (G-3; decisions 4, 12 and 14). Pure
// and free of "use client", so the Home page, the shell badge and the block
// itself all filter the same way.

import type { RetakeNote } from "@/lib/server/coverage/types"

import { RETAKE_COPY } from "./copy"

/** What the note is about: the dish, the job's title, or the month. */
export function retakeNoteTitle(note: RetakeNote): string {
  if (note.dish)
    return note.dish.variantName
      ? `${note.dish.itemName} (${note.dish.variantName})`
      : note.dish.itemName
  return note.requirement?.title ?? RETAKE_COPY.monthPhoto
}

/** Home shows open notes that can be retaken now, newest first. */
export const homeRetakeNotes = (notes: readonly RetakeNote[]) =>
  notes.filter((note) => note.status === "open" && note.canRetake)

/** Me keeps every note until it clears, set aside or not. */
export const meRetakeNotes = (notes: readonly RetakeNote[]) =>
  notes.filter((note) => note.status !== "cleared")

/** The key a note is drawn and chosen by on Home. */
export const retakeNoteKey = (note: Pick<RetakeNote, "kind" | "noteId">) =>
  `${note.kind}:${note.noteId}`
