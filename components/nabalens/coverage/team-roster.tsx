"use client"

import * as React from "react"
import Link from "next/link"
import { PencilSimpleIcon, UsersIcon } from "@phosphor-icons/react"

import { ProfileAvatar } from "@/components/nabalens/profile-avatar"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { departmentLabel } from "@/lib/config/departments"

import { CoverageNotice } from "./coverage-notice"
import { manageHrefs } from "./manage-nav"
import {
  COVERAGE_LIMITS,
  TARGET_SOURCE_LABEL,
  failureText,
  labelFor,
  firstDayOfPeriod,
  lastDayOfPeriod,
  localDateLabel,
  needsRefresh,
  plural,
} from "./copy"
import { CoverageBadge, NeedsSetupBadge, OverdueBadge } from "./coverage-badges"
import { PhotoProgress } from "./photo-progress"
import { ReasonField, useReportedFocus } from "./reason-dialog"
import type {
  CoverageResult,
  MonthlyProgress,
  PeriodKey,
  PeriodView,
  SetMonthlyTargetInput,
} from "./types"
import {
  REPORTED,
  type Reported,
  useCoverageAction,
} from "./use-coverage-action"

export type SetTargetHandler = (
  input: Omit<SetMonthlyTargetInput, "venueId">
) => Promise<CoverageResult<{ revision: number }>>

type PeriodTiming = "past" | "current" | "future"

function timingOf(period: PeriodKey, current: PeriodKey): PeriodTiming {
  return period < current ? "past" : period === current ? "current" : "future"
}

/** When a target change must carry a reason (current-month edits, any past month). */
export function targetReasonRequired(
  row: Pick<MonthlyProgress, "targetCount" | "source">,
  timing: PeriodTiming
): boolean {
  if (timing === "past") return true
  return (
    timing === "current" &&
    row.targetCount != null &&
    row.source !== "placeholder"
  )
}

function setupText(row: MonthlyProgress): string {
  const parts: string[] = []
  if (row.setupMissing.includes("team")) parts.push("no FOH/BOH team")
  if (row.setupMissing.includes("target")) parts.push("no monthly target")
  return `Needs setup: ${parts.join(" and ")}`
}

function TargetDialog({
  row,
  period,
  timing,
  open,
  onOpenChange,
  onSave,
  reportFocus,
}: {
  row: MonthlyProgress | null
  period: PeriodView
  timing: PeriodTiming
  open: boolean
  onOpenChange: (open: boolean) => void
  onSave: (values: {
    targetCount: number
    dueOn: string | null
    reason: string | null
  }) => Promise<
    | { ok: true }
    | {
        ok: false
        error: string
        fieldErrors?: Partial<Record<string, string>>
      }
    | Reported
  >
  /** Takes focus after a `REPORTED` close; the row may have gone. */
  reportFocus: () => HTMLElement | null
}) {
  const ids = React.useId()
  const { reportedRef, finalFocus } = useReportedFocus(reportFocus)
  const [count, setCount] = React.useState("")
  const [dueOn, setDueOn] = React.useState("")
  const [reason, setReason] = React.useState("")
  const [errors, setErrors] = React.useState<Partial<Record<string, string>>>(
    {}
  )
  const [error, setError] = React.useState<string | null>(null)
  const [pending, setPending] = React.useState(false)
  // Keyed by person and saved revision, so a refresh while the dialog is
  // open does not wipe what is being typed.
  const rowKey = row ? `${row.person.id}:${row.revision ?? "new"}` : null
  const [seed, setSeed] = React.useState<string | null>(null)
  if (open && row && seed !== rowKey) {
    setSeed(rowKey)
    setCount(row.targetCount != null ? String(row.targetCount) : "")
    setDueOn(row.due?.dueOn ?? lastDayOfPeriod(period.key))
    setReason("")
    setErrors({})
    setError(null)
  }
  const needsReason = row ? targetReasonRequired(row, timing) : false
  const min = firstDayOfPeriod(period.key)
  const max = lastDayOfPeriod(period.key)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    const found: Record<string, string> = {}
    const n = Number(count)
    if (!Number.isInteger(n) || n < 1 || n > COVERAGE_LIMITS.targetCountMax)
      found.targetCount = `Enter a whole number from 1 to ${COVERAGE_LIMITS.targetCountMax}.`
    if (dueOn && (dueOn < min || dueOn > max))
      found.dueOn = `Choose a date in ${period.label}.`
    if (needsReason && !reason.trim())
      found.reason = "Give a reason for this change."
    setErrors(found)
    if (Object.keys(found).length > 0) return
    setPending(true)
    setError(null)
    try {
      const outcome = await onSave({
        targetCount: n,
        dueOn: dueOn || null,
        reason: reason.trim() || null,
      })
      if (!outcome.ok && !("reported" in outcome)) {
        setError(outcome.error)
        setErrors(outcome.fieldErrors ?? {})
        return
      }
      reportedRef.current = !outcome.ok
      setSeed(null)
      onOpenChange(false)
    } catch {
      setError(
        "Could not reach the server. Check your connection and try again."
      )
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (pending) return
        if (!next) setSeed(null)
        onOpenChange(next)
      }}
    >
      <DialogContent className="sm:max-w-md" finalFocus={finalFocus}>
        <form onSubmit={submit} className="grid gap-4" noValidate>
          <DialogHeader>
            <DialogTitle className="break-words">
              {row?.person.displayName}: {period.label} target
            </DialogTitle>
            <DialogDescription>
              {timing === "past"
                ? "Correcting a past month is recorded with your reason. Accepted photos already credited stay credited."
                : "Only new photos the person uploads and submits in this month count once accepted."}
            </DialogDescription>
          </DialogHeader>
          <Field className="gap-1.5">
            <FieldLabel htmlFor={`${ids}-count`}>Photos this month</FieldLabel>
            <Input
              id={`${ids}-count`}
              type="number"
              inputMode="numeric"
              min={1}
              max={COVERAGE_LIMITS.targetCountMax}
              step={1}
              value={count}
              onChange={(e) => setCount(e.currentTarget.value)}
              aria-invalid={!!errors.targetCount || undefined}
              className="h-11 sm:h-9"
              disabled={pending}
            />
            {errors.targetCount ? (
              <FieldError>{errors.targetCount}</FieldError>
            ) : null}
          </Field>
          <Field className="gap-1.5">
            <FieldLabel htmlFor={`${ids}-due`}>Due date</FieldLabel>
            <Input
              id={`${ids}-due`}
              type="date"
              min={min}
              max={max}
              value={dueOn}
              onChange={(e) => setDueOn(e.currentTarget.value)}
              aria-invalid={!!errors.dueOn || undefined}
              aria-describedby={`${ids}-due-help`}
              className="h-11 sm:h-9"
              disabled={pending}
            />
            <FieldDescription id={`${ids}-due-help`}>
              UK date, defaults to {localDateLabel(max)}. An earlier date is for
              follow-up only; photos can still be submitted all month.
            </FieldDescription>
            {errors.dueOn ? <FieldError>{errors.dueOn}</FieldError> : null}
          </Field>
          {needsReason ? (
            <ReasonField
              id={`${ids}-reason`}
              label="Reason for the change"
              value={reason}
              onChange={setReason}
              error={errors.reason}
              disabled={pending}
            />
          ) : null}
          {error ? (
            <p role="alert" className="text-sm text-negative">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              size="touch"
              onClick={() => onOpenChange(false)}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              size="touch"
              disabled={pending}
              aria-busy={pending || undefined}
            >
              {pending ? "Saving…" : "Save target"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/**
 * Monthly participation for one venue: each person's target, accepted photos
 * and setup gaps. A missing target or team is "Needs setup", never complete.
 * Shows names, avatars, teams and progress only.
 */
export function TeamRoster({
  period,
  currentPeriod,
  rows,
  canEdit,
  isAdmin,
  basePath,
  onSetTarget,
  onStale,
}: {
  period: PeriodView
  currentPeriod: PeriodKey
  rows: MonthlyProgress[]
  /** Managers: current and next month. Admins: any month. */
  canEdit: boolean
  isAdmin: boolean
  /** The venue's manager tools (`/staff/manage` or an admin venue). */
  basePath: string
  onSetTarget?: SetTargetHandler
  onStale?: () => void
}) {
  const staffHref = (id: string) =>
    `${manageHrefs(basePath).staff(id)}&period=${period.key}`
  const timing = timingOf(period.key, currentPeriod)
  const editable = !!onSetTarget && canEdit && (timing !== "past" || isAdmin)
  const action = useCoverageAction(onStale)
  const noticeRef = React.useRef<HTMLDivElement>(null)
  const [editing, setEditing] = React.useState<MonthlyProgress | null>(null)
  const [bulkOpen, setBulkOpen] = React.useState(false)

  const missingTarget = React.useMemo(
    () =>
      rows.filter(
        (r) => r.isCurrentMember && r.setupMissing.includes("target")
      ),
    [rows]
  )
  // The bulk dialog edits a stand-in row named after the group; it must keep
  // its identity between renders (the dialog resets its form on a new row).
  const bulkRow = React.useMemo<MonthlyProgress | null>(() => {
    const first = missingTarget[0]
    if (!first) return null
    return {
      ...first,
      targetCount: null,
      source: "placeholder",
      due: null,
      person: {
        ...first.person,
        displayName: plural(missingTarget.length, "person", "people"),
      },
    }
  }, [missingTarget])
  const complete = rows.filter((r) => r.complete).length
  const needsSetup = rows.filter((r) => r.status === "needs_setup").length

  async function saveOne(
    row: MonthlyProgress,
    values: { targetCount: number; dueOn: string | null; reason: string | null }
  ) {
    if (!onSetTarget) return { ok: false as const, error: "Not available." }
    const result = await action.run(
      () =>
        onSetTarget({
          staffId: row.person.id,
          period: period.key,
          targetCount: values.targetCount,
          dueOn: values.dueOn,
          reason: values.reason,
          expectedRevision: row.revision,
        }),
      `Saved ${row.person.displayName}’s target: ${plural(values.targetCount, "photo")}.`
    )
    if (result.ok) return { ok: true as const }
    if (action.reportedOnPage(result)) return REPORTED
    return {
      ok: false as const,
      error: result.code === "network" ? result.message : failureText(result),
      fieldErrors: "fieldErrors" in result ? result.fieldErrors : undefined,
    }
  }

  async function saveMissing(values: {
    targetCount: number
    dueOn: string | null
    reason: string | null
  }) {
    if (!onSetTarget) return { ok: false as const, error: "Not available." }
    let saved = 0
    for (const row of missingTarget) {
      try {
        const result = await onSetTarget({
          staffId: row.person.id,
          period: period.key,
          targetCount: values.targetCount,
          dueOn: values.dueOn,
          reason: values.reason,
          expectedRevision: row.revision,
        })
        if (!result.ok) {
          onStale?.()
          const text = `${plural(saved, "target")} saved. ${row.person.displayName}: ${failureText(result)}`
          if (needsRefresh(result)) {
            action.setNotice({ tone: "warning", text })
            return REPORTED
          }
          action.setNotice({ tone: "error", text })
          return { ok: false as const, error: text }
        }
        saved += 1
      } catch {
        onStale?.()
        const text = `${plural(saved, "target")} saved. Could not reach the server; try again for the rest.`
        action.setNotice({ tone: "error", text })
        return { ok: false as const, error: text }
      }
    }
    action.setNotice({
      tone: "success",
      text: `Saved ${plural(saved, "target")} of ${plural(values.targetCount, "photo")}.`,
    })
    return { ok: true as const }
  }

  return (
    <section aria-labelledby="team-title" className="grid gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="grid gap-1">
          <h2 id="team-title" className="text-lg font-medium">
            Team targets, {period.label}
          </h2>
          <p className="text-sm text-muted-foreground">
            {plural(rows.length, "person", "people")} · {complete} complete ·{" "}
            {needsSetup} need setup
          </p>
        </div>
        {editable && missingTarget.length > 0 ? (
          <Button size="touch" onClick={() => setBulkOpen(true)}>
            <UsersIcon data-icon="inline-start" aria-hidden />
            Set targets for {plural(
              missingTarget.length,
              "person",
              "people"
            )}{" "}
            without one
          </Button>
        ) : null}
      </div>
      {timing === "past" && !isAdmin ? (
        <p className="text-sm text-muted-foreground">
          Past months are read-only. Only an admin can correct them, with a
          reason.
        </p>
      ) : null}
      <CoverageNotice
        ref={noticeRef}
        notice={action.notice}
        onDismiss={action.dismiss}
      />
      {rows.length === 0 ? (
        <p className="rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
          No one at this venue has a target for {period.label} yet. Use “Prepare
          this month” on the overview to set the month up.
        </p>
      ) : (
        <ul aria-label="Team" className="divide-y rounded-lg border bg-card">
          {rows.map((row) => {
            const team = departmentLabel(row.person.department)
            const targetAction =
              row.targetCount == null ? "Set target" : "Edit target"
            return (
              <li
                key={`${row.person.id}:${row.venue.id}`}
                className="flex flex-col gap-3 px-3 py-3 sm:flex-row sm:items-center sm:px-4"
              >
                <Link
                  href={staffHref(row.person.id)}
                  className="flex min-w-0 flex-1 items-center gap-3 rounded-md outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  <ProfileAvatar
                    name={row.person.displayName}
                    src={row.person.avatarUrl}
                    className="size-10"
                  />
                  <span className="grid min-w-0 gap-0.5">
                    <span className="flex flex-wrap items-center gap-1.5">
                      <span className="font-medium break-words">
                        {row.person.displayName}
                      </span>
                      {row.isManager ? (
                        <CoverageBadge tone="info">Manager</CoverageBadge>
                      ) : null}
                      {row.status === "needs_setup" ? (
                        <NeedsSetupBadge />
                      ) : null}
                      {row.complete ? (
                        <CoverageBadge tone="positive">Complete</CoverageBadge>
                      ) : null}
                      {row.due?.overdue && !row.complete ? (
                        <OverdueBadge />
                      ) : null}
                    </span>
                    <span className="text-sm text-muted-foreground">
                      {[
                        team ?? "No team",
                        row.person.jobTitle,
                        row.isCurrentMember ? null : "No longer at this venue",
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                    {row.status === "needs_setup" ? (
                      <span className="text-sm text-warning">
                        {setupText(row)}
                      </span>
                    ) : null}
                  </span>
                </Link>
                <div className="grid gap-1 sm:w-64">
                  <PhotoProgress
                    accepted={row.accepted}
                    target={row.targetCount}
                    pending={row.pending}
                  />
                  <span className="text-xs text-muted-foreground">
                    {[
                      row.due?.label ?? null,
                      row.source
                        ? labelFor(TARGET_SOURCE_LABEL, row.source)
                        : null,
                      row.needsAnotherPhoto > 0
                        ? `${row.needsAnotherPhoto} need another photo`
                        : null,
                      row.lateAcceptances > 0
                        ? `${row.lateAcceptances} accepted late`
                        : null,
                      row.evidenceRemoved > 0
                        ? `${row.evidenceRemoved} credited, photo since removed`
                        : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </div>
                {editable && (row.isCurrentMember || isAdmin) ? (
                  <Button
                    variant="outline"
                    size="touch"
                    className="sm:w-auto"
                    onClick={() => setEditing(row)}
                    aria-label={`${targetAction} for ${row.person.displayName}`}
                  >
                    <PencilSimpleIcon data-icon="inline-start" aria-hidden />
                    {targetAction}
                  </Button>
                ) : null}
              </li>
            )
          })}
        </ul>
      )}
      <TargetDialog
        row={editing}
        period={period}
        timing={timing}
        open={!!editing}
        onOpenChange={(open) => {
          if (!open) setEditing(null)
        }}
        onSave={(values) =>
          editing
            ? saveOne(editing, values)
            : Promise.resolve({ ok: false as const, error: "Nothing to save." })
        }
        reportFocus={() => noticeRef.current}
      />
      <TargetDialog
        row={bulkRow}
        period={period}
        timing={timing}
        open={bulkOpen && bulkRow !== null}
        onOpenChange={setBulkOpen}
        onSave={(values) => saveMissing(values)}
        reportFocus={() => noticeRef.current}
      />
    </section>
  )
}
