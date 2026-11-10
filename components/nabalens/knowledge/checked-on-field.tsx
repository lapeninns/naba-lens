"use client"

import { FieldMessage, LABEL, MUTED } from "../amenities/capture/field-parts"

import {
  CHECKED_ON_COPY,
  CHECKED_ON_MAX_DAYS_AGO,
  chooseCheckedOn,
  daysBefore,
  type CheckedOn,
} from "./checked-on"

const INPUT =
  "block min-h-12 w-full min-w-0 rounded-control border border-line-control bg-panel px-3 py-2 text-body-touch text-ink outline-none focus-visible:border-focus focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-1 focus-visible:outline-focus disabled:cursor-not-allowed disabled:bg-well aria-invalid:border-negative md:text-body"

/**
 * "When did you check?" (B03 UI design §3.2). 44 px or more at every width.
 * Any change makes the date chosen; `notice` says why a reopened draft's
 * date was cleared.
 */
export function CheckedOnField({
  id,
  value,
  today,
  onChange,
  error,
  notice,
  disabled,
}: {
  id: string
  value: CheckedOn
  /** London date, YYYY-MM-DD. */
  today: string
  onChange: (next: CheckedOn) => void
  error?: string
  notice?: string | null
  disabled?: boolean
}) {
  const describedBy =
    [`${id}-help`, notice ? `${id}-notice` : null, error ? `${id}-error` : null]
      .filter(Boolean)
      .join(" ") || undefined
  return (
    <div className="grid min-w-0 gap-1.5">
      <label htmlFor={id} className={LABEL}>
        {CHECKED_ON_COPY.label}
      </label>
      <input
        id={id}
        type="date"
        required
        aria-required
        min={daysBefore(today, CHECKED_ON_MAX_DAYS_AGO)}
        max={today}
        value={value.date ?? ""}
        disabled={disabled}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={INPUT}
        onChange={(e) => onChange(chooseCheckedOn(e.currentTarget.value))}
      />
      <p id={`${id}-help`} className={MUTED}>
        {CHECKED_ON_COPY.help}
      </p>
      {notice ? (
        <p
          id={`${id}-notice`}
          className="text-body-touch text-ink md:text-body"
        >
          {notice}
        </p>
      ) : null}
      <FieldMessage id={`${id}-error`} error={error} />
    </div>
  )
}
