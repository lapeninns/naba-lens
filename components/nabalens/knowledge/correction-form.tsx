"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { ArrowClockwiseIcon, CheckIcon } from "@phosphor-icons/react"

import { Notice } from "@/components/nabalens/notice"
import { useRequestIds } from "@/components/nabalens/coverage/use-request-id"
import { Button, buttonVariants } from "@/components/ui/button"
import { ANSWER_LABEL, type SubmitAnswer } from "@/lib/amenities/contract"
import type {
  CorrectResult,
  KnowledgeResult,
} from "@/lib/knowledge-client/contract"

import { FieldMessage, LABEL, MUTED } from "../amenities/capture/field-parts"
import { londonToday } from "../amenities/capture/validate"

import { emptyAccess } from "./accessibility-detail"
import { AccessDetailFields } from "./accessibility-detail-fields"
import { CORRECT_COPY as COPY } from "./corrections-copy"
import {
  detailErrorsFor,
  detailFieldErrors,
  detailToSend,
  hasDetailErrors,
  NO_DETAIL_ERRORS,
  partsFromDetail,
  policyOf,
  showsAccess,
  showsFacility,
  showsService,
  type DetailErrors,
  type DetailForm,
  type DetailParts,
} from "./detail-form"
import { emptyEvent } from "./event-detail"
import { emptyFacility } from "./facility-detail"
import { FacilityDetailFields } from "./facility-detail-fields"
import { POLICY_COPY, stanceAnswer } from "./policy-detail"
import { PolicyDetailFields, PolicyRuleField } from "./policy-detail-fields"
import { ScheduleFields } from "./schedule-fields"
import { emptyService } from "./service-detail"
import { EventFields, ServiceExtraFields } from "./service-fields"

const HEADLINES: SubmitAnswer[] = ["yes", "no", "not_applicable"]
const INPUT =
  "block min-h-12 w-full min-w-0 rounded-control border border-line-control bg-panel px-3 py-2 text-body-touch text-ink outline-none focus-visible:border-focus focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-1 focus-visible:outline-focus disabled:cursor-not-allowed disabled:bg-well aria-invalid:border-negative md:text-body"
const ROW =
  "flex min-h-11 cursor-pointer items-center gap-3 text-body-touch text-ink has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-focus md:text-body"

/** Words for a detail section in What changes (§8.1). */
const FIELD_LABEL: Record<string, string> = {
  headline: "Answer",
  locations: "Where",
  availability: "Availability",
  fees: "Fees",
  limitations: "Limitations",
  howToRequest: "How to ask for it",
  scope: "What was checked",
  features: "Features",
  measurements: "Measurements",
  entrances: "Entrances",
  stance: "Rule",
  zones: "Areas",
  conditions: "Conditions",
  exceptions: "Exceptions",
  policyScope: "Applies to",
  authority: "Who stated it",
  schedule: "When",
  lastDayOffered: "Last day offered",
  channels: "How guests order",
  broadcasters: "Subscriptions",
  event: "Fixture",
}

/** A short, plain summary of a stored value, for Before and After. */
export function valueSummary(v: unknown): string {
  if (v === null || v === undefined) return "Not recorded"
  if (typeof v === "string") return v
  if (typeof v === "number") return String(v)
  if (typeof v === "boolean") return v ? "Yes" : "No"
  if (Array.isArray(v)) {
    if (v.length === 0) return "None"
    const shown = v.slice(0, 3).map(valueSummary).join("; ")
    return v.length > 3 ? `${shown} and ${v.length - 3} more` : shown
  }
  if (typeof v === "object") {
    const o = v as Record<string, unknown>
    if (typeof o.label === "string") return o.label
    if (typeof o.subjectId === "string") return "a place at the venue"
    if (typeof o.state === "string") return o.state.replace(/_/g, " ")
    if (typeof o.kind === "string" && Object.keys(o).length <= 3)
      return o.kind.replace(/_/g, " ")
    return Object.entries(o)
      .map(([k, x]) => `${FIELD_LABEL[k] ?? k}: ${valueSummary(x)}`)
      .join(", ")
  }
  return String(v)
}

export type Change = {
  field: string
  label: string
  before: string
  after: string
  material: boolean
}

/** Object key order can differ between a database read and a form payload. */
function detailValueKey(value: unknown): string {
  return JSON.stringify(value ?? null, (_key, item: unknown) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return item
    const record = item as Record<string, unknown>
    return Object.fromEntries(
      Object.keys(record)
        .sort()
        .map((key) => [key, record[key]])
    )
  })
}

/** Every field that differs, the headline first, marked when material. */
export function whatChanges(
  before: { headline: SubmitAnswer; detail: Record<string, unknown> | null },
  after: {
    headline: SubmitAnswer | null
    detail: Record<string, unknown> | null
  },
  materialFields: readonly string[]
): Change[] {
  const material = (field: string) =>
    field === "headline" ||
    materialFields.some(
      (m) =>
        m === field ||
        m === `detail.${field}` ||
        m.startsWith(`detail.${field}.`) ||
        m.startsWith(`${field}.`)
    )
  const out: Change[] = []
  if (after.headline && after.headline !== before.headline)
    out.push({
      field: "headline",
      label: FIELD_LABEL.headline!,
      before: ANSWER_LABEL[before.headline],
      after: ANSWER_LABEL[after.headline],
      material: true,
    })
  const keys = new Set([
    ...Object.keys(before.detail ?? {}),
    ...Object.keys(after.detail ?? {}),
  ])
  for (const key of keys) {
    const b = before.detail?.[key]
    const a = after.detail?.[key]
    if (detailValueKey(b) === detailValueKey(a)) continue
    out.push({
      field: key,
      label: FIELD_LABEL[key] ?? key,
      before: valueSummary(b),
      after: valueSummary(a),
      material: material(key),
    })
  }
  return out
}

type Correct = (input: {
  checkId: string
  slotRevision: number
  idempotencyKey: string
  headline: SubmitAnswer
  detail: Record<string, unknown> | null
  reason: string
}) => Promise<KnowledgeResult<CorrectResult>>

/**
 * Correct the answer (B03 UI design §8.1): a manager account or an admin
 * edits the answer in use, says why, and sees what changes before saving.
 * The database decides material versus small; a material change needs
 * confirming again. Keyed, so a retry after a lost reply never saves twice.
 */
export function CorrectionForm({
  checkId,
  slotRevision,
  venueName,
  before,
  materialFields,
  detailForm,
  correct,
  doneHref,
}: {
  checkId: string
  slotRevision: number
  venueName: string
  before: { headline: SubmitAnswer; detail: Record<string, unknown> | null }
  materialFields: string[]
  detailForm: DetailForm | null
  correct: Correct
  doneHref: string
}) {
  const id = React.useId()
  const router = useRouter()
  const requests = useRequestIds()
  const [headline, setHeadline] = React.useState<SubmitAnswer | null>(
    before.headline
  )
  const [parts, setParts] = React.useState<DetailParts>(() =>
    partsFromDetail(before.detail)
  )
  const [reason, setReason] = React.useState("")
  const [errors, setErrors] = React.useState<Record<string, string>>({})
  const [detailErrors, setDetailErrors] =
    React.useState<DetailErrors>(NO_DETAIL_ERRORS)
  const [pending, setPending] = React.useState(false)
  const [outcome, setOutcome] = React.useState<
    | { kind: "done"; text: string }
    | { kind: "failed"; text: string; reload: boolean }
    | null
  >(null)
  const today = londonToday()
  const scope = `correct:${checkId}`
  // Saved: the form, and Save with it, are gone; the notice takes focus.
  const doneRef = React.useRef<HTMLDivElement>(null)
  const done = outcome?.kind === "done"
  React.useEffect(() => {
    if (done) doneRef.current?.focus()
  }, [done])

  const afterDetail = detailForm
    ? detailToSend(detailForm, parts, headline)
    : before.detail
  const changes = whatChanges(
    before,
    { headline, detail: afterDetail },
    detailForm?.schema === "service"
      ? [...materialFields, "schedule", "lastDayOffered"]
      : materialFields
  )
  const material = changes.some((c) => c.material)
  const edit = (patch: Partial<DetailParts>) => {
    setParts((p) => ({ ...p, ...patch }))
    setDetailErrors(NO_DETAIL_ERRORS)
  }
  const policy = detailForm?.schema === "policy" ? detailForm : null
  const policyDraft = policy
    ? policyOf(parts, headline, policy.requiresZones)
    : null

  async function save() {
    const next: Record<string, string> = {}
    if (!headline) next.headline = "Choose Yes, No or Not applicable."
    if (!reason.trim()) next.reason = COPY.whyEmpty
    else if (reason.trim().length > 500)
      next.reason = "Use up to 500 characters."
    if (!changes.length) next.changes = COPY.nothing
    const detailErrs =
      detailForm && headline
        ? detailErrorsFor(detailForm, parts, headline, { venueName, today })
        : NO_DETAIL_ERRORS
    setErrors(next)
    setDetailErrors(detailErrs)
    setOutcome(null)
    if (Object.keys(next).length || hasDetailErrors(detailErrs) || !headline)
      return
    const payload = {
      checkId,
      slotRevision,
      headline,
      detail: afterDetail,
      reason: reason.trim(),
    }
    const idempotencyKey = requests.requestIdFor(scope, payload)
    setPending(true)
    try {
      const result = await correct({ ...payload, idempotencyKey })
      if (!result.ok) {
        requests.settle(scope)
        if (result.code === "invalid_input") {
          setDetailErrors(detailFieldErrors(result.fieldErrors))
          const own: Record<string, string> = {}
          for (const field of ["headline", "reason"] as const)
            if (result.fieldErrors?.[field])
              own[field] = result.fieldErrors[field]!
          setErrors(own)
        }
        setOutcome({
          kind: "failed",
          text:
            result.code === "not_permitted"
              ? COPY.notPermitted
              : result.code === "revision_conflict"
                ? COPY.conflict
                : result.message,
          reload: result.code === "revision_conflict",
        })
        return
      }
      requests.settle(scope)
      setOutcome({
        kind: "done",
        text: result.material ? COPY.doneMaterial : COPY.doneSmall,
      })
      router.refresh()
    } catch {
      // The same intent keeps its key: Save correction again replays.
      setOutcome({
        kind: "failed",
        text: "We couldn't confirm the correction was saved. Try again; it won't be saved twice.",
        reload: false,
      })
    } finally {
      setPending(false)
    }
  }

  if (outcome?.kind === "done")
    return (
      <div className="grid gap-3">
        <Notice ref={doneRef} tabIndex={-1} tone="positive" role="status">
          {outcome.text}
        </Notice>
        <div>
          <Link
            href={doneHref}
            className={buttonVariants({ variant: "secondary", size: "touch" })}
          >
            Back to the check
          </Link>
        </div>
      </div>
    )

  return (
    <form
      noValidate
      aria-label={COPY.open}
      className="flex min-w-0 flex-col gap-6"
      onSubmit={(e) => {
        e.preventDefault()
        void save()
      }}
    >
      <Notice tone="plain" role="note">
        {COPY.context}
      </Notice>

      {policy ? (
        <PolicyRuleField
          id={`${id}-rule`}
          value={policyDraft?.stance ?? null}
          onChange={(stance) => {
            if (stance === "unknown") return
            setHeadline(stanceAnswer(stance) as SubmitAnswer)
            edit({
              policy: {
                ...policyOf(parts, headline, policy.requiresZones),
                stance,
              },
            })
          }}
          staff={false}
          conditionsAvailable={policy.conditionTypes.length > 0}
          error={errors.headline}
          disabled={pending}
        />
      ) : (
        <fieldset
          className="grid min-w-0 gap-1"
          disabled={pending}
          aria-describedby={
            errors.headline ? `${id}-headline-error` : undefined
          }
        >
          <legend className={LABEL}>{FIELD_LABEL.headline}</legend>
          {HEADLINES.map((h) => (
            <label key={h} className={ROW}>
              <input
                type="radio"
                name={`${id}-headline`}
                className="size-5 shrink-0 accent-primary"
                checked={headline === h}
                onChange={() => setHeadline(h)}
              />
              {ANSWER_LABEL[h]}
            </label>
          ))}
          <FieldMessage id={`${id}-headline-error`} error={errors.headline} />
        </fieldset>
      )}

      {policy && policyDraft?.stance && policyDraft.stance !== "unknown" ? (
        <PolicyDetailFields
          id={`${id}-policy`}
          value={policyDraft}
          onChange={(next) => edit({ policy: next })}
          places={policy.places}
          conditionTypes={policy.conditionTypes}
          exceptionTypes={policy.exceptionTypes}
          requiresZones={policy.requiresZones}
          basis={policy.basis}
          canStateOrgPolicy={policy.canStateOrgPolicy}
          errors={detailErrors.policy}
          today={today}
          disabled={pending}
        />
      ) : null}
      {detailForm?.schema === "accessibility" &&
      showsAccess(detailForm, headline) ? (
        <AccessDetailFields
          id={`${id}-access`}
          value={parts.access ?? emptyAccess()}
          onChange={(access) => edit({ access })}
          answer={headline}
          stepFree={detailForm.stepFree}
          places={detailForm.places}
          features={detailForm.features}
          venueName={venueName}
          canManagePlaces={detailForm.canManagePlaces}
          errors={detailErrors.access}
          today={today}
          disabled={pending}
        />
      ) : null}
      {detailForm?.schema === "service" &&
      showsService(detailForm, headline) ? (
        <>
          <ScheduleFields
            id={`${id}-schedule`}
            value={(parts.service ?? emptyService()).schedule}
            onChange={(schedule) =>
              edit({
                service: { ...(parts.service ?? emptyService()), schedule },
              })
            }
            errors={detailErrors.service}
            timezone={detailForm.timezone}
            disabled={pending}
          />
          <ServiceExtraFields
            id={`${id}-service`}
            value={parts.service ?? emptyService()}
            onChange={(service) => edit({ service })}
            channels={detailForm.channels}
            broadcasters={detailForm.broadcasters}
            errors={detailErrors.service}
            disabled={pending}
          />
        </>
      ) : null}
      {detailForm?.schema === "schedule_event" && headline === "yes" ? (
        <EventFields
          id={`${id}-event`}
          value={parts.event ?? emptyEvent()}
          onChange={(event) => edit({ event })}
          committedBy={detailForm.committedBy}
          errors={detailErrors.event}
          disabled={pending}
        />
      ) : null}
      {detailForm && showsFacility(detailForm, headline) ? (
        <FacilityDetailFields
          id={`${id}-facility`}
          value={parts.facility ?? emptyFacility()}
          onChange={(facility) => edit({ facility })}
          places={"places" in detailForm ? detailForm.places : []}
          venueName={venueName}
          errors={detailErrors.facility}
          showWhere={detailForm.schema === "facility"}
          showHowToRequest={detailForm.schema !== "service"}
          disabled={pending}
        />
      ) : null}

      <div className="grid min-w-0 gap-1.5">
        <label htmlFor={`${id}-reason`} className={LABEL}>
          {COPY.why} (required)
        </label>
        <textarea
          id={`${id}-reason`}
          rows={3}
          maxLength={500}
          value={reason}
          disabled={pending}
          className={INPUT}
          aria-invalid={errors.reason ? true : undefined}
          aria-describedby={[
            `${id}-reason-help`,
            errors.reason && `${id}-reason-error`,
          ]
            .filter(Boolean)
            .join(" ")}
          onChange={(e) => setReason(e.currentTarget.value)}
        />
        <p id={`${id}-reason-help`} className={MUTED}>
          {COPY.whyHelp}
        </p>
        <FieldMessage id={`${id}-reason-error`} error={errors.reason} />
      </div>

      <section
        aria-labelledby={`${id}-changes-title`}
        className="grid min-w-0 gap-2 rounded-card bg-well p-3"
      >
        <h3 id={`${id}-changes-title`} className={LABEL}>
          {COPY.whatChanges}
        </h3>
        {changes.length === 0 ? (
          <p className="text-body-touch text-ink md:text-body">
            {COPY.nothing}
          </p>
        ) : (
          <>
            <ul className="grid gap-2">
              {changes.map((c) => (
                <li
                  key={c.field}
                  className="grid gap-0.5 text-body-touch text-ink md:text-body"
                >
                  <span className="font-semibold">
                    {c.label}
                    {c.material ? ` · ${COPY.material}` : ""}
                  </span>
                  <span>
                    {COPY.before}: {c.before}
                  </span>
                  <span>
                    {COPY.after}: {c.after}
                  </span>
                </li>
              ))}
            </ul>
            <p className="text-body-touch text-ink md:text-body">
              {material ? COPY.materialLine : COPY.smallLine}
            </p>
          </>
        )}
        <FieldMessage id={`${id}-changes-error`} error={errors.changes} />
      </section>

      {outcome?.kind === "failed" ? (
        <Notice
          tone="negative"
          role="alert"
          action={
            outcome.reload ? (
              <Button
                type="button"
                variant="secondary"
                size="touch"
                onClick={() => router.refresh()}
              >
                <ArrowClockwiseIcon aria-hidden />
                Reload
              </Button>
            ) : undefined
          }
        >
          {outcome.text}
        </Notice>
      ) : null}

      <div>
        <Button
          type="submit"
          size="touch"
          disabled={pending}
          aria-busy={pending || undefined}
        >
          <CheckIcon aria-hidden />
          {COPY.save}
        </Button>
      </div>
      {policy ? <p className={MUTED}>{POLICY_COPY.evidenceHelp}</p> : null}
    </form>
  )
}
