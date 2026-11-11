"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { ArrowClockwiseIcon, CalendarPlusIcon } from "@phosphor-icons/react"

import { CoverageNotice, CoverageSection } from "@/components/nabalens/coverage"
import type { Notice as CoverageNoticeValue } from "@/components/nabalens/coverage"
import { useRequestIds } from "@/components/nabalens/coverage/use-request-id"
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
import type {
  KnowledgeResult,
  Occurrence,
  ScheduleExceptionKind,
} from "@/lib/knowledge-client/contract"

import { FieldMessage, LABEL, MUTED } from "../amenities/capture/field-parts"

import {
  DATE_CHANGE_COPY as DC,
  SCHEDULE_COPY,
  localDateWords,
  occurrenceLine,
} from "./schedule-detail"

const INPUT =
  "block min-h-12 w-full min-w-0 rounded-control border border-line-control bg-panel px-3 py-2 text-body-touch text-ink outline-none focus-visible:border-focus focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-1 focus-visible:outline-focus disabled:cursor-not-allowed disabled:bg-well aria-invalid:border-negative md:text-body"
const ROW =
  "flex min-h-11 cursor-pointer items-center gap-3 text-body-touch text-ink has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-focus md:text-body"
const SHOWN = 8
const WEEKS = 13

/** What the check page read for Upcoming (§5.3). */
export type UpcomingRead =
  { ok: true; occurrences: Occurrence[] } | { ok: false; retry: boolean }

/**
 * Upcoming (B03 UI design §5.3): the next dates of the schedule in use, as
 * the server expands them, in the venue's time.
 */
export function UpcomingSection({
  read,
  timezone,
  lastDay,
  today,
}: {
  read: UpcomingRead
  timezone: string
  /** The schedule's last day offered, when it has one. */
  lastDay: string | null
  today: string
}) {
  const router = useRouter()
  const shown = read.ok ? read.occurrences.slice(0, SHOWN) : []
  return (
    <CoverageSection id="amenity-upcoming" title={SCHEDULE_COPY.upcoming}>
      <p className={MUTED}>{SCHEDULE_COPY.timezone(timezone)}</p>
      {!read.ok ? (
        <div className="grid gap-2">
          <p className="text-body-touch text-ink md:text-body">
            {SCHEDULE_COPY.upcomingFailed}
          </p>
          {read.retry ? (
            <div>
              <Button
                type="button"
                variant="secondary"
                size="touch"
                onClick={() => router.refresh()}
              >
                <ArrowClockwiseIcon aria-hidden />
                {DC.tryAgain}
              </Button>
            </div>
          ) : null}
        </div>
      ) : shown.length ? (
        <ul className="grid gap-1 text-body-touch text-ink md:text-body">
          {shown.map((o) => (
            <li key={`${o.localDate}-${o.startsAt}`}>
              {occurrenceLine(o, timezone)}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-body-touch text-ink md:text-body">
          {lastDay && lastDay < today
            ? SCHEDULE_COPY.lastDayPassed(localDateWords(lastDay))
            : SCHEDULE_COPY.upcomingNone(WEEKS)}
        </p>
      )}
    </CoverageSection>
  )
}

type AddInput = {
  checkId: string
  slotRevision: number
  idempotencyKey: string
  scheduleId: string
  localDate: string
  kind: ScheduleExceptionKind
  windows: { start: string; end: string }[] | null
  note: string | null
}

const HHMM = /^([01][0-9]|2[0-3]):[0-5][0-9]$/

/**
 * Add a change for one date (§5.2): managers and admins, on the schedule in
 * use only (its id from the server, never guessed). Keyed, so a retry after
 * a lost reply never adds it twice.
 */
export function DateChangeControl({
  checkId,
  slotRevision,
  scheduleId,
  onAdd,
}: {
  checkId: string
  slotRevision: number
  scheduleId: string
  onAdd: (input: AddInput) => Promise<
    KnowledgeResult<{
      exceptionId: string
      slotRevision: number
      replayed: boolean
    }>
  >
}) {
  const id = React.useId()
  const router = useRouter()
  const sessionEnded = useSessionEndedCatch()
  const requests = useRequestIds()
  const [open, setOpen] = React.useState(false)
  const [date, setDate] = React.useState("")
  const [kind, setKind] = React.useState<ScheduleExceptionKind | null>(null)
  const [start, setStart] = React.useState("")
  const [end, setEnd] = React.useState("")
  const [note, setNote] = React.useState("")
  const [errors, setErrors] = React.useState<Record<string, string>>({})
  const [failure, setFailure] = React.useState<{
    text: string
    reload: boolean
  } | null>(null)
  const [pending, setPending] = React.useState(false)
  const [notice, setNotice] = React.useState<CoverageNoticeValue | null>(null)
  const scope = `schedule-exception:${checkId}`

  function reset() {
    setDate("")
    setKind(null)
    setStart("")
    setEnd("")
    setNote("")
    setErrors({})
    setFailure(null)
  }

  async function submit() {
    const next: Record<string, string> = {}
    if (!date) next.localDate = DC.dateRequired
    if (!kind) next.kind = DC.kindRequired
    const timed = kind === "changed_window" || kind === "extra"
    if (timed && (!HHMM.test(start) || !HHMM.test(end) || start === end))
      next.windows = DC.timesInvalid
    setErrors(next)
    setFailure(null)
    if (Object.keys(next).length || !kind) return
    const payload = {
      checkId,
      slotRevision,
      scheduleId,
      localDate: date,
      kind,
      windows: timed ? [{ start, end }] : null,
      note: note.trim() || null,
    }
    const idempotencyKey = requests.requestIdFor(scope, payload)
    setPending(true)
    try {
      const result = await onAdd({ ...payload, idempotencyKey })
      if (!result.ok) {
        requests.settle(scope)
        if (result.code === "invalid_input" && "fieldErrors" in result) {
          setErrors(
            Object.fromEntries(
              Object.entries(result.fieldErrors ?? {}).filter(
                (e): e is [string, string] => typeof e[1] === "string"
              )
            )
          )
          setFailure({ text: result.message, reload: false })
          return
        }
        const conflict = result.code === "revision_conflict"
        setFailure({
          text: conflict ? DC.conflict : result.message,
          reload: conflict,
        })
        return
      }
      requests.settle(scope)
      setNotice({ tone: "success", text: DC.added(date, kind) })
      reset()
      setOpen(false)
      router.refresh()
    } catch (cause) {
      // The same intent keeps its key: Try again replays, never adds twice.
      setFailure({ text: sessionEnded(cause) || DC.lost, reload: false })
    } finally {
      setPending(false)
    }
  }

  const timed = kind === "changed_window" || kind === "extra"
  return (
    <>
      <CoverageNotice notice={notice} onDismiss={() => setNotice(null)} />
      <div>
        <Button
          type="button"
          variant="secondary"
          size="touch"
          onClick={() => setOpen(true)}
        >
          <CalendarPlusIcon aria-hidden />
          {DC.open}
        </Button>
      </div>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (pending) return
          if (!next) reset()
          setOpen(next)
        }}
      >
        <DialogContent>
          <form
            className="grid gap-4"
            noValidate
            onSubmit={(e) => {
              e.preventDefault()
              void submit()
            }}
          >
            <DialogHeader>
              <DialogTitle>{DC.title}</DialogTitle>
              <DialogDescription>{DC.description}</DialogDescription>
            </DialogHeader>
            <div className="grid min-w-0 gap-1.5">
              <label htmlFor={`${id}-date`} className={LABEL}>
                {DC.date}
              </label>
              <input
                id={`${id}-date`}
                type="date"
                required
                aria-required
                value={date}
                disabled={pending}
                className={INPUT}
                aria-invalid={errors.localDate ? true : undefined}
                aria-describedby={
                  errors.localDate ? `${id}-date-error` : undefined
                }
                onChange={(e) => setDate(e.currentTarget.value)}
              />
              <FieldMessage id={`${id}-date-error`} error={errors.localDate} />
            </div>
            <fieldset
              className="grid min-w-0 gap-1"
              disabled={pending}
              aria-describedby={errors.kind ? `${id}-kind-error` : undefined}
            >
              <legend className={LABEL}>{DC.what}</legend>
              {(["cancelled", "changed_window", "extra"] as const).map((k) => (
                <label key={k} className={ROW}>
                  <input
                    type="radio"
                    name={`${id}-kind`}
                    className="size-5 shrink-0 accent-primary"
                    checked={kind === k}
                    onChange={() => setKind(k)}
                  />
                  {DC.kindLabel[k]}
                </label>
              ))}
              <FieldMessage id={`${id}-kind-error`} error={errors.kind} />
            </fieldset>
            {timed ? (
              <div
                role="group"
                aria-label="Times"
                className="grid gap-3 min-[360px]:grid-cols-2"
              >
                <div className="grid min-w-0 gap-1.5">
                  <label htmlFor={`${id}-start`} className={LABEL}>
                    {DC.from}
                  </label>
                  <input
                    id={`${id}-start`}
                    type="time"
                    value={start}
                    disabled={pending}
                    className={INPUT}
                    aria-describedby={
                      errors.windows ? `${id}-windows-error` : undefined
                    }
                    onChange={(e) => setStart(e.currentTarget.value)}
                  />
                </div>
                <div className="grid min-w-0 gap-1.5">
                  <label htmlFor={`${id}-end`} className={LABEL}>
                    {DC.to}
                  </label>
                  <input
                    id={`${id}-end`}
                    type="time"
                    value={end}
                    disabled={pending}
                    className={INPUT}
                    onChange={(e) => setEnd(e.currentTarget.value)}
                  />
                </div>
                <div className="min-[360px]:col-span-2">
                  <FieldMessage
                    id={`${id}-windows-error`}
                    error={errors.windows}
                  />
                </div>
              </div>
            ) : null}
            <div className="grid min-w-0 gap-1.5">
              <label htmlFor={`${id}-note`} className={LABEL}>
                {DC.note}
              </label>
              <input
                id={`${id}-note`}
                value={note}
                maxLength={500}
                disabled={pending}
                className={INPUT}
                onChange={(e) => setNote(e.currentTarget.value)}
              />
            </div>
            {failure ? (
              <div role="alert" className="grid gap-2">
                <p className="text-meta-touch font-semibold text-negative md:text-meta-strong">
                  {failure.text}
                </p>
                {failure.reload ? (
                  <div>
                    <Button
                      type="button"
                      variant="secondary"
                      size="touch"
                      onClick={() => {
                        router.refresh()
                        reset()
                        setOpen(false)
                      }}
                    >
                      <ArrowClockwiseIcon aria-hidden />
                      {DC.reload}
                    </Button>
                  </div>
                ) : null}
              </div>
            ) : null}
            <DialogFooter>
              <Button
                type="button"
                variant="secondary"
                size="touch"
                disabled={pending}
                onClick={() => {
                  reset()
                  setOpen(false)
                }}
              >
                {DC.cancel}
              </Button>
              <Button
                type="submit"
                size="touch"
                disabled={pending}
                aria-busy={pending || undefined}
              >
                {DC.submit}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
