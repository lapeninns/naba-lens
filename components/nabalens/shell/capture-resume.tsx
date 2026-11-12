"use client"

// B05-05d: what Add offers for uploads that didn't finish in an earlier tab
// (OD-B5-05-10, OD-B5-05-11), and the probe line (OD-B5-05-3). The journal
// is reached through a context so tests can inject one.

import * as React from "react"

import { Button } from "@/components/ui/button"
import {
  getCaptureJournal,
  type CaptureSession,
} from "@/lib/upload/capture-session"
import { sameLabelChoice } from "@/components/nabalens/upload-label-drafts"
import type { SaveLabelsInput } from "@/lib/menus/types"
import { resumeAction, type JournalEntry } from "@/lib/upload/journal"

/** Opens the signed-in account's capture journal (null: none on this page). */
export type CaptureJournalSource = (
  userId: string
) => Promise<CaptureSession | null>

export const CaptureJournalContext =
  React.createContext<CaptureJournalSource>(getCaptureJournal)

export const CAPTURE_COPY = {
  /** §5.2 item 7: the probe refused bytes. Never promises a background upload. */
  keepOpen:
    "This browser can't keep your photos if the page closes. Keep this page open until they're saved.",
  continueLine: (name: string) => `${name} didn't finish.`,
  reselectLine: (name: string) =>
    `${name} didn't finish. Choose it again from Add; it continues where it stopped.`,
  chooseDifferentLine: (name: string) =>
    `${name} can't be used. Choose a different photo.`,
  /** finalise_refused: access ended, not a bad file (UP-03 wording). */
  signInAgainLine: (name: string) =>
    `${name} didn't finish. Sign in again here, then choose it again from Add.`,
  continue: "Continue",
  continueLabel: (name: string) => `Continue ${name}`,
  heading: "Didn't finish",
} as const

/**
 * What Add's resume block lists (OD-B5-05-10, K3/K5): Add's own uploads only
 * (general purpose, a dish or no subject; task and question uploads belong
 * to their screens and are left out, to expire or go at sign-out), less those
 * the server is finalising (it finishes them), those whose asset this tab's
 * queue holds, and those this tab picked.
 */
export function resumableEntries(
  entries: readonly JournalEntry[],
  heldAssetIds: ReadonlySet<string>,
  tabEntryIds: ReadonlySet<string>
): JournalEntry[] {
  return entries.filter(
    (entry) =>
      entry.purpose === "general" &&
      (entry.subject.kind === "menu_item" || entry.subject.kind === "none") &&
      entry.state !== "finalising" &&
      !(entry.assetId && heldAssetIds.has(entry.assetId)) &&
      !tabEntryIds.has(entry.id)
  )
}

/** The line for one entry, from resumeAction (§5.4). */
export function resumeLine(entry: JournalEntry): string {
  const action = resumeAction(entry)
  const name = entry.displayName
  if (action.kind === "continue") return CAPTURE_COPY.continueLine(name)
  if (action.kind === "reselect") return CAPTURE_COPY.reselectLine(name)
  return action.code === "finalise_refused"
    ? CAPTURE_COPY.signInAgainLine(name)
    : CAPTURE_COPY.chooseDifferentLine(name)
}

/** One block in the Add sheet: each unfinished upload, with Continue where its bytes are here. */
export function CaptureResumeBlock({
  entries,
  onContinue,
}: {
  entries: readonly JournalEntry[]
  onContinue: (entry: JournalEntry) => void
}) {
  if (entries.length === 0) return null
  return (
    <section
      aria-label={CAPTURE_COPY.heading}
      data-capture-resume=""
      className="grid gap-2 rounded-card bg-surface-2 p-3"
    >
      <ul className="grid gap-2">
        {entries.map((entry) => (
          <li
            key={entry.id}
            className="flex min-w-0 flex-wrap items-center gap-2"
          >
            <p className="min-w-0 flex-1 text-body [overflow-wrap:anywhere] text-ink">
              {resumeLine(entry)}
            </p>
            {resumeAction(entry).kind === "continue" ? (
              <Button
                variant="secondary"
                size="sm"
                aria-label={CAPTURE_COPY.continueLabel(entry.displayName)}
                onClick={() => onContinue(entry)}
              >
                {CAPTURE_COPY.continue}
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  )
}

/** Labels kept for an entry until the server confirms them. */
export type JournalLabels = { venueId: string; input: SaveLabelsInput }

/**
 * M3: what the journal keeps for a file's label choice now: the latest
 * choice, or nothing once the choice is empty.
 */
export function journalLabels(
  venueId: string,
  input: SaveLabelsInput
): JournalLabels | undefined {
  return sameLabelChoice(input, undefined) ? undefined : { venueId, input }
}

/**
 * M3: whether a confirmed send clears the journal's labels: only when what
 * the server took is the choice the journal holds (a later choice still
 * waits for its own confirmation).
 */
export function sendClearsLabels(
  held: unknown,
  sent: SaveLabelsInput
): boolean {
  const input = (held as JournalLabels | undefined)?.input
  return !input || sameLabelChoice(input, sent)
}

/**
 * Keeps the journal's label copy in step with the label store (M3, N2, N3):
 * which file each reserved asset is, and what was last sent for it. A
 * confirmed send or a discard clears the journal's copy only when it still
 * holds that same choice. Files are forgotten when their upload ends, when
 * removed, when the queue clears and on another account, never on a label
 * confirmation (a later change or discard must still reach the entry).
 */
export function createLabelJournal(
  annotate: (file: File, patch: { pendingLabels?: unknown }) => void,
  read: (file: File) => { pendingLabels?: unknown } | undefined
) {
  const files = new Map<string, File>()
  const sent = new Map<string, SaveLabelsInput>()
  const clearIfHeld = (
    assetId: string,
    choice: SaveLabelsInput | undefined
  ) => {
    const file = files.get(assetId)
    if (!file || !choice) return
    if (sendClearsLabels(read(file)?.pendingLabels, choice))
      annotate(file, { pendingLabels: undefined })
  }
  return {
    reserved(assetId: string, file: File) {
      files.set(assetId, file)
      // Bounded, oldest first.
      while (files.size > 100) {
        const oldest = files.keys().next().value!
        files.delete(oldest)
        sent.delete(oldest)
      }
    },
    /** A send to the server is about to go. */
    sending(input: SaveLabelsInput) {
      sent.set(input.assetId, input)
    },
    /** The server took `input` (staged, or on the photo). */
    confirmed(input: SaveLabelsInput) {
      clearIfHeld(input.assetId, input)
    },
    /** The server discarded what it kept for the asset (the last send). */
    discarded(assetId: string) {
      clearIfHeld(assetId, sent.get(assetId))
    },
    forgetAsset(assetId: string) {
      files.delete(assetId)
      sent.delete(assetId)
    },
    forgetFile(file: File) {
      for (const [assetId, f] of files)
        if (f === file) {
          files.delete(assetId)
          sent.delete(assetId)
        }
    },
    clear() {
      files.clear()
      sent.clear()
    },
    size: () => files.size,
  }
}

/**
 * N4: whether the panel's emission for a row is its choice yet. A continued
 * row's first emission is empty until its seed has reached the panel; that
 * empty one must not clear the labels being sent.
 */
export function panelChoiceCounts(
  input: SaveLabelsInput,
  awaitingSeed: boolean,
  seeded: SaveLabelsInput | undefined
): boolean {
  if (!awaitingSeed) return true
  return (
    !sameLabelChoice(input, undefined) || !sameLabelChoice(seeded, undefined)
  )
}
