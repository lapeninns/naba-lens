"use client"

import * as React from "react"

import { Notice } from "@/components/nabalens/notice"
import { OptionSelect } from "@/components/nabalens/option-select"
import { useSessionEndedCatch } from "@/components/nabalens/session-guard-host"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { FormField } from "@/components/ui/field"
import { OptionRow } from "@/components/ui/option-row"
import { RadioGroup } from "@/components/ui/radio-group"
import { Textarea } from "@/components/ui/textarea"
import {
  REPORT_COPY,
  REPORT_NOTE_MAX,
  reasonsFor,
  reportProblem,
  type SlotReportKind,
  type SlotReportReason,
} from "@/lib/staff/slot-reports"

/** A slot the person can choose, when the sheet is opened for a place. */
export type ReportSubject = {
  kind: SlotReportKind
  subjectId: string
  name: string
}

export type ReportSender = (input: {
  kind: SlotReportKind
  subjectId: string
  reason: SlotReportReason
  note: string
}) => Promise<{ ok: true; created: boolean } | { ok: false; error: string }>

/*
 * Report a change (spec §6 S3) and Ask for a correction (§6 S4): a short
 * choice of what changed, an optional note (needed for Something else), and
 * Send to your manager. One sheet for both (catalogue: ReportChangeDialog).
 * The answer is written in the sheet and, once sent, on the page that opened
 * it (DESIGN.md §6.7): nothing changes until a manager checks it.
 */
export function ReportChangeDialog({
  open,
  onOpenChange,
  subject,
  choices,
  send,
  onSent,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The slot or photo the report is about; leave out to choose from `choices`. */
  subject?: ReportSubject
  /** Slots to choose from (a place's), when no subject is given. */
  choices?: ReportSubject[]
  send: ReportSender
  /** Called after a report is stored (or one was already open). */
  onSent: (created: boolean, subject: ReportSubject) => void
}) {
  const [chosen, setChosen] = React.useState<string | null>(null)
  const picked =
    subject ??
    choices?.find((c) => `${c.kind}:${c.subjectId}` === chosen) ??
    null
  const kind: SlotReportKind = picked?.kind ?? subject?.kind ?? "dish"
  const [reason, setReason] = React.useState<SlotReportReason | null>(null)
  const [note, setNote] = React.useState("")
  const [error, setError] = React.useState<string | null>(null)
  const [pending, setPending] = React.useState(false)
  const sessionEnded = useSessionEndedCatch()
  const photo = kind === "photo"
  const labelId = React.useId()

  // Closing clears the sheet, so it opens empty next time.
  const reset = () => {
    setChosen(null)
    setReason(null)
    setNote("")
    setError(null)
  }
  const change = (next: boolean) => {
    if (!next) reset()
    onOpenChange(next)
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!picked) {
      setError(REPORT_COPY.chooseSlot)
      return
    }
    const problem = reportProblem(kind, reason, note)
    if (problem) {
      setError(problem)
      return
    }
    setPending(true)
    setError(null)
    try {
      const result = await send({
        kind,
        subjectId: picked.subjectId,
        reason: reason!,
        note: note.trim(),
      })
      if (!result.ok) {
        setError(result.error)
        return
      }
      onSent(result.created, picked)
      change(false)
    } catch (cause) {
      setError(sessionEnded(cause) ?? REPORT_COPY.failed)
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={change}>
      <DialogContent data-slot="report-change-dialog">
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>
              {photo ? REPORT_COPY.photoTitle : REPORT_COPY.slotTitle}
            </DialogTitle>
            <DialogDescription>
              {subject ? (
                <>
                  <strong className="text-ink">{subject.name}</strong>.{" "}
                </>
              ) : null}
              {photo ? REPORT_COPY.photoIntro : REPORT_COPY.slotIntro}
            </DialogDescription>
          </DialogHeader>
          {!subject && choices ? (
            <FormField label={REPORT_COPY.slotLabel}>
              <OptionSelect
                options={choices.map((c) => ({
                  id: `${c.kind}:${c.subjectId}`,
                  name: c.name,
                }))}
                value={chosen}
                onValueChange={(value) => {
                  setChosen(value)
                  setReason(null)
                  setError(null)
                }}
                placeholder={REPORT_COPY.chooseSlot}
              />
            </FormField>
          ) : null}
          <div className="grid gap-2">
            <p id={labelId} className="text-label text-ink">
              {photo ? REPORT_COPY.photoReasonLabel : REPORT_COPY.reasonLabel}
            </p>
            <RadioGroup<SlotReportReason>
              aria-labelledby={labelId}
              // "" matches no radio: controlled from the start, none chosen.
              value={reason ?? ("" as SlotReportReason)}
              onValueChange={(value) => {
                setReason(value as SlotReportReason)
                setError(null)
              }}
            >
              {reasonsFor(kind).map((r) => (
                <OptionRow
                  key={r.key}
                  type="radio"
                  value={r.key}
                  label={r.label}
                  size="md"
                />
              ))}
            </RadioGroup>
          </div>
          <FormField
            label={REPORT_COPY.noteLabel}
            optional={reason !== "other"}
          >
            <Textarea
              value={note}
              maxLength={REPORT_NOTE_MAX}
              rows={3}
              onChange={(e) => setNote(e.target.value)}
            />
          </FormField>
          {error ? (
            <Notice tone="negative" role="alert">
              {error}
            </Notice>
          ) : null}
          <DialogFooter showCloseButton>
            <Button type="submit" variant="primary" loading={pending}>
              {REPORT_COPY.send}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
