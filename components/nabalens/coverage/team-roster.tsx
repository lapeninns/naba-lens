"use client"

import * as React from "react"
import Link from "next/link"
import {
  CheckIcon,
  MinusIcon,
  PencilSimpleIcon,
  PlusIcon,
  SpinnerGapIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react"

import { useSessionEndedCatch } from "@/components/nabalens/session-guard-host"
import { EmptyState } from "@/components/nabalens/empty-state"
import { Notice } from "@/components/nabalens/notice"
import { ProfileAvatar } from "@/components/nabalens/profile-avatar"
import { StatusChip } from "@/components/nabalens/status-chip"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

import { CoverageNotice, type Notice as PageNotice } from "./coverage-notice"
import {
  COVERAGE_LIMITS,
  failureText,
  firstDayOfPeriod,
  lastDayOfPeriod,
  localDateLabel,
  monthName,
  needsRefresh,
  plural,
} from "./copy"
import { Frames, ItemList } from "./layout"
import { manageHrefs } from "./manage-nav"
import { useReportedFocus } from "./reason-dialog"
import {
  rosterOrder,
  targetReasonRequired,
  targetSourceText,
  timingOf,
} from "./roster"
import type {
  CoverageFailure,
  CoveragePerson,
  CoverageResult,
  MonthlyProgress,
  PeriodKey,
  PeriodView,
  SetMonthlyTargetInput,
} from "./types"
import { NETWORK_ERROR, REPORTED, type Reported } from "./use-coverage-action"

export type SetTargetHandler = (
  input: Omit<SetMonthlyTargetInput, "venueId">
) => Promise<CoverageResult<{ revision: number }>>

function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name
}

function lowerFirst(text: string): string {
  return text.charAt(0).toLowerCase() + text.slice(1)
}

/** "FOH" or "BOH" as a tag, or the No team chip. */
export function TeamTag({
  department,
}: {
  department: CoveragePerson["department"]
}) {
  if (!department) return <StatusChip state="needs_setup">No team</StatusChip>
  return (
    <span className="inline-flex min-h-7 items-center rounded-square px-2 font-mono text-meta-strong tracking-[0.04em] whitespace-nowrap text-ink-muted shadow-[inset_0_0_0_1.5px_var(--border-strong)]">
      {department.toUpperCase()}
    </span>
  )
}

/** Avatar, name with team, and one quiet line (`nl-person`). */
export function TeamPerson({
  person,
  href,
  meta,
  className,
}: {
  person: CoveragePerson
  href?: string
  meta?: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn("flex min-w-0 items-center gap-3", className)}>
      <ProfileAvatar name={person.displayName} src={person.avatarUrl} />
      <span className="grid min-w-0">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-item-title text-ink">
          {href ? (
            <Link
              href={href}
              className="-my-2.5 inline-flex min-h-11 items-center rounded-control [overflow-wrap:anywhere] underline-offset-3 outline-none hover:underline focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-focus focus-visible:outline-solid"
            >
              {person.displayName}
            </Link>
          ) : (
            <span className="[overflow-wrap:anywhere]">
              {person.displayName}
            </span>
          )}
          <TeamTag department={person.department} />
        </span>
        {meta ? (
          <span className="truncate text-meta text-ink-muted">{meta}</span>
        ) : null}
      </span>
    </div>
  )
}

/** A whole-number field with minus and plus (`nl-stepper`). */
export function Stepper({
  id,
  name,
  value,
  onChange,
  changed,
  invalid,
  disabled,
  describedBy,
  max = COVERAGE_LIMITS.targetCountMax,
}: {
  id?: string
  /** "Priya Gurung's photo target" */
  name: string
  value: string
  onChange: (value: string) => void
  changed?: boolean
  invalid?: boolean
  disabled?: boolean
  describedBy?: string
  max?: number
}) {
  const n = Number(value)
  const set = value !== "" && Number.isInteger(n)
  const step =
    "grid min-h-12 w-12 place-items-center rounded-control bg-surface-2 text-ink transition-colors duration-(--duration-quick) outline-none hover:bg-raised focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-focus focus-visible:outline-solid disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-surface-2"
  return (
    <div className={cn("inline-flex items-stretch gap-2 justify-self-start")}>
      <button
        type="button"
        aria-label={`Decrease ${name}`}
        className={step}
        disabled={disabled || !set || n <= 1}
        onClick={() => onChange(String(Math.max(1, n - 1)))}
      >
        <MinusIcon aria-hidden weight="bold" className="size-5" />
      </button>
      <input
        id={id}
        aria-label={name}
        inputMode="numeric"
        autoComplete="off"
        placeholder="–"
        value={value}
        onChange={(e) => onChange(e.currentTarget.value.replace(/\D/g, ""))}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        disabled={disabled}
        className={cn(
          "min-h-12 w-[3.75em] rounded-control bg-surface-2 text-center text-lead font-bold text-ink tabular-nums outline-none placeholder:text-ink-muted focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-focus focus-visible:outline-solid disabled:opacity-60",
          invalid
            ? "shadow-[inset_0_0_0_2px_var(--warn-fg)]"
            : changed
              ? "shadow-[inset_0_0_0_2px_var(--accent-text)]"
              : "shadow-[inset_0_0_0_1.5px_var(--border-strong)]"
        )}
      />
      <button
        type="button"
        aria-label={`Increase ${name}`}
        className={step}
        disabled={disabled || (set && n >= max)}
        onClick={() => onChange(String(set ? Math.min(max, n + 1) : 1))}
      >
        <PlusIcon aria-hidden weight="bold" className="size-5" />
      </button>
    </div>
  )
}

function FieldError({ id, children }: { id?: string; children: string }) {
  return (
    <p
      id={id}
      className="flex items-start gap-1.5 text-meta font-bold text-warn-fg"
    >
      <WarningCircleIcon aria-hidden className="mt-0.5 size-[18px] shrink-0" />
      {children}
    </p>
  )
}

const fieldLabel = "text-label text-ink"
const fieldHint = "text-meta text-ink-muted"
const fieldInput = "text-body text-ink"

function Counter({ value }: { value: string }) {
  return (
    <span
      className={cn(
        "ms-auto shrink-0 font-mono text-meta whitespace-nowrap tabular-nums",
        value.length > COVERAGE_LIMITS.reasonMax
          ? "font-bold text-warn-fg"
          : "text-ink-muted"
      )}
    >
      {value.length} / {COVERAGE_LIMITS.reasonMax}
    </span>
  )
}

function countError(value: string): string | null {
  const n = Number(value)
  if (value !== "" && Number.isInteger(n) && n > COVERAGE_LIMITS.targetCountMax)
    return `Targets can be up to ${COVERAGE_LIMITS.targetCountMax} photos.`
  if (value === "" || !Number.isInteger(n) || n < 1)
    return `Enter a whole number from 1 to ${COVERAGE_LIMITS.targetCountMax}.`
  return null
}

type Draft = {
  /** The row and revision the draft was started from. */
  base: string
  count: string
  dueOn: string
  reason: string
  dueOpen: boolean
}

type RowErrors = { count?: string; dueOn?: string; reason?: string }

function rowKey(row: MonthlyProgress) {
  return `${row.person.id}:${row.revision ?? "new"}`
}

function originalCount(row: MonthlyProgress) {
  return row.targetCount != null ? String(row.targetCount) : ""
}

function originalDue(row: MonthlyProgress, period: PeriodKey) {
  return row.due?.dueOn ?? lastDayOfPeriod(period)
}

function isChanged(
  row: MonthlyProgress,
  draft: Draft | null,
  period: PeriodKey
) {
  return (
    !!draft &&
    (draft.count !== originalCount(row) ||
      draft.dueOn !== originalDue(row, period))
  )
}

type TeamRosterProps = {
  period: PeriodView
  currentPeriod: PeriodKey
  rows: MonthlyProgress[]
  /** Managers: current and next month. Admins: any month. */
  canEdit: boolean
  isAdmin: boolean
  /** The venue's manager tools (`/staff/manage` or an admin venue). */
  basePath: string
  /** For the empty roster ("No one works at The Railway yet"). */
  venueName?: string
  onSetTarget?: SetTargetHandler
  onStale?: () => void
  /**
   * The current month hasn't been prepared, from the preparation status.
   * Missing targets don't decide it: they can be set before preparing, and a
   * new starter can lack one after it. Omitted: inferred from missing targets.
   */
  unprepared?: boolean
}

/**
 * Monthly participation for one venue: each person's photo target and their
 * accepted photos, edited in place and saved together. A missing target or
 * team is "Needs setup", never met. A person's month is never added to the
 * venue's checklist. Shows names, avatars, teams and progress only.
 */
export function TeamRoster(props: TeamRosterProps) {
  // The month stepper keeps this roster mounted. Scope its local edits and
  // feedback to the month, even when the next target has the same revision.
  return <TeamRosterMonth key={props.period.key} {...props} />
}

function TeamRosterMonth({
  period,
  currentPeriod,
  rows,
  canEdit,
  isAdmin,
  basePath,
  venueName,
  onSetTarget,
  onStale,
  unprepared: monthUnprepared,
}: TeamRosterProps) {
  const ids = React.useId()
  const staffHref = (id: string) =>
    `${manageHrefs(basePath).staff(id)}&period=${period.key}`
  const timing = timingOf(period.key, currentPeriod)
  const month = monthName(period.key)
  // Past months are corrected one person at a time (admins only), the rest in place.
  const inPlace = !!onSetTarget && canEdit && timing !== "past"
  const correcting = !!onSetTarget && canEdit && timing === "past" && isAdmin
  const noticeRef = React.useRef<HTMLDivElement>(null)
  const [notice, setNotice] = React.useState<PageNotice | null>(null)
  const [focusNotice, setFocusNotice] = React.useState(0)
  const [drafts, setDrafts] = React.useState<Record<string, Draft>>({})
  const [errors, setErrors] = React.useState<Record<string, RowErrors>>({})
  // The draft whose save got no reply, per person: it may have been saved.
  // Editing the row makes a new draft object, which drops the mark.
  const [unconfirmed, setUnconfirmed] = React.useState<Record<string, Draft>>(
    {}
  )
  const [saving, setSaving] = React.useState(false)
  const sessionEnded = useSessionEndedCatch()
  // The row stays set while the dialog animates closed.
  const [correctingRow, setCorrectingRow] =
    React.useState<MonthlyProgress | null>(null)
  const [correctOpen, setCorrectOpen] = React.useState(false)

  React.useEffect(() => {
    if (focusNotice > 0) noticeRef.current?.focus()
  }, [focusNotice])

  const sorted = React.useMemo(() => [...rows].sort(rosterOrder), [rows])
  // History after a transfer stays in a past month's list; this month it is
  // listed apart so it is not read as part of the current team.
  const team =
    timing === "past" ? sorted : sorted.filter((r) => r.isCurrentMember)
  const moved =
    timing === "past" ? [] : sorted.filter((r) => !r.isCurrentMember)
  const missingTarget = team.filter((r) => r.targetId == null).length
  const unprepared =
    timing === "current" && (monthUnprepared ?? missingTarget > 0)
  // Before preparing, or for someone with no target after it.
  const targetHint =
    inPlace && timing === "current" && (unprepared || missingTarget > 0)
  const met = team.filter((r) => r.complete).length

  const draftFor = (row: MonthlyProgress) => {
    const draft = drafts[row.person.id]
    return draft && draft.base === rowKey(row) ? draft : null
  }
  const canEditRow = (row: MonthlyProgress) =>
    inPlace && (row.isCurrentMember || isAdmin)
  const changes = rows.filter(
    (row) => canEditRow(row) && isChanged(row, draftFor(row), period.key)
  )

  function update(row: MonthlyProgress, patch: Partial<Draft>) {
    setDrafts((all) => {
      const current = all[row.person.id]
      const base: Draft =
        current && current.base === rowKey(row)
          ? current
          : {
              base: rowKey(row),
              count: originalCount(row),
              dueOn: originalDue(row, period.key),
              reason: "",
              dueOpen: false,
            }
      return { ...all, [row.person.id]: { ...base, ...patch } }
    })
    setErrors((all) => {
      if (!all[row.person.id]) return all
      const next = { ...all }
      delete next[row.person.id]
      return next
    })
  }

  function discard(personId: string) {
    setDrafts((all) => {
      const next = { ...all }
      delete next[personId]
      return next
    })
  }

  function validate(row: MonthlyProgress, draft: Draft): RowErrors {
    const found: RowErrors = {}
    const count = countError(draft.count)
    if (count) found.count = count
    const min = firstDayOfPeriod(period.key)
    const max = lastDayOfPeriod(period.key)
    if (draft.dueOn && (draft.dueOn < min || draft.dueOn > max))
      found.dueOn = `Choose a date in ${period.label}.`
    if (targetReasonRequired(row, timing) && !draft.reason.trim())
      found.reason = "Add a reason. It's saved with the change."
    else if (draft.reason.length > COVERAGE_LIMITS.reasonMax)
      found.reason = `Keep the reason to ${COVERAGE_LIMITS.reasonMax} characters.`
    return found
  }

  async function save() {
    if (!onSetTarget || saving) return
    const found: Record<string, RowErrors> = {}
    for (const row of changes) {
      const rowErrors = validate(row, draftFor(row)!)
      if (Object.keys(rowErrors).length > 0) found[row.person.id] = rowErrors
    }
    setErrors(found)
    if (Object.keys(found).length > 0) {
      const first = changes.find((row) => found[row.person.id])
      if (first)
        document
          .querySelector<HTMLElement>(
            `[data-target-row="${first.person.id}"] [aria-invalid="true"]`
          )
          ?.focus()
      return
    }
    setSaving(true)
    setNotice(null)
    setUnconfirmed({})
    const saved: { row: MonthlyProgress; count: number; reason: string }[] = []
    let failure: { tone: "error" | "warning"; text: string } | null = null
    for (const row of changes) {
      const draft = draftFor(row)!
      const count = Number(draft.count)
      const reason = draft.reason.trim()
      let result: CoverageResult<{ revision: number }>
      try {
        result = await onSetTarget({
          staffId: row.person.id,
          period: period.key,
          targetCount: count,
          dueOn: draft.dueOn || null,
          reason: reason || null,
          expectedRevision: row.revision,
        })
      } catch (cause) {
        // Refused for the ended session: this row wasn't saved.
        const ended = sessionEnded(cause)
        if (!ended) setUnconfirmed({ [row.person.id]: draft })
        failure = {
          tone: "error",
          text: ended
            ? saved.length > 0
              ? `${plural(saved.length, "target")} saved. You were signed out before ${row.person.displayName}'s was saved. Sign in again, then try again.`
              : ended
            : `${saved.length > 0 ? `${plural(saved.length, "target")} saved. ` : ""}We couldn't confirm ${row.person.displayName}'s target was saved. Check your connection, then refresh to see.`,
        }
        break
      }
      if (!result.ok) {
        const refresh = needsRefresh(result)
        if (refresh) onStale?.()
        failure = {
          tone: refresh ? "warning" : "error",
          text: failureText(result),
        }
        if ("fieldErrors" in result && result.fieldErrors) {
          const fields = result.fieldErrors as Partial<Record<string, string>>
          setErrors({
            [row.person.id]: {
              count: fields.targetCount,
              dueOn: fields.dueOn,
              reason: fields.reason,
            },
          })
        }
        if (saved.length > 0)
          failure.text = `${plural(saved.length, "target")} saved. ${row.person.displayName}: ${failure.text}`
        break
      }
      saved.push({ row, count, reason })
      discard(row.person.id)
    }
    setSaving(false)
    if (failure) {
      setNotice(failure)
    } else if (saved.length === 1) {
      const { row, count, reason } = saved[0]
      const who = `${firstName(row.person.displayName)}'s ${month} target is ${count}`
      const from =
        row.targetCount != null && row.targetCount !== count
          ? `, changed from ${row.targetCount}`
          : ""
      setNotice({
        tone: "success",
        text: `Saved. ${who}${from}.${reason ? " The reason is kept with it." : ""}`,
      })
    } else {
      setNotice({
        tone: "success",
        text: `Saved ${plural(saved.length, "target")} for ${month}.`,
      })
    }
    setFocusNotice((n) => n + 1)
  }

  function renderRow(row: MonthlyProgress, movedAway: boolean) {
    const id = row.person.id
    const name = row.person.displayName
    const draft = draftFor(row)
    const editable = canEditRow(row)
    const changed = editable && isChanged(row, draft, period.key)
    const rowErrors = errors[id] ?? {}
    const count = draft?.count ?? originalCount(row)
    const shownTarget = changed
      ? countError(count)
        ? null
        : Number(count)
      : row.targetCount
    const needsReason = changed && targetReasonRequired(row, timing)
    const missingTeam = row.setupMissing.includes("team")
    const met = changed
      ? shownTarget != null && !missingTeam && row.accepted >= shownTarget
      : row.complete
    const source = targetSourceText(row, period.key, timing)
    const reasonId = `${ids}-${id}-reason`
    const dueId = `${ids}-${id}-due`
    const countErrorId = `${ids}-${id}-count-error`

    let due: string
    if (movedAway) {
      due = "Photos sent before the move still count here."
    } else if (changed) {
      due =
        row.targetCount == null
          ? needsReason
            ? "First target"
            : "First target · no reason needed"
          : [`Was ${row.targetCount}`, source ? lowerFirst(source) : null]
              .filter(Boolean)
              .join(" · ")
    } else if (timing === "past") {
      due = source ?? (row.targetCount == null ? `No target for ${month}.` : "")
    } else if (row.targetId == null && timing === "current") {
      due = "Copied when you prepare this month"
    } else if (row.status === "needs_setup") {
      const parts: string[] = []
      if (row.setupMissing.includes("target")) parts.push("Set a target.")
      if (missingTeam) parts.push("An admin assigns the team.")
      due = parts.join(" ")
    } else {
      due = [
        row.due?.label ?? null,
        row.lateAcceptances > 0 ? `${row.lateAcceptances} accepted late` : null,
        row.evidenceRemoved > 0
          ? `${row.evidenceRemoved} credited, photo since removed`
          : null,
      ]
        .filter(Boolean)
        .join(" · ")
    }

    // An unsaved target previews progress; it isn't a state yet, so no chip
    // (Target met, Overdue) is drawn from it.
    const chip = changed ? (
      <span className="text-meta text-ink-muted">
        {draft && unconfirmed[id] === draft
          ? "· not confirmed"
          : "· not saved yet"}
      </span>
    ) : row.status === "needs_setup" ? (
      <StatusChip state="needs_setup" />
    ) : met ? (
      <StatusChip state="target_met" />
    ) : row.due?.overdue && timing !== "past" ? (
      <StatusChip state="overdue" />
    ) : null

    let progress: React.ReactNode
    if ((movedAway && !editable) || (changed && shownTarget == null)) {
      progress = <span aria-hidden />
    } else if (shownTarget != null) {
      progress = (
        <Frames
          compact
          accepted={row.accepted}
          target={shownTarget}
          pending={row.pending}
          chip={chip}
          className="@max-[640px]:col-span-full"
        />
      )
    } else {
      progress = (
        <p className="@max-[640px]:col-span-full">
          <StatusChip state="needs_setup" />
        </p>
      )
    }

    return (
      <li
        key={`${id}:${row.venue.id}`}
        data-target-row={id}
        className="grid grid-cols-[minmax(0,1.3fr)_auto_minmax(0,1fr)_minmax(0,0.8fr)] items-center gap-x-5 gap-y-3 p-4 @max-[640px]:grid-cols-1"
      >
        <TeamPerson
          person={row.person}
          href={staffHref(id)}
          meta={
            movedAway
              ? "No longer at this venue"
              : [
                  row.person.jobTitle,
                  timing === "past" && !row.isCurrentMember
                    ? "No longer at this venue"
                    : null,
                ]
                  .filter(Boolean)
                  .join(" · ") || null
          }
        />
        {editable ? (
          <Stepper
            name={`${name}'s photo target`}
            value={count}
            onChange={(value) => update(row, { count: value })}
            changed={changed}
            invalid={!!rowErrors.count}
            disabled={saving}
            describedBy={
              [
                rowErrors.count ? countErrorId : null,
                targetHint && row.targetId == null ? `${ids}-unprepared` : null,
              ]
                .filter(Boolean)
                .join(" ") || undefined
            }
          />
        ) : movedAway ? (
          <span aria-hidden />
        ) : (
          <p className="font-mono text-item-title text-ink tabular-nums">
            {row.targetCount != null ? plural(row.targetCount, "photo") : "–"}
          </p>
        )}
        {progress}
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2 @max-[640px]:col-span-full">
          {due ? <p className="text-meta text-ink-muted">{due}</p> : null}
          {editable && !draft?.dueOpen ? (
            <Button
              variant="link"
              size="sm"
              className="text-meta"
              onClick={() => update(row, { dueOpen: true })}
              disabled={saving}
              aria-label={`Change due date for ${name}`}
            >
              Change due date
            </Button>
          ) : null}
          {correcting ? (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setCorrectingRow(row)
                setCorrectOpen(true)
              }}
              aria-label={`Correct target for ${name}, ${month}`}
            >
              <PencilSimpleIcon aria-hidden />
              Correct target
            </Button>
          ) : null}
        </div>
        {editable && draft?.dueOpen ? (
          <div className="col-span-full grid max-w-xs gap-1.5">
            <label htmlFor={dueId} className={fieldLabel}>
              Due date
            </label>
            <Input
              id={dueId}
              type="date"
              min={firstDayOfPeriod(period.key)}
              max={lastDayOfPeriod(period.key)}
              value={draft.dueOn}
              onChange={(e) => update(row, { dueOn: e.currentTarget.value })}
              aria-invalid={!!rowErrors.dueOn || undefined}
              aria-describedby={`${dueId}-hint`}
              disabled={saving}
              className={fieldInput}
            />
            {rowErrors.dueOn ? (
              <FieldError id={`${dueId}-hint`}>{rowErrors.dueOn}</FieldError>
            ) : (
              <p id={`${dueId}-hint`} className={fieldHint}>
                Defaults to {localDateLabel(lastDayOfPeriod(period.key))}. An
                earlier date is for follow-up only; photos can still be sent all
                month.
              </p>
            )}
          </div>
        ) : null}
        {needsReason ? (
          <div className="col-span-full grid gap-1.5">
            <label htmlFor={reasonId} className={fieldLabel}>
              Reason for changing {month}&apos;s target
            </label>
            <Input
              id={reasonId}
              type="text"
              value={draft?.reason ?? ""}
              onChange={(e) => update(row, { reason: e.currentTarget.value })}
              maxLength={COVERAGE_LIMITS.reasonMax}
              aria-invalid={!!rowErrors.reason || undefined}
              aria-describedby={`${reasonId}-hint`}
              disabled={saving}
              className={fieldInput}
            />
            <div className="flex items-start gap-3">
              {rowErrors.reason ? (
                <FieldError id={`${reasonId}-hint`}>
                  {rowErrors.reason}
                </FieldError>
              ) : (
                <span id={`${reasonId}-hint`} className={fieldHint}>
                  Saved with the change. Admins can see it.
                </span>
              )}
              <Counter value={draft?.reason ?? ""} />
            </div>
          </div>
        ) : null}
        {rowErrors.count ? (
          <div className="col-span-full">
            <FieldError id={countErrorId}>{rowErrors.count}</FieldError>
          </div>
        ) : null}
      </li>
    )
  }

  return (
    <div className="grid min-w-0 gap-(--gutter) md:gap-4">
      <CoverageNotice
        ref={noticeRef}
        notice={notice}
        onDismiss={() => setNotice(null)}
      />
      {rows.length === 0 ? (
        <EmptyState
          title={
            venueName
              ? `No one works at ${venueName} yet`
              : "No one works here yet"
          }
          description="An admin adds staff and sets their venue. Their targets are set here once they join."
        />
      ) : (
        <section
          aria-labelledby={`${ids}-people`}
          className="grid min-w-0 gap-(--gutter)"
        >
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-1 pt-2">
            <h2
              id={`${ids}-people`}
              className="font-display text-section-title text-ink"
            >
              People
            </h2>
            <span className="text-meta text-ink-muted tabular-nums">
              {unprepared
                ? plural(team.length, "person", "people")
                : `${met} of ${team.length} met their target`}
            </span>
          </div>
          <p className="-mt-1 px-1 text-body text-ink-muted">
            Needs setup first, then A to Z by surname.
          </p>
          {/* Preparing inserts only missing targets, so one set now stays. */}
          {targetHint ? (
            <p
              id={`${ids}-unprepared`}
              className="-mt-1 px-1 text-body text-ink"
            >
              {unprepared
                ? `You can set targets now. Preparing ${month} keeps the ones you set and copies last month's targets for everyone else.`
                : `${plural(missingTarget, "person", "people")} ${missingTarget === 1 ? "has" : "have"} no target yet. Set one below.`}
            </p>
          ) : null}
          {team.length > 0 ? (
            <ItemList label={`Team targets, ${period.label}`}>
              {team.map((row) => renderRow(row, false))}
            </ItemList>
          ) : null}
        </section>
      )}
      {moved.length > 0 ? (
        <section
          aria-labelledby={`${ids}-moved`}
          className="grid min-w-0 gap-(--gutter)"
        >
          <h2
            id={`${ids}-moved`}
            className="px-1 pt-2 font-display text-section-title text-ink"
          >
            Moved away this month
          </h2>
          <ItemList label="Moved away this month">
            {moved.map((row) => renderRow(row, true))}
          </ItemList>
        </section>
      ) : null}
      {changes.length > 0 ? (
        <div className="sticky bottom-[calc(var(--size-tabbar)+env(safe-area-inset-bottom,0px))] z-30 -mx-(--page-gutter) flex flex-wrap items-center justify-between gap-3 border-t border-line bg-surface px-(--page-gutter) py-3 shadow-float md:bottom-0 md:mx-0 md:rounded-card md:border-t-0 md:px-4 md:shadow-card">
          <p role="status" className="text-meta text-ink-muted tabular-nums">
            {plural(changes.length, "change")} not saved
          </p>
          <Button
            onClick={() => void save()}
            className="max-md:flex-auto"
            aria-disabled={saving || undefined}
            aria-busy={saving || undefined}
          >
            {saving ? (
              <SpinnerGapIcon aria-hidden className="animate-spin" />
            ) : (
              <CheckIcon aria-hidden />
            )}
            {saving ? "Saving…" : "Save targets"}
          </Button>
        </div>
      ) : null}
      <CorrectTargetDialog
        row={correctingRow}
        period={period}
        venueName={venueName}
        open={correctOpen}
        onOpenChange={setCorrectOpen}
        reportFocus={() => noticeRef.current}
        onSave={async (row, values) => {
          if (!onSetTarget) return { ok: false, error: "Not available." }
          let result: CoverageResult<{ revision: number }>
          try {
            result = await onSetTarget({
              staffId: row.person.id,
              period: period.key,
              targetCount: values.targetCount,
              dueOn: row.due?.dueOn ?? null,
              reason: values.reason,
              expectedRevision: row.revision,
            })
          } catch (cause) {
            const ended = sessionEnded(cause)
            if (ended) return { ok: false, error: ended }
            return { ok: false, network: true, error: NETWORK_ERROR }
          }
          if (!result.ok) {
            if (needsRefresh(result)) {
              onStale?.()
              setNotice({ tone: "warning", text: failureText(result) })
              return REPORTED
            }
            return { ok: false, error: failureText(result), failure: result }
          }
          setNotice({
            tone: "success",
            text: `${firstName(row.person.displayName)}'s ${month} target is now ${values.targetCount}. The correction and its reason are kept in ${month}'s history.`,
          })
          setFocusNotice((n) => n + 1)
          return { ok: true }
        }}
      />
    </div>
  )
}

type CorrectOutcome =
  | { ok: true }
  | { ok: false; error: string; network?: boolean; failure?: CoverageFailure }
  | Reported

/** Admin-only correction of a past month's target, with a recorded reason (A20). */
function CorrectTargetDialog({
  row,
  period,
  venueName,
  open,
  onOpenChange,
  onSave,
  reportFocus,
}: {
  row: MonthlyProgress | null
  period: PeriodView
  venueName?: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onSave: (
    row: MonthlyProgress,
    values: { targetCount: number; reason: string }
  ) => Promise<CorrectOutcome>
  reportFocus: () => HTMLElement | null
}) {
  const ids = React.useId()
  const { reportedRef, finalFocus } = useReportedFocus(reportFocus)
  const [count, setCount] = React.useState("")
  const [reason, setReason] = React.useState("")
  const [errors, setErrors] = React.useState<RowErrors>({})
  const [failure, setFailure] = React.useState<{
    network: boolean
    text: string
  } | null>(null)
  const [pending, setPending] = React.useState(false)
  const key = row ? rowKey(row) : null
  const [seed, setSeed] = React.useState<string | null>(null)
  if (open && row && seed !== key) {
    setSeed(key)
    setCount(originalCount(row))
    setReason("")
    setErrors({})
    setFailure(null)
  }
  const month = monthName(period.key)
  if (!row) return null
  const name = row.person.displayName
  const first = firstName(name)
  const n = Number(count)
  const valid = !countError(count)
  const source = targetSourceText(row, period.key, "past")
  const hint =
    valid && row.targetCount != null
      ? `Was ${row.targetCount}. With ${n}, ${first}'s ${month} shows ${
          row.accepted >= n && !row.setupMissing.includes("team")
            ? "Target met"
            : `${row.accepted} of ${n} accepted`
        }. Venue coverage isn't affected.`
      : "Venue coverage isn't affected."

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!row || pending) return
    const found: RowErrors = {}
    const countProblem = countError(count)
    if (countProblem) found.count = countProblem
    if (!reason.trim())
      found.reason = `Add a reason. It's kept in ${month}'s history.`
    setErrors(found)
    if (Object.keys(found).length > 0) return
    setPending(true)
    setFailure(null)
    try {
      const outcome = await onSave(row, {
        targetCount: n,
        reason: reason.trim(),
      })
      if (!outcome.ok && !("reported" in outcome)) {
        setFailure({ network: !!outcome.network, text: outcome.error })
        return
      }
      reportedRef.current = true
      setSeed(null)
      onOpenChange(false)
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
      <DialogContent finalFocus={finalFocus}>
        <form onSubmit={submit} className="grid gap-4" noValidate>
          <DialogHeader>
            <DialogTitle className="[overflow-wrap:anywhere]">
              Correct {name}&apos;s {month} target
            </DialogTitle>
          </DialogHeader>
          {failure ? (
            <Notice
              tone="negative"
              title={
                failure.network
                  ? "Couldn't confirm the correction"
                  : "Couldn't save the correction"
              }
            >
              {/* A lost reply may follow a saved correction; a retry is safe
                  (expectedRevision turns it into a refresh notice). */}
              {failure.network
                ? "We couldn't confirm the target changed. Check your connection, then refresh to see."
                : `Nothing changed. ${failure.text}`}
            </Notice>
          ) : null}
          <div className="flex items-center gap-3">
            <ProfileAvatar name={name} src={row.person.avatarUrl} size="md" />
            <p className="min-w-0 text-body">
              <strong className="font-bold">{name}</strong>{" "}
              <TeamTag department={row.person.department} />
              <br />
              <span className="text-ink-muted">
                {[
                  venueName ?? row.venue.name,
                  period.label,
                  row.targetCount != null
                    ? `${row.accepted} of ${row.targetCount} accepted`
                    : "Needs setup",
                  source ? lowerFirst(source) : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            </p>
          </div>
          <div className="grid gap-1.5">
            <label htmlFor={`${ids}-count`} className={fieldLabel}>
              {month} target
            </label>
            <Stepper
              id={`${ids}-count`}
              name={`${name}'s ${month} target`}
              value={count}
              onChange={(value) => {
                setCount(value)
                setErrors((e) => ({ ...e, count: undefined }))
              }}
              changed={count !== originalCount(row)}
              invalid={!!errors.count}
              disabled={pending}
              describedBy={`${ids}-count-hint`}
            />
            {errors.count ? (
              <FieldError id={`${ids}-count-hint`}>{errors.count}</FieldError>
            ) : (
              <p id={`${ids}-count-hint`} className={fieldHint}>
                {hint}
              </p>
            )}
          </div>
          <div className="grid gap-1.5">
            <label htmlFor={`${ids}-reason`} className={fieldLabel}>
              Reason
            </label>
            <textarea
              id={`${ids}-reason`}
              rows={3}
              value={reason}
              onChange={(e) => {
                setReason(e.currentTarget.value)
                setErrors((all) => ({ ...all, reason: undefined }))
              }}
              maxLength={COVERAGE_LIMITS.reasonMax}
              aria-invalid={!!errors.reason || undefined}
              aria-describedby={`${ids}-reason-hint`}
              disabled={pending}
              className="min-h-28 w-full resize-y rounded-control bg-surface-2 px-3.5 py-3 text-body text-ink shadow-[inset_0_0_0_1.5px_var(--border-strong)] outline-none placeholder:text-ink-muted focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-focus focus-visible:outline-solid aria-invalid:shadow-[inset_0_0_0_2px_var(--warn-fg)]"
            />
            <div className="flex items-start gap-3">
              {errors.reason ? (
                <FieldError id={`${ids}-reason-hint`}>
                  {errors.reason}
                </FieldError>
              ) : (
                <span id={`${ids}-reason-hint`} className={fieldHint}>
                  Kept in {month}&apos;s history with your name and the time.
                  The target&apos;s source becomes Corrected by an admin.
                </span>
              )}
              <Counter value={reason} />
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="secondary"
              size="touch"
              onClick={() => onOpenChange(false)}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              size="touch"
              aria-disabled={pending || undefined}
              aria-busy={pending || undefined}
            >
              {pending ? (
                <SpinnerGapIcon aria-hidden className="animate-spin" />
              ) : null}
              {pending ? "Saving…" : "Save correction"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
