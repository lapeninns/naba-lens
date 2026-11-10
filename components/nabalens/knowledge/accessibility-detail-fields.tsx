"use client"

import * as React from "react"
import { PlusIcon, TrashIcon } from "@phosphor-icons/react"

import { Button } from "@/components/ui/button"
import type {
  Place,
  PlaceRef,
  QuestionFeature,
} from "@/lib/knowledge-client/contract"

import { FieldMessage, LABEL, MUTED } from "../amenities/capture/field-parts"

import {
  ACCESS_COPY as COPY,
  emptyMeasurement,
  scopeName,
  stepFreeLine,
  type AccessDraft,
  type AccessField,
  type FeatureValue,
  type MeasureMethod,
  type MeasureUnit,
} from "./accessibility-detail"

const INPUT =
  "block min-h-12 w-full min-w-0 rounded-control border border-line-control bg-panel px-3 py-2 text-body-touch text-ink outline-none focus-visible:border-focus focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-1 focus-visible:outline-focus disabled:cursor-not-allowed disabled:bg-well aria-invalid:border-negative md:text-body"
const ROW =
  "flex min-h-11 cursor-pointer items-center gap-3 text-body-touch text-ink has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-focus md:text-body"
const VALUES: FeatureValue[] = ["yes", "no", "not_checked"]
const UNITS: MeasureUnit[] = ["mm", "cm", "degrees"]
const METHODS: MeasureMethod[] = ["tape", "gauge", "other"]

const describedBy = (...ids: (string | false | null | undefined)[]) =>
  ids.filter(Boolean).join(" ") || undefined

/** Three choices in one fieldset: a place's or a feature's result. */
function TriChoice({
  name,
  legend,
  value,
  words,
  onChange,
  describedById,
}: {
  name: string
  legend: string
  value: FeatureValue
  words: Record<FeatureValue, string>
  onChange: (v: FeatureValue) => void
  describedById?: string
}) {
  return (
    <fieldset className="grid min-w-0 gap-1" aria-describedby={describedById}>
      <legend className="text-body-touch font-semibold [overflow-wrap:anywhere] text-ink md:text-body">
        {legend}
      </legend>
      <div className="grid gap-1 min-[360px]:grid-cols-3">
        {VALUES.map((v) => (
          <label key={v} className={ROW}>
            <input
              type="radio"
              name={name}
              className="size-5 shrink-0 accent-primary"
              checked={value === v}
              onChange={() => onChange(v)}
            />
            {words[v]}
          </label>
        ))}
      </div>
    </fieldset>
  )
}

/**
 * An accessibility answer's own detail (B03 UI design §3.2, §3.3). Step-free
 * entrance lists the venue's entrances from Places, each with its result;
 * any other question asks what was checked. Features and measurements come
 * from the question's version: none means no section.
 */
export function AccessDetailFields({
  id,
  value,
  onChange,
  answer,
  stepFree,
  places,
  features,
  venueName,
  canManagePlaces,
  errors,
  today,
  disabled,
}: {
  id: string
  value: AccessDraft
  onChange: (next: AccessDraft) => void
  answer: string | null
  stepFree: boolean
  /** The venue's active places. */
  places: Place[]
  features: QuestionFeature[]
  venueName: string
  canManagePlaces: boolean
  errors: Partial<Record<AccessField, string>>
  today: string
  disabled?: boolean
}) {
  const set = (patch: Partial<AccessDraft>) => onChange({ ...value, ...patch })
  const entrances = places.filter((p) => p.kind === "entrance")
  const measurable = features.filter((f) => f.measurable)
  const [typed, setTyped] = React.useState(
    value.scope && "label" in value.scope ? value.scope.label : ""
  )
  const elsewhere = value.scope !== null && "label" in value.scope
  const line = stepFree
    ? stepFreeLine(value, { answer, entrances, venueName })
    : null

  function chooseScope(scope: PlaceRef | null) {
    set({ scope })
  }

  function setMeasurement(
    i: number,
    patch: Partial<AccessDraft["measurements"][number]>
  ) {
    set({
      measurements: value.measurements.map((m, j) =>
        j === i ? { ...m, ...patch } : m
      ),
    })
  }

  function removeMeasurement(i: number) {
    set({ measurements: value.measurements.filter((_, j) => j !== i) })
    requestAnimationFrame(() =>
      document
        .getElementById(
          i < value.measurements.length - 1
            ? `${id}-m${i}-feature`
            : `${id}-add-measurement`
        )
        ?.focus()
    )
  }

  return (
    <div className="grid min-w-0 gap-5">
      {stepFree ? (
        <fieldset
          className="grid min-w-0 gap-3"
          disabled={disabled}
          aria-describedby={describedBy(
            `${id}-entrances-help`,
            line && `${id}-entrances-line`,
            errors.entrances && `${id}-entrances-error`
          )}
        >
          <legend className={LABEL}>{COPY.entrances}</legend>
          {entrances.length ? (
            <p id={`${id}-entrances-help`} className={MUTED}>
              {COPY.entrancesHelp}
            </p>
          ) : (
            <p
              id={`${id}-entrances-help`}
              className="text-body-touch text-ink md:text-body"
            >
              {COPY.noEntrances(venueName)}{" "}
              {canManagePlaces
                ? COPY.addEntrancesManager
                : COPY.addEntrancesStaff}
            </p>
          )}
          {entrances.map((p) => (
            <TriChoice
              key={p.subjectId}
              name={`${id}-entrance-${p.subjectId}`}
              legend={p.label}
              value={value.entrances[p.subjectId] ?? "not_checked"}
              words={COPY.entranceValue}
              onChange={(v) =>
                set({ entrances: { ...value.entrances, [p.subjectId]: v } })
              }
            />
          ))}
          {line ? (
            <p id={`${id}-entrances-line`} className={MUTED}>
              {line}
            </p>
          ) : null}
          <FieldMessage id={`${id}-entrances-error`} error={errors.entrances} />
        </fieldset>
      ) : (
        <fieldset
          className="grid min-w-0 gap-2"
          disabled={disabled}
          aria-describedby={describedBy(
            `${id}-scope-help`,
            errors.scope && `${id}-scope-error`
          )}
        >
          <legend className={LABEL}>{COPY.scope} (required)</legend>
          <p id={`${id}-scope-help`} className={MUTED}>
            {places.length ? COPY.scopeHelp : COPY.noPlaces(venueName)}
          </p>
          {places.map((p) => (
            <label key={p.subjectId} className={ROW}>
              <input
                type="radio"
                name={`${id}-scope`}
                className="size-5 shrink-0 accent-primary"
                checked={
                  value.scope !== null &&
                  "subjectId" in value.scope &&
                  value.scope.subjectId === p.subjectId
                }
                onChange={() => chooseScope({ subjectId: p.subjectId })}
              />
              <span className="[overflow-wrap:anywhere]">{p.label}</span>
            </label>
          ))}
          <label className={ROW}>
            <input
              type="radio"
              name={`${id}-scope`}
              className="size-5 shrink-0 accent-primary"
              checked={elsewhere}
              onChange={() =>
                chooseScope(
                  typed.trim() ? { label: typed.trim() } : { label: "" }
                )
              }
            />
            {COPY.somewhereElse}
          </label>
          {elsewhere || !places.length ? (
            <div className="grid min-w-0 gap-1.5">
              <label htmlFor={`${id}-scope-label`} className={LABEL}>
                {COPY.nameThePlace}
              </label>
              <input
                id={`${id}-scope-label`}
                value={typed}
                maxLength={80}
                className={INPUT}
                aria-invalid={errors.scope ? true : undefined}
                onChange={(e) => {
                  setTyped(e.currentTarget.value)
                  const name = e.currentTarget.value.trim()
                  chooseScope(name ? { label: name } : null)
                }}
              />
            </div>
          ) : null}
          {value.scope && scopeName(value.scope, places).trim() ? (
            <p className="text-body-touch text-ink md:text-body">
              {COPY.covers(scopeName(value.scope, places))}
            </p>
          ) : null}
          <FieldMessage id={`${id}-scope-error`} error={errors.scope} />
        </fieldset>
      )}

      {features.length ? (
        <div
          className="grid min-w-0 gap-3"
          role="group"
          aria-labelledby={`${id}-features-title`}
          aria-describedby={describedBy(
            `${id}-features-help`,
            errors.features && `${id}-features-error`
          )}
        >
          <p id={`${id}-features-title`} className={LABEL}>
            Features
          </p>
          <p id={`${id}-features-help`} className={MUTED}>
            {COPY.featureHelp}
          </p>
          {features.map((f) => (
            <TriChoice
              key={f.key}
              name={`${id}-feature-${f.key}`}
              legend={f.label}
              value={value.features[f.key] ?? "not_checked"}
              words={COPY.featureValue}
              onChange={(v) =>
                set({ features: { ...value.features, [f.key]: v } })
              }
            />
          ))}
          <FieldMessage id={`${id}-features-error`} error={errors.features} />
        </div>
      ) : null}

      {measurable.length ? (
        <div className="grid min-w-0 gap-3">
          <p id={`${id}-measure-help`} className={MUTED}>
            {COPY.measurementsHelp}
          </p>
          {value.measurements.map((m, i) => (
            <fieldset
              key={i}
              className="grid min-w-0 gap-3 rounded-card bg-well p-3"
              disabled={disabled}
            >
              <legend className={LABEL}>{COPY.measurement(i + 1)}</legend>
              <div className="grid min-w-0 gap-1.5">
                <label htmlFor={`${id}-m${i}-feature`} className={LABEL}>
                  {COPY.feature}
                </label>
                <select
                  id={`${id}-m${i}-feature`}
                  value={m.feature}
                  className={INPUT}
                  onChange={(e) =>
                    setMeasurement(i, { feature: e.currentTarget.value })
                  }
                >
                  <option value="">Choose…</option>
                  {measurable.map((f) => (
                    <option key={f.key} value={f.key}>
                      {f.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid gap-3 min-[400px]:grid-cols-2">
                <div className="grid min-w-0 gap-1.5">
                  <label htmlFor={`${id}-m${i}-value`} className={LABEL}>
                    {COPY.value}
                  </label>
                  <input
                    id={`${id}-m${i}-value`}
                    inputMode="decimal"
                    value={m.value}
                    className={INPUT}
                    onChange={(e) =>
                      setMeasurement(i, { value: e.currentTarget.value })
                    }
                  />
                </div>
                <div className="grid min-w-0 gap-1.5">
                  <label htmlFor={`${id}-m${i}-unit`} className={LABEL}>
                    {COPY.unit}
                  </label>
                  <select
                    id={`${id}-m${i}-unit`}
                    value={m.unit}
                    className={INPUT}
                    onChange={(e) =>
                      setMeasurement(i, {
                        unit: e.currentTarget.value as MeasureUnit | "",
                      })
                    }
                  >
                    <option value="">Choose…</option>
                    {UNITS.map((u) => (
                      <option key={u} value={u}>
                        {COPY.unitLabel[u]}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="grid gap-3 min-[400px]:grid-cols-2">
                <div className="grid min-w-0 gap-1.5">
                  <label htmlFor={`${id}-m${i}-date`} className={LABEL}>
                    {COPY.measuredOn}
                  </label>
                  <input
                    id={`${id}-m${i}-date`}
                    type="date"
                    max={today}
                    value={m.measuredOn}
                    className={INPUT}
                    onChange={(e) =>
                      setMeasurement(i, { measuredOn: e.currentTarget.value })
                    }
                  />
                </div>
                <div className="grid min-w-0 gap-1.5">
                  <label htmlFor={`${id}-m${i}-method`} className={LABEL}>
                    {COPY.method}
                  </label>
                  <select
                    id={`${id}-m${i}-method`}
                    value={m.method}
                    className={INPUT}
                    onChange={(e) =>
                      setMeasurement(i, {
                        method: e.currentTarget.value as MeasureMethod | "",
                      })
                    }
                  >
                    <option value="">Choose…</option>
                    {METHODS.map((x) => (
                      <option key={x} value={x}>
                        {COPY.methodLabel[x]}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => removeMeasurement(i)}
                >
                  <TrashIcon aria-hidden />
                  {COPY.removeMeasurement(i + 1)}
                </Button>
              </div>
            </fieldset>
          ))}
          <div>
            <Button
              id={`${id}-add-measurement`}
              type="button"
              variant="secondary"
              size="sm"
              disabled={disabled || value.measurements.length >= 20}
              aria-describedby={`${id}-measure-help`}
              onClick={() =>
                set({
                  measurements: [
                    ...value.measurements,
                    emptyMeasurement(
                      measurable.length === 1 ? measurable[0]!.key : ""
                    ),
                  ],
                })
              }
            >
              <PlusIcon aria-hidden />
              {COPY.addAnother}
            </Button>
          </div>
          <FieldMessage
            id={`${id}-measurements-error`}
            error={errors.measurements}
          />
        </div>
      ) : null}
    </div>
  )
}
