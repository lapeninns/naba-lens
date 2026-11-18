"use client"

import { useState, useTransition } from "react"
import Link from "next/link"
import { CheckIcon } from "@phosphor-icons/react/dist/ssr"

import { decideSlotReportAction } from "@/app/manager/venue/actions"
import { Button } from "@/components/ui/button"
import { FormField } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  DECISION_NOTE_MAX,
  REPORT_KIND_WORDS,
  reportSubjectHref,
  type SlotReportDecision,
} from "@/lib/manager/slot-reports"
import { reasonWords, type SlotReport } from "@/lib/staff/slot-reports"

/*
 * S3-R5 (K3): Venue › Reported changes (spec §6 S3, S4, §7 M5). Staff told
 * the manager that a slot or one of their photos has changed. A report never
 * changes anything by itself: the manager opens the dish, space, facility or
 * photo to change it, then marks the report dealt with, or dismisses it, with
 * an optional note. A decided row stays and says what happened in place, so
 * the outcome is announced (DESIGN.md §6.7); the page drops it on the next
 * visit.
 */

export const SLOT_REPORTS_COPY = {
  resolve: "Dealt with",
  dismiss: "Dismiss",
  saving: "Saving",
  note: "Note",
  resolved: "Marked as dealt with.",
  dismissed: "Dismissed. Nothing was changed.",
  failed: "That didn't save. Reload the page and try again.",
  open: (kind: string) => `Open ${kind.toLowerCase()}`,
  reportedBy: (name: string | null, when: string) =>
    `Reported by ${name ?? "a team member"} on ${when}`,
} as const

type Decide = (
  input: unknown
) => Promise<{ ok: true } | { ok: false; message?: string }>

const when = (iso: string) =>
  new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    day: "numeric",
    month: "short",
  }).format(new Date(iso))

function Row({ report, onDecide }: { report: SlotReport; onDecide: Decide }) {
  const [note, setNote] = useState("")
  const [done, setDone] = useState<SlotReportDecision | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()
  const [choice, setChoice] = useState<SlotReportDecision | null>(null)
  const kind = REPORT_KIND_WORDS[report.subjectKind]

  function decide(action: SlotReportDecision) {
    setChoice(action)
    start(async () => {
      setError(null)
      const result = await onDecide({
        reportId: report.id,
        action,
        note: note.trim() || undefined,
      })
      if (result.ok) setDone(action)
      else setError(result.message || SLOT_REPORTS_COPY.failed)
    })
  }

  return (
    <li
      data-report={report.id}
      data-state={done ?? "open"}
      className="grid gap-3 rounded-card bg-surface p-4 edge"
    >
      <div className="grid min-w-0 gap-1">
        <p className="text-label [overflow-wrap:anywhere] text-ink">
          {report.subjectName}
        </p>
        <p className="text-body text-ink">
          {kind} · {reasonWords(report.reason)}
        </p>
        {report.note ? (
          <p className="text-body [overflow-wrap:anywhere] text-ink-muted">
            “{report.note}”
          </p>
        ) : null}
        <p className="text-body text-ink-muted">
          {SLOT_REPORTS_COPY.reportedBy(
            report.reporterName,
            when(report.createdAt)
          )}
        </p>
        <Link
          href={reportSubjectHref(report)}
          aria-label={`${SLOT_REPORTS_COPY.open(kind)}: ${report.subjectName}`}
          className="inline-flex min-h-12 items-center justify-self-start rounded-control text-body font-semibold text-accent-text underline underline-offset-4 focus-ring"
        >
          {SLOT_REPORTS_COPY.open(kind)}
        </Link>
      </div>
      {done ? (
        <p role="status" className="flex items-center gap-2 text-body text-ink">
          <CheckIcon aria-hidden className="size-5 shrink-0 text-ok-fg" />
          {done === "resolved"
            ? SLOT_REPORTS_COPY.resolved
            : SLOT_REPORTS_COPY.dismissed}
        </p>
      ) : (
        <div className="grid gap-3">
          <FormField label={SLOT_REPORTS_COPY.note} optional>
            <Input
              value={note}
              maxLength={DECISION_NOTE_MAX}
              onChange={(event) => setNote(event.target.value)}
              disabled={pending}
            />
          </FormField>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              className="max-sm:w-full"
              loading={pending && choice === "resolved"}
              loadingLabel={SLOT_REPORTS_COPY.saving}
              disabled={pending}
              aria-label={`${SLOT_REPORTS_COPY.resolve}: ${report.subjectName}`}
              onClick={() => decide("resolved")}
            >
              <CheckIcon data-icon="inline-start" aria-hidden />
              {SLOT_REPORTS_COPY.resolve}
            </Button>
            <Button
              variant="quiet"
              className="max-sm:w-full"
              loading={pending && choice === "dismissed"}
              loadingLabel={SLOT_REPORTS_COPY.saving}
              disabled={pending}
              aria-label={`${SLOT_REPORTS_COPY.dismiss}: ${report.subjectName}`}
              onClick={() => decide("dismissed")}
            >
              {SLOT_REPORTS_COPY.dismiss}
            </Button>
          </div>
          {error ? (
            <p role="alert" className="text-body text-warn-fg">
              {error}
            </p>
          ) : null}
        </div>
      )}
    </li>
  )
}

export function SlotReportsList({
  reports,
  label,
  empty,
  onDecide = decideSlotReportAction,
}: {
  reports: SlotReport[]
  /** Accessible name of the list. */
  label: string
  /** Shown when there was nothing to decide on arrival. */
  empty: string
  onDecide?: Decide
}) {
  // Held from the first render: a decision refreshes the page, whose list no
  // longer has the decided report, and its row must keep saying what
  // happened. The page drops it on the next visit.
  const [rows] = useState(reports)
  if (rows.length === 0)
    return <p className="text-body text-ink-muted">{empty}</p>
  return (
    <ul aria-label={label} className="grid gap-2">
      {rows.map((report) => (
        <Row key={report.id} report={report} onDecide={onDecide} />
      ))}
    </ul>
  )
}
