"use client"

import * as React from "react"
import { PlusIcon, XIcon } from "@phosphor-icons/react"

import { Button } from "@/components/ui/button"
import type { Place, PlaceRef } from "@/lib/knowledge-client/contract"

import { FieldMessage, LABEL, MUTED } from "../amenities/capture/field-parts"

import {
  FACILITY_COPY as COPY,
  FACILITY_LIMITS,
  type FacilityAvailability,
  type FacilityDraft,
  type FacilityFeeKind,
  type FacilityField,
} from "./facility-detail"

const INPUT =
  "block min-h-12 w-full min-w-0 rounded-control border border-line-control bg-panel px-3 py-2 text-body-touch text-ink outline-none focus-visible:border-focus focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-1 focus-visible:outline-focus disabled:cursor-not-allowed disabled:bg-well aria-invalid:border-negative md:text-body"
const ROW =
  "flex min-h-11 cursor-pointer items-center gap-3 text-body-touch text-ink has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-focus md:text-body"
const SUMMARY =
  "min-h-11 cursor-pointer content-center rounded-control text-body-touch font-semibold text-ink outline-none focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-focus focus-visible:outline-solid md:text-body"

const AVAILABILITY: FacilityAvailability[] = [
  "available",
  "on_request",
  "seasonal",
]
const FEES: FacilityFeeKind[] = ["not_recorded", "free", "charged"]

const describedBy = (...ids: (string | false | null | undefined)[]) =>
  ids.filter(Boolean).join(" ") || undefined

/**
 * A facility answer's detail (B03 UI design §3.2). Optional sections open
 * from a disclosure; one with an error or a value starts open.
 */
export function FacilityDetailFields({
  id,
  value,
  onChange,
  places,
  venueName,
  errors,
  disabled,
}: {
  id: string
  value: FacilityDraft
  onChange: (next: FacilityDraft) => void
  /** The venue's active places, for "Where is it?". */
  places: Place[]
  venueName: string
  errors: Partial<Record<FacilityField, string>>
  disabled?: boolean
}) {
  const [label, setLabel] = React.useState("")
  const set = (patch: Partial<FacilityDraft>) =>
    onChange({ ...value, ...patch })
  const chosen = (subjectId: string) =>
    value.locations.some(
      (ref) => "subjectId" in ref && ref.subjectId === subjectId
    )
  const typed = value.locations.filter(
    (ref): ref is { label: string } => "label" in ref
  )

  function togglePlace(subjectId: string, on: boolean) {
    set({
      locations: on
        ? [...value.locations, { subjectId }]
        : value.locations.filter(
            (ref) => !("subjectId" in ref && ref.subjectId === subjectId)
          ),
    })
  }

  function addLabel() {
    const name = label.trim()
    if (!name) return
    set({ locations: [...value.locations, { label: name } as PlaceRef] })
    setLabel("")
  }

  function removeLabel(name: string) {
    set({
      locations: value.locations.filter(
        (ref) => !("label" in ref && ref.label === name)
      ),
    })
    requestAnimationFrame(() => document.getElementById(`${id}-label`)?.focus())
  }

  return (
    <div className="grid min-w-0 gap-5">
      <fieldset
        className="grid min-w-0 gap-2"
        aria-describedby={describedBy(
          `${id}-where-help`,
          errors.locations && `${id}-where-error`
        )}
        disabled={disabled}
      >
        <legend className={LABEL}>{COPY.where}</legend>
        <p id={`${id}-where-help`} className={MUTED}>
          {places.length ? COPY.whereHelp : COPY.noPlaces(venueName)}
        </p>
        {places.map((place) => (
          <label key={place.subjectId} className={ROW}>
            <input
              type="checkbox"
              className="size-5 shrink-0 accent-primary"
              checked={chosen(place.subjectId)}
              onChange={(e) =>
                togglePlace(place.subjectId, e.currentTarget.checked)
              }
            />
            <span className="[overflow-wrap:anywhere]">{place.label}</span>
          </label>
        ))}
        {typed.length ? (
          <ul className="grid gap-1">
            {typed.map((ref) => (
              <li
                key={ref.label}
                className="flex min-w-0 items-center justify-between gap-2"
              >
                <span className="text-body-touch [overflow-wrap:anywhere] text-ink md:text-body">
                  {ref.label}
                </span>
                <Button
                  type="button"
                  variant="quiet"
                  size="icon-sm"
                  aria-label={COPY.removePlace(ref.label)}
                  onClick={() => removeLabel(ref.label)}
                >
                  <XIcon aria-hidden />
                </Button>
              </li>
            ))}
          </ul>
        ) : null}
        <div className="grid min-w-0 gap-1.5">
          <label htmlFor={`${id}-label`} className={LABEL}>
            {places.length ? COPY.somewhereElse : COPY.nameThePlace}
          </label>
          <div className="flex min-w-0 flex-wrap gap-2">
            <input
              id={`${id}-label`}
              value={label}
              maxLength={FACILITY_LIMITS.label}
              className={`${INPUT} flex-1 basis-48`}
              onChange={(e) => setLabel(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault()
                  addLabel()
                }
              }}
            />
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={addLabel}
              disabled={!label.trim()}
            >
              <PlusIcon aria-hidden />
              {COPY.addPlace}
            </Button>
          </div>
        </div>
        <FieldMessage id={`${id}-where-error`} error={errors.locations} />
      </fieldset>

      <details
        open={value.availability !== null || !!errors.availability || undefined}
        className="grid gap-2"
      >
        <summary className={SUMMARY}>{COPY.availability}</summary>
        <fieldset
          className="grid gap-1 pt-2"
          disabled={disabled}
          aria-describedby={describedBy(
            errors.availability && `${id}-availability-error`
          )}
        >
          <legend className="sr-only">{COPY.availability}</legend>
          {AVAILABILITY.map((state) => (
            <label key={state} className={ROW}>
              <input
                type="radio"
                name={`${id}-availability`}
                className="size-5 shrink-0 accent-primary"
                checked={value.availability === state}
                onChange={() => set({ availability: state })}
              />
              {COPY.availabilityLabel[state]}
            </label>
          ))}
          <FieldMessage
            id={`${id}-availability-error`}
            error={errors.availability}
          />
        </fieldset>
      </details>

      <details
        open={value.fees.kind !== "not_recorded" || !!errors.fees || undefined}
        className="grid gap-2"
      >
        <summary className={SUMMARY}>{COPY.fees}</summary>
        <fieldset
          className="grid gap-1 pt-2"
          disabled={disabled}
          aria-describedby={describedBy(
            `${id}-fees-help`,
            errors.fees && `${id}-fees-error`
          )}
        >
          <legend className="sr-only">{COPY.fees}</legend>
          <p id={`${id}-fees-help`} className={MUTED}>
            {COPY.feesHelp}
          </p>
          {FEES.map((kind) => (
            <label key={kind} className={ROW}>
              <input
                type="radio"
                name={`${id}-fees`}
                className="size-5 shrink-0 accent-primary"
                checked={value.fees.kind === kind}
                onChange={() => set({ fees: { ...value.fees, kind } })}
              />
              {COPY.feeLabel[kind]}
            </label>
          ))}
          {value.fees.kind === "charged" ? (
            <div className="grid gap-3 min-[400px]:grid-cols-2">
              <div className="grid min-w-0 gap-1.5">
                <label htmlFor={`${id}-amount`} className={LABEL}>
                  {COPY.amount}
                </label>
                <input
                  id={`${id}-amount`}
                  inputMode="decimal"
                  value={value.fees.amount}
                  className={INPUT}
                  aria-invalid={errors.fees ? true : undefined}
                  aria-describedby={describedBy(
                    errors.fees && `${id}-fees-error`
                  )}
                  onChange={(e) =>
                    set({
                      fees: { ...value.fees, amount: e.currentTarget.value },
                    })
                  }
                />
              </div>
              <div className="grid min-w-0 gap-1.5">
                <label htmlFor={`${id}-unit`} className={LABEL}>
                  {COPY.per}
                </label>
                <input
                  id={`${id}-unit`}
                  value={value.fees.unit}
                  maxLength={FACILITY_LIMITS.unit}
                  className={INPUT}
                  aria-describedby={`${id}-unit-help`}
                  onChange={(e) =>
                    set({
                      fees: { ...value.fees, unit: e.currentTarget.value },
                    })
                  }
                />
                <p id={`${id}-unit-help`} className={MUTED}>
                  {COPY.perHelp}
                </p>
              </div>
            </div>
          ) : null}
          <FieldMessage id={`${id}-fees-error`} error={errors.fees} />
        </fieldset>
      </details>

      {/* Limitations is the capture form's own field, so it isn't asked twice. */}
      {(
        [
          [
            "howToRequest",
            COPY.howToRequest,
            COPY.howToRequestHelp,
            FACILITY_LIMITS.howToRequest,
          ],
        ] as const
      ).map(([field, title, help, max]) => (
        <div key={field} className="grid min-w-0 gap-1.5">
          <label htmlFor={`${id}-${field}`} className={LABEL}>
            {title}
          </label>
          <textarea
            id={`${id}-${field}`}
            rows={3}
            maxLength={max}
            disabled={disabled}
            value={value[field]}
            className={INPUT}
            aria-invalid={errors[field] ? true : undefined}
            aria-describedby={describedBy(
              `${id}-${field}-help`,
              errors[field] && `${id}-${field}-error`
            )}
            onChange={(e) => set({ [field]: e.currentTarget.value })}
          />
          <p id={`${id}-${field}-help`} className={MUTED}>
            {help}
          </p>
          <FieldMessage id={`${id}-${field}-error`} error={errors[field]} />
        </div>
      ))}
    </div>
  )
}
