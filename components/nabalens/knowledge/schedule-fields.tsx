"use client"

import * as React from "react"
import { PlusIcon, TrashIcon } from "@phosphor-icons/react"

import { Button } from "@/components/ui/button"
import type {
  KnowledgeResult,
  Occurrence,
} from "@/lib/knowledge-client/contract"

import { FieldMessage, LABEL, MUTED } from "../amenities/capture/field-parts"

import {
  DAY_LABEL,
  MONTH_WEEKS,
  MONTH_WEEK_LABEL,
  SCHEDULE_COPY as COPY,
  SCHEDULE_LIMITS,
  WEEKDAYS,
  endsNextDay,
  nextDay,
  occurrenceLine,
  type MonthWeek,
  type Repeats,
  type ScheduleDraft,
  type ScheduleField,
  type Weekday,
} from "./schedule-detail"

const INPUT =
  "block min-h-12 w-full min-w-0 rounded-control border border-line-control bg-panel px-3 py-2 text-body-touch text-ink outline-none focus-visible:border-focus focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-1 focus-visible:outline-focus disabled:cursor-not-allowed disabled:bg-well aria-invalid:border-negative md:text-body"
const ROW =
  "flex min-h-11 min-w-11 cursor-pointer items-center gap-3 text-body-touch text-ink has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-focus md:text-body"
const REPEATS: Repeats[] = ["weekly", "monthly", "dated"]

const describedBy = (...ids: (string | false | null | undefined)[]) =>
  ids.filter(Boolean).join(" ") || undefined

/**
 * When (B03 UI design §5.1): starts on, last day offered, how it repeats and
 * its times, in the venue's time zone (read-only). `changing` is a schedule
 * in use being changed from a date.
 */
export function ScheduleFields({
  id,
  value,
  onChange,
  errors,
  timezone,
  changing = false,
  disabled,
}: {
  id: string
  value: ScheduleDraft
  onChange: (next: ScheduleDraft) => void
  errors: Partial<Record<ScheduleField, string>>
  timezone: string
  changing?: boolean
  disabled?: boolean
}) {
  const set = (patch: Partial<ScheduleDraft>) =>
    onChange({ ...value, ...patch })
  const focusAfter = (target: string) =>
    requestAnimationFrame(() => document.getElementById(target)?.focus())

  return (
    <fieldset className="grid min-w-0 gap-4" disabled={disabled}>
      <legend className={LABEL}>{COPY.when}</legend>
      <p className={MUTED}>{COPY.timezone(timezone)}</p>
      {changing ? (
        <p className="text-body-touch text-ink md:text-body">
          {COPY.changeHelp}
        </p>
      ) : null}

      <div className="grid gap-3 min-[400px]:grid-cols-2">
        <div className="grid min-w-0 gap-1.5">
          <label htmlFor={`${id}-from`} className={LABEL}>
            {changing ? COPY.changeFrom : COPY.startsOn}
          </label>
          <input
            id={`${id}-from`}
            type="date"
            required
            aria-required
            value={value.effectiveFrom}
            className={INPUT}
            aria-invalid={errors.effectiveFrom ? true : undefined}
            aria-describedby={describedBy(
              errors.effectiveFrom && `${id}-from-error`
            )}
            onChange={(e) => set({ effectiveFrom: e.currentTarget.value })}
          />
          <FieldMessage id={`${id}-from-error`} error={errors.effectiveFrom} />
        </div>
        <div className="grid min-w-0 gap-1.5">
          <label htmlFor={`${id}-to`} className={LABEL}>
            {COPY.lastDay}
          </label>
          <input
            id={`${id}-to`}
            type="date"
            min={value.effectiveFrom || undefined}
            value={value.effectiveTo}
            className={INPUT}
            aria-invalid={errors.effectiveTo ? true : undefined}
            aria-describedby={describedBy(
              `${id}-to-help`,
              errors.effectiveTo && `${id}-to-error`
            )}
            onChange={(e) => set({ effectiveTo: e.currentTarget.value })}
          />
          <p id={`${id}-to-help`} className={MUTED}>
            {COPY.lastDayHelp}
          </p>
          <FieldMessage id={`${id}-to-error`} error={errors.effectiveTo} />
        </div>
      </div>

      <fieldset
        className="grid min-w-0 gap-2"
        aria-describedby={describedBy(
          errors.recurrence && `${id}-recurrence-error`
        )}
      >
        <legend className={LABEL}>{COPY.repeats}</legend>
        {REPEATS.map((r) => (
          <label key={r} className={ROW}>
            <input
              type="radio"
              name={`${id}-repeats`}
              className="size-5 shrink-0 accent-primary"
              checked={value.repeats === r}
              onChange={() => set({ repeats: r })}
            />
            {COPY.repeatsLabel[r]}
          </label>
        ))}

        {value.repeats === "weekly" ? (
          <fieldset className="grid min-w-0 gap-1">
            <legend className={LABEL}>{COPY.whichDays}</legend>
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              {WEEKDAYS.map((day) => (
                <label key={day} className={ROW}>
                  <input
                    type="checkbox"
                    name={`${id}-day`}
                    aria-label={DAY_LABEL[day].long}
                    className="size-5 shrink-0 accent-primary"
                    checked={value.days.includes(day)}
                    onChange={(e) =>
                      set({
                        days: e.currentTarget.checked
                          ? [...value.days, day]
                          : value.days.filter((d) => d !== day),
                      })
                    }
                  />
                  <span aria-hidden>{DAY_LABEL[day].short}</span>
                </label>
              ))}
            </div>
          </fieldset>
        ) : null}

        {value.repeats === "monthly" ? (
          <div className="grid gap-3 min-[400px]:grid-cols-2">
            <div className="grid min-w-0 gap-1.5">
              <label htmlFor={`${id}-nth`} className={LABEL}>
                {COPY.whichWeek}
              </label>
              <select
                id={`${id}-nth`}
                value={value.nth === null ? "" : String(value.nth)}
                className={INPUT}
                onChange={(e) =>
                  set({
                    nth: e.currentTarget.value
                      ? (Number(e.currentTarget.value) as MonthWeek)
                      : null,
                  })
                }
              >
                <option value="">Choose…</option>
                {MONTH_WEEKS.map((n) => (
                  <option key={n} value={String(n)}>
                    {MONTH_WEEK_LABEL[String(n)]}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid min-w-0 gap-1.5">
              <label htmlFor={`${id}-month-day`} className={LABEL}>
                {COPY.whichDay}
              </label>
              <select
                id={`${id}-month-day`}
                value={value.monthDay}
                className={INPUT}
                onChange={(e) =>
                  set({ monthDay: e.currentTarget.value as Weekday | "" })
                }
              >
                <option value="">Choose…</option>
                {WEEKDAYS.map((day) => (
                  <option key={day} value={day}>
                    {DAY_LABEL[day].long}
                  </option>
                ))}
              </select>
            </div>
          </div>
        ) : null}

        {value.repeats === "dated" ? (
          <div className="grid min-w-0 gap-2">
            {value.dates.map((date, i) => (
              <div key={i} className="flex min-w-0 flex-wrap items-end gap-2">
                <div className="grid min-w-0 flex-1 basis-48 gap-1.5">
                  <label htmlFor={`${id}-date${i}`} className={LABEL}>
                    {COPY.date(i + 1)}
                  </label>
                  <input
                    id={`${id}-date${i}`}
                    type="date"
                    value={date}
                    className={INPUT}
                    onChange={(e) =>
                      set({
                        dates: value.dates.map((d, j) =>
                          j === i ? e.currentTarget.value : d
                        ),
                      })
                    }
                  />
                </div>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    set({ dates: value.dates.filter((_, j) => j !== i) })
                    focusAfter(`${id}-add-date`)
                  }}
                >
                  <TrashIcon aria-hidden />
                  {COPY.removeDate(i + 1)}
                </Button>
              </div>
            ))}
            <div>
              <Button
                id={`${id}-add-date`}
                type="button"
                variant="secondary"
                size="sm"
                disabled={value.dates.length >= SCHEDULE_LIMITS.dates}
                onClick={() => {
                  set({ dates: [...value.dates, ""] })
                  focusAfter(`${id}-date${value.dates.length}`)
                }}
              >
                <PlusIcon aria-hidden />
                {COPY.addDate}
              </Button>
            </div>
          </div>
        ) : null}
        <FieldMessage id={`${id}-recurrence-error`} error={errors.recurrence} />
      </fieldset>

      <div
        role="group"
        className="grid min-w-0 gap-3"
        aria-labelledby={`${id}-times-title`}
        aria-describedby={describedBy(
          `${id}-times-help`,
          errors.windows && `${id}-windows-error`
        )}
      >
        <p id={`${id}-times-title`} className={LABEL}>
          {COPY.times}
        </p>
        <p id={`${id}-times-help`} className={MUTED}>
          {COPY.timesHelp}
        </p>
        {value.windows.map((w, i) => {
          const overnight = endsNextDay(w)
          const setWindow = (patch: Partial<typeof w>) =>
            set({
              windows: value.windows.map((x, j) =>
                j === i ? { ...x, ...patch } : x
              ),
            })
          return (
            <fieldset
              key={i}
              className="grid min-w-0 gap-2 rounded-card bg-well p-3"
            >
              <legend className={LABEL}>{COPY.time(i + 1)}</legend>
              <div className="grid gap-3 min-[360px]:grid-cols-2">
                <div className="grid min-w-0 gap-1.5">
                  <label htmlFor={`${id}-w${i}-start`} className={LABEL}>
                    {COPY.from}
                  </label>
                  <input
                    id={`${id}-w${i}-start`}
                    type="time"
                    value={w.start}
                    className={INPUT}
                    onChange={(e) =>
                      setWindow({ start: e.currentTarget.value })
                    }
                  />
                </div>
                <div className="grid min-w-0 gap-1.5">
                  <label htmlFor={`${id}-w${i}-end`} className={LABEL}>
                    {COPY.to}
                  </label>
                  <input
                    id={`${id}-w${i}-end`}
                    type="time"
                    value={w.end}
                    className={INPUT}
                    aria-describedby={
                      overnight ? `${id}-w${i}-overnight` : undefined
                    }
                    onChange={(e) => setWindow({ end: e.currentTarget.value })}
                  />
                </div>
              </div>
              {overnight ? (
                <p id={`${id}-w${i}-overnight`} className={MUTED}>
                  {COPY.endsNextDay}
                </p>
              ) : null}
              {value.windows.length > 1 ? (
                <div>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      set({
                        windows: value.windows.filter((_, j) => j !== i),
                      })
                      focusAfter(`${id}-add-time`)
                    }}
                  >
                    <TrashIcon aria-hidden />
                    {COPY.removeTime(i + 1)}
                  </Button>
                </div>
              ) : null}
            </fieldset>
          )
        })}
        <div>
          <Button
            id={`${id}-add-time`}
            type="button"
            variant="secondary"
            size="sm"
            disabled={value.windows.length >= SCHEDULE_LIMITS.windows}
            onClick={() => {
              set({ windows: [...value.windows, { start: "", end: "" }] })
              focusAfter(`${id}-w${value.windows.length}-start`)
            }}
          >
            <PlusIcon aria-hidden />
            {COPY.addTime}
          </Button>
        </div>
        <FieldMessage id={`${id}-windows-error`} error={errors.windows} />
      </div>
    </fieldset>
  )
}

const PREVIEW_DELAY_MS = 500
const PREVIEW_SHOWN = 8

/** `date` plus `days`, as a YYYY-MM-DD local date. */
function addDays(date: string, days: number) {
  let d = date
  for (let i = 0; i < days; i++) d = nextDay(d)
  return d
}

type PreviewState =
  | { kind: "invalid" }
  | { kind: "loading" }
  | { kind: "shown"; occurrences: Occurrence[] }
  | { kind: "failed" }

/**
 * "Next dates if you send this" (§5.1): the server's expansion of the
 * schedule as written (never computed here), 500 ms after the last change
 * while it is valid. A failed read never blocks sending.
 */
export function SchedulePreview({
  id,
  schedule,
  timezone,
  today,
  preview,
}: {
  id: string
  /** The shape to preview, or null while the editor is invalid. */
  schedule: Record<string, unknown> | null
  timezone: string
  today: string
  preview: (input: {
    schedule: Record<string, unknown>
    timezone: string
    from: string
    to: string
  }) => Promise<KnowledgeResult<{ occurrences: Occurrence[] }>>
}) {
  const [state, setState] = React.useState<PreviewState>({ kind: "invalid" })
  const key = schedule ? JSON.stringify(schedule) : null
  const latest = React.useRef(0)

  React.useEffect(() => {
    const run = ++latest.current
    if (!key || !schedule) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- follows the editor
      setState({ kind: "invalid" })
      return
    }
    setState({ kind: "loading" })
    const timer = setTimeout(() => {
      const starts = String(schedule.effectiveFrom ?? today)
      const from = starts > today ? starts : today
      void preview({ schedule, timezone, from, to: addDays(from, 91) })
        .then((result) => {
          if (run !== latest.current) return
          setState(
            result.ok
              ? { kind: "shown", occurrences: result.occurrences }
              : { kind: "failed" }
          )
        })
        .catch(() => {
          if (run === latest.current) setState({ kind: "failed" })
        })
    }, PREVIEW_DELAY_MS)
    return () => clearTimeout(timer)
    // The key stands for the schedule's content.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, timezone, today])

  const shown =
    state.kind === "shown" ? state.occurrences.slice(0, PREVIEW_SHOWN) : []
  return (
    <section
      aria-labelledby={`${id}-title`}
      className="grid min-w-0 gap-2 rounded-card bg-well p-3"
    >
      <h3 id={`${id}-title`} className={LABEL}>
        {COPY.previewTitle}
      </h3>
      {state.kind === "invalid" ? (
        <p className={MUTED}>{COPY.previewInvalid}</p>
      ) : state.kind === "failed" ? (
        <p className="text-body-touch text-ink md:text-body">
          {COPY.previewFailed}
        </p>
      ) : state.kind === "shown" ? (
        shown.length ? (
          <ul className="grid gap-1 text-body-touch text-ink md:text-body">
            {shown.map((o) => (
              <li key={`${o.localDate}-${o.startsAt}`}>
                {occurrenceLine(o, timezone)}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-body-touch text-ink md:text-body">
            {COPY.previewNone}
          </p>
        )
      ) : null}
      <p role="status" aria-live="polite" className="sr-only">
        {state.kind === "shown" ? COPY.previewShown(shown.length) : ""}
      </p>
    </section>
  )
}
