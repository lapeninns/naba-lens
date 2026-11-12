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
