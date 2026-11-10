"use client"

import * as React from "react"
import { PlusIcon, TrashIcon } from "@phosphor-icons/react"

import { Button } from "@/components/ui/button"
import type {
  Place,
  PolicyNeed,
  ValueListItem,
} from "@/lib/knowledge-client/contract"

import { FieldMessage, LABEL, MUTED } from "../amenities/capture/field-parts"

import { policyNeedWords } from "./copy"
import {
  POLICY_COPY as COPY,
  POLICY_LIMITS,
  POLICY_STANCES,
  ZONE_STANCES,
  emptyZone,
  listLabel,
  type ConditionDraft,
  type ExceptionDraft,
  type PolicyBasis,
  type PolicyDraft,
  type PolicyField,
  type PolicySource,
  type PolicyStance,
  type ZoneDraft,
} from "./policy-detail"

const INPUT =
  "block min-h-12 w-full min-w-0 rounded-control border border-line-control bg-panel px-3 py-2 text-body-touch text-ink outline-none focus-visible:border-focus focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-1 focus-visible:outline-focus disabled:cursor-not-allowed disabled:bg-well aria-invalid:border-negative md:text-body"
const ROW =
  "flex min-h-11 cursor-pointer items-center gap-3 text-body-touch text-ink has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-focus md:text-body"
const CARD = "grid min-w-0 gap-3 rounded-card bg-well p-3"
const SOURCES: PolicySource[] = ["in_person", "written_policy"]
const ELSEWHERE = "__elsewhere"

const describedBy = (...ids: (string | false | null | undefined)[]) =>
  ids.filter(Boolean).join(" ") || undefined

/**
 * The rule (B03 UI design §4.2.1). With no condition types set up, Allowed
 * with conditions can't be completed, so a statement can't choose it; a
 * staff observation still can (it records what was seen).
 */
export function PolicyRuleField({
  id,
  value,
  onChange,
  staff,
  conditionsAvailable,
  error,
  disabled,
}: {
  id: string
  value: PolicyStance | null
  onChange: (stance: PolicyStance) => void
  staff: boolean
  conditionsAvailable: boolean
  error?: string
  disabled?: boolean
}) {
  const blocked = !staff && !conditionsAvailable
  return (
    <fieldset
      className="grid min-w-0 gap-1"
      disabled={disabled}
      aria-describedby={describedBy(
        staff && `${id}-context`,
        error && `${id}-error`
      )}
    >
      <legend className={LABEL}>{staff ? COPY.ruleSeen : COPY.rule}</legend>
      {staff ? (
        <p id={`${id}-context`} className={MUTED}>
          {COPY.staffContext}
        </p>
      ) : null}
      {POLICY_STANCES.map((stance) => {
        const off = blocked && stance === "conditional"
        return (
          <label key={stance} className={ROW}>
            <input
              type="radio"
              name={`${id}`}
              className="size-5 shrink-0 accent-primary"
              checked={value === stance}
              aria-disabled={off || undefined}
              aria-describedby={off ? `${id}-conditional-off` : undefined}
              onChange={() => {
                if (!off) onChange(stance)
              }}
            />
            {COPY.stanceLabel[stance]}
          </label>
        )
      })}
      {blocked ? (
        <p id={`${id}-conditional-off`} className={MUTED}>
          {COPY.noConditionTypes}
        </p>
      ) : null}
      <FieldMessage id={`${id}-error`} error={error} />
    </fieldset>
  )
}

function Rows<T>({
  id,
  title,
  help,
  required,
  rows,
  addLabel,
  onAdd,
  error,
  disabled,
  children,
}: {
  id: string
  title: string
  help?: string
  required?: boolean
  rows: T[]
  addLabel: string
  onAdd: () => void
  error?: string
  disabled?: boolean
  children: (row: T, i: number) => React.ReactNode
}) {
  return (
    <div
      role="group"
      className="grid min-w-0 gap-3"
      aria-labelledby={`${id}-title`}
      aria-describedby={describedBy(
        help && `${id}-help`,
        error && `${id}-error`
      )}
    >
      <p id={`${id}-title`} className={LABEL}>
        {title}
        {required ? " (required)" : ""}
      </p>
      {help ? (
        <p id={`${id}-help`} className={MUTED}>
          {help}
        </p>
      ) : null}
      {rows.map(children)}
      <div>
        <Button
          id={`${id}-add`}
          type="button"
          variant="secondary"
          size="sm"
          disabled={disabled || rows.length >= POLICY_LIMITS.rows}
          onClick={onAdd}
        >
          <PlusIcon aria-hidden />
          {addLabel}
        </Button>
      </div>
      <FieldMessage id={`${id}-error`} error={error} />
    </div>
  )
}

function RemoveRow({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <div>
      <Button type="button" variant="secondary" size="sm" onClick={onClick}>
        <TrashIcon aria-hidden />
        {label}
      </Button>
    </div>
  )
}

function TypeSelect({
  id,
  label,
  value,
  items,
  onChange,
}: {
  id: string
  label: string
  value: string
  items: readonly ValueListItem[]
  onChange: (code: string) => void
}) {
  const retired = value && !items.some((t) => t.code === value)
  return (
    <div className="grid min-w-0 gap-1.5">
      <label htmlFor={id} className={LABEL}>
        {label}
      </label>
      <select
        id={id}
        value={value}
        className={INPUT}
        onChange={(e) => onChange(e.currentTarget.value)}
      >
        <option value="">Choose…</option>
        {items.map((t) => (
          <option key={t.code} value={t.code}>
            {t.label}
          </option>
        ))}
        {retired ? (
          <option value={value}>{listLabel(value, items)}</option>
        ) : null}
      </select>
    </div>
  )
}

function NoteInput({
  id,
  value,
  onChange,
}: {
  id: string
  value: string
  onChange: (note: string) => void
}) {
  return (
    <div className="grid min-w-0 gap-1.5">
      <label htmlFor={id} className={LABEL}>
        {COPY.note}
      </label>
      <input
        id={id}
        value={value}
        maxLength={POLICY_LIMITS.note}
        className={INPUT}
        onChange={(e) => onChange(e.currentTarget.value)}
      />
    </div>
  )
}

/**
 * A policy's sections after the rule (B03 UI design §4.2): areas, then for a
 * statement conditions, exceptions, what it applies to and who stated it.
 * Staff record only the areas they saw (§4.1).
 */
export function PolicyDetailFields({
  id,
  value,
  onChange,
  places,
  conditionTypes,
  exceptionTypes,
  requiresZones,
  basis,
  canStateOrgPolicy,
  errors,
  today,
  disabled,
}: {
  id: string
  value: PolicyDraft
  onChange: (next: PolicyDraft) => void
  /** The venue's active places. */
  places: Place[]
  conditionTypes: readonly ValueListItem[]
  exceptionTypes: readonly ValueListItem[]
  requiresZones: boolean
  /** The account's basis for a statement; null for a staff observation. */
  basis: PolicyBasis | null
  canStateOrgPolicy: boolean
  errors: Partial<Record<PolicyField, string>>
  today: string
  disabled?: boolean
}) {
  const set = (patch: Partial<PolicyDraft>) => onChange({ ...value, ...patch })
  const focusAfter = (target: string) =>
    requestAnimationFrame(() => document.getElementById(target)?.focus())

  function setRow<K extends "zones" | "conditions" | "exceptions">(
    key: K,
    i: number,
    patch: Partial<PolicyDraft[K][number]>
  ) {
    set({
      [key]: (value[key] as PolicyDraft[K][number][]).map((row, j) =>
        j === i ? { ...row, ...patch } : row
      ),
    } as Partial<PolicyDraft>)
  }

  function removeRow(
    key: "zones" | "conditions" | "exceptions",
    prefix: string,
    i: number
  ) {
    const rows = value[key] as unknown[]
    set({ [key]: rows.filter((_, j) => j !== i) } as Partial<PolicyDraft>)
    focusAfter(
      i < rows.length - 1 ? `${id}-${prefix}${i}-first` : `${id}-${key}-add`
    )
  }

  const zoneChoice = (z: ZoneDraft) =>
    !z.place ? "" : "subjectId" in z.place ? z.place.subjectId : ELSEWHERE

  return (
    <div className="grid min-w-0 gap-5">
      <Rows
        id={`${id}-zones`}
        title={COPY.areas}
        help={COPY.areasHelp}
        required={requiresZones}
        rows={value.zones}
        addLabel={COPY.addArea}
        onAdd={() => set({ zones: [...value.zones, emptyZone()] })}
        error={errors.zones}
        disabled={disabled}
      >
        {(z, i) => (
          <fieldset key={i} className={CARD} disabled={disabled}>
            <legend className={LABEL}>{COPY.area(i + 1)}</legend>
            <div className="grid min-w-0 gap-1.5">
              <label htmlFor={`${id}-z${i}-first`} className={LABEL}>
                {COPY.place}
              </label>
              <select
                id={`${id}-z${i}-first`}
                value={zoneChoice(z)}
                className={INPUT}
                onChange={(e) => {
                  const v = e.currentTarget.value
                  setRow("zones", i, {
                    place: !v
                      ? null
                      : v === ELSEWHERE
                        ? { label: "" }
                        : { subjectId: v },
                  })
                }}
              >
                <option value="">Choose…</option>
                {places.map((p) => (
                  <option key={p.subjectId} value={p.subjectId}>
                    {p.label}
                  </option>
                ))}
                <option value={ELSEWHERE}>{COPY.somewhereElse}</option>
              </select>
            </div>
            {z.place && "label" in z.place ? (
              <div className="grid min-w-0 gap-1.5">
                <label htmlFor={`${id}-z${i}-label`} className={LABEL}>
                  {COPY.nameThePlace}
                </label>
                <input
                  id={`${id}-z${i}-label`}
                  value={z.place.label}
                  maxLength={POLICY_LIMITS.label}
                  className={INPUT}
                  onChange={(e) =>
                    setRow("zones", i, {
                      place: { label: e.currentTarget.value },
                    })
                  }
                />
              </div>
            ) : null}
            <fieldset className="grid min-w-0 gap-1">
              <legend className={LABEL}>{COPY.ruleHere}</legend>
              {ZONE_STANCES.map((stance) => (
                <label key={stance} className={ROW}>
                  <input
                    type="radio"
                    name={`${id}-z${i}-stance`}
                    className="size-5 shrink-0 accent-primary"
                    checked={z.stance === stance}
                    onChange={() => setRow("zones", i, { stance })}
                  />
                  {COPY.stanceLabel[stance]}
                </label>
              ))}
            </fieldset>
            <RemoveRow
              label={COPY.removeArea(i + 1)}
              onClick={() => removeRow("zones", "z", i)}
            />
          </fieldset>
        )}
      </Rows>

      {basis && value.stance === "conditional" ? (
        conditionTypes.length ? (
          <Rows
            id={`${id}-conditions`}
            title={COPY.conditions}
            rows={value.conditions}
            addLabel={COPY.addCondition}
            onAdd={() =>
              set({
                conditions: [
                  ...value.conditions,
                  { type: "", value: "", note: "" },
                ],
              })
            }
            error={errors.conditions}
            disabled={disabled}
          >
            {(c: ConditionDraft, i) => {
              const item = conditionTypes.find((t) => t.code === c.type)
              return (
                <fieldset key={i} className={CARD} disabled={disabled}>
                  <legend className={LABEL}>{COPY.condition(i + 1)}</legend>
                  <TypeSelect
                    id={`${id}-c${i}-first`}
                    label={COPY.conditionType}
                    value={c.type}
                    items={conditionTypes}
                    onChange={(type) => setRow("conditions", i, { type })}
                  />
                  {item?.needsValue || c.value ? (
                    <div className="grid min-w-0 gap-1.5">
                      <label htmlFor={`${id}-c${i}-value`} className={LABEL}>
                        {COPY.conditionValue}
                      </label>
                      <input
                        id={`${id}-c${i}-value`}
                        type={item?.valueKind === "time" ? "time" : "text"}
                        inputMode={
                          item?.valueKind === "number" ? "decimal" : undefined
                        }
                        value={c.value}
                        maxLength={POLICY_LIMITS.value}
                        className={INPUT}
                        onChange={(e) =>
                          setRow("conditions", i, {
                            value: e.currentTarget.value,
                          })
                        }
                      />
                    </div>
                  ) : null}
                  <NoteInput
                    id={`${id}-c${i}-note`}
                    value={c.note}
                    onChange={(note) => setRow("conditions", i, { note })}
                  />
                  <RemoveRow
                    label={COPY.removeCondition(i + 1)}
                    onClick={() => removeRow("conditions", "c", i)}
                  />
                </fieldset>
              )
            }}
          </Rows>
        ) : (
          <p className="text-body-touch text-ink md:text-body">
            {COPY.noConditionTypes}
          </p>
        )
      ) : null}

      {basis ? (
        exceptionTypes.length ? (
          <Rows
            id={`${id}-exceptions`}
            title={COPY.exceptions}
            rows={value.exceptions}
            addLabel={COPY.addException}
            onAdd={() =>
              set({ exceptions: [...value.exceptions, { type: "", note: "" }] })
            }
            error={errors.exceptions}
            disabled={disabled}
          >
            {(x: ExceptionDraft, i) => (
              <fieldset key={i} className={CARD} disabled={disabled}>
                <legend className={LABEL}>{COPY.exception(i + 1)}</legend>
                <TypeSelect
                  id={`${id}-e${i}-first`}
                  label={COPY.exceptionType}
                  value={x.type}
                  items={exceptionTypes}
                  onChange={(type) => setRow("exceptions", i, { type })}
                />
                <NoteInput
                  id={`${id}-e${i}-note`}
                  value={x.note}
                  onChange={(note) => setRow("exceptions", i, { note })}
                />
                <RemoveRow
                  label={COPY.removeException(i + 1)}
                  onClick={() => removeRow("exceptions", "e", i)}
                />
              </fieldset>
            )}
          </Rows>
        ) : (
          <p className={MUTED}>{COPY.noExceptionTypes}</p>
        )
      ) : null}

      {basis && canStateOrgPolicy ? (
        <fieldset
          className="grid min-w-0 gap-1"
          disabled={disabled}
          aria-describedby={`${id}-scope-help`}
        >
          <legend className={LABEL}>{COPY.appliesTo}</legend>
          {(["venue", "organisation"] as const).map((scope) => (
            <label key={scope} className={ROW}>
              <input
                type="radio"
                name={`${id}-scope`}
                className="size-5 shrink-0 accent-primary"
                checked={value.policyScope === scope}
                onChange={() => set({ policyScope: scope })}
              />
              {COPY.scopeLabel[scope]}
            </label>
          ))}
          <p id={`${id}-scope-help`} className={MUTED}>
            {COPY.everyVenueHelp}
          </p>
        </fieldset>
      ) : null}

      {basis ? (
        <div
          role="group"
          className="grid min-w-0 gap-3"
          aria-labelledby={`${id}-who-title`}
        >
          <p id={`${id}-who-title`} className={LABEL}>
            {COPY.whoStated}
          </p>
          <p className="text-body-touch text-ink md:text-body">
            {COPY.basisLabel[basis]}
          </p>
          <div className="grid min-w-0 gap-1.5">
            <label htmlFor={`${id}-stated-on`} className={LABEL}>
              {COPY.statedOn}
            </label>
            <input
              id={`${id}-stated-on`}
              type="date"
              max={today}
              value={value.statedOn}
              disabled={disabled}
              className={INPUT}
              aria-invalid={errors.statedOn ? true : undefined}
              aria-describedby={describedBy(
                `${id}-stated-on-help`,
                errors.statedOn && `${id}-stated-on-error`
              )}
              onChange={(e) => set({ statedOn: e.currentTarget.value })}
            />
            <p id={`${id}-stated-on-help`} className={MUTED}>
              {COPY.statedOnHelp}
            </p>
            <FieldMessage
              id={`${id}-stated-on-error`}
              error={errors.statedOn}
            />
          </div>
          <fieldset
            className="grid min-w-0 gap-1"
            disabled={disabled}
            aria-describedby={describedBy(
              errors.source && `${id}-source-error`
            )}
          >
            <legend className={LABEL}>{COPY.where}</legend>
            {SOURCES.map((source) => (
              <label key={source} className={ROW}>
                <input
                  type="radio"
                  name={`${id}-source`}
                  className="size-5 shrink-0 accent-primary"
                  checked={value.source === source}
                  onChange={() => set({ source })}
                />
                {COPY.sourceLabel[source]}
              </label>
            ))}
            <FieldMessage id={`${id}-source-error`} error={errors.source} />
          </fieldset>
          <div className="grid min-w-0 gap-1.5">
            <label htmlFor={`${id}-reference`} className={LABEL}>
              {COPY.reference}
            </label>
            <input
              id={`${id}-reference`}
              value={value.reference}
              placeholder="⟨Reference⟩"
              maxLength={POLICY_LIMITS.reference}
              disabled={disabled}
              className={INPUT}
              aria-invalid={errors.reference ? true : undefined}
              aria-describedby={describedBy(
                errors.reference && `${id}-reference-error`
              )}
              onChange={(e) => set({ reference: e.currentTarget.value })}
            />
            <FieldMessage
              id={`${id}-reference-error`}
              error={errors.reference}
            />
          </div>
        </div>
      ) : null}
    </div>
  )
}

/**
 * "What this policy still needs" (B03 UI design §4.3, §4.5): a list in a
 * note. While editing it is announced only when it becomes empty.
 */
export function PolicyNeedsPanel({
  needs,
  admin = false,
}: {
  needs: readonly PolicyNeed[]
  admin?: boolean
}) {
  const words = policyNeedWords(needs, { admin })
  return (
    <div role="note" className="grid min-w-0 gap-2 rounded-card bg-well p-3">
      <p className={LABEL}>{COPY.needsTitle}</p>
      {words.length ? (
        <ul className="grid list-disc gap-1 pl-5 text-body-touch text-ink md:text-body">
          {words.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      ) : null}
      <p role="status" className="text-body-touch text-ink md:text-body">
        {words.length ? "" : COPY.nothingMissing}
      </p>
    </div>
  )
}
