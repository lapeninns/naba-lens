"use client"

import * as React from "react"

import { Button } from "@/components/ui/button"
import type {
  AnswerInUse,
  FindingSummary,
} from "@/lib/knowledge-client/contract"

import { StatusChip } from "../status-chip"
import {
  dateAndTime,
  FINDING_STATE_CHIP,
  findingExplanation,
  KNOWLEDGE_ANSWER_LABEL,
} from "./copy"

export const LATEST_FINDING_HEADING_ID = "latest-finding-heading"

/**
 * The staff question page after sending (design §4.6): my latest finding
 * above the form. While it is undecided the form waits behind "Change my
 * finding", so a second look doesn't read as an invitation to send again;
 * sending from it replaces the undecided one.
 */
export function LatestFinding({
  finding,
  inUse,
  answerWords = null,
  children,
}: {
  finding: FindingSummary
  inUse: AnswerInUse["value"]
  /**
   * The answer in use in words when this finding is that answer (a step-free
   * Yes names its entrances), so the panel doesn't repeat a bare Yes.
   */
  answerWords?: string | null
  /** The capture form. */
  children: React.ReactNode
}) {
  const undecided = finding.state === "awaiting_confirmation"
  const [changing, setChanging] = React.useState(false)
  const formRef = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    if (!changing) return
    // The button is gone: start at the form's first control.
    formRef.current
      ?.querySelector<HTMLElement>("input:not([type=hidden]), textarea, select")
      ?.focus()
  }, [changing])

  const compared =
    undecided && inUse && finding.answer
      ? inUse === finding.answer
        ? "same"
        : "differs"
      : "none"

  return (
    <>
      <section
        aria-labelledby={LATEST_FINDING_HEADING_ID}
        className="grid min-w-0 gap-2 rounded-card bg-surface p-4 shadow-card"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2
            id={LATEST_FINDING_HEADING_ID}
            className="font-display text-section-title text-ink"
          >
            Your latest finding
          </h2>
          <StatusChip state={FINDING_STATE_CHIP[finding.state]} />
        </div>
        {finding.answer ? (
          <p className="text-body text-ink">
            Answer: {answerWords ?? KNOWLEDGE_ANSWER_LABEL[finding.answer]}
          </p>
        ) : null}
        {finding.sentAt ? (
          <p className="text-meta text-ink-muted">
            Sent {dateAndTime(finding.sentAt)}
          </p>
        ) : null}
        <p className="text-body [overflow-wrap:anywhere] text-ink">
          {findingExplanation(finding, compared)}
        </p>
        {undecided && !changing ? (
          <Button
            type="button"
            variant="secondary"
            size="touch"
            className="justify-self-start max-sm:w-full"
            onClick={() => setChanging(true)}
          >
            Change my finding
          </Button>
        ) : null}
      </section>
      {!undecided || changing ? <div ref={formRef}>{children}</div> : null}
    </>
  )
}
