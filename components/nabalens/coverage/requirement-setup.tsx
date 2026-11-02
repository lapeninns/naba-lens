"use client"

import * as React from "react"
import {
  CheckIcon,
  ProhibitIcon,
  ArrowCounterClockwiseIcon,
  TrashIcon,
} from "@phosphor-icons/react"

import { Button } from "@/components/ui/button"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"

import { CoverageNotice } from "./coverage-notice"
import {
  COVERAGE_LIMITS,
  REQUIREMENT_STATUS_LABEL,
  SETUP_ISSUE_LABEL,
  labelFor,
  plural,
} from "./copy"
import { RequirementStatusBadge } from "./coverage-badges"
import { ReasonDialog, textareaClass } from "./reason-dialog"
import type {
  CoverageResult,
  RequirementView,
  SetRequirementStatusInput,
  UpdateRequirementInput,
} from "./types"
import { REPORTED, useCoverageAction } from "./use-coverage-action"

export type RevisionResult = CoverageResult<{ revision: number }>

export type UpdateRequirementHandler = (
  input: UpdateRequirementInput
) => Promise<RevisionResult>

export type SetRequirementStatusHandler = (
  input: SetRequirementStatusInput
) => Promise<RevisionResult>

/** Only manager-created items have a free title; others come from a template or menu. */
export function hasEditableTitle(requirement: RequirementView): boolean {
  return requirement.kind !== "menu_section" && requirement.templateKey == null
}

type Draft = {
  title: string
  guidance: string
  photoTarget: string
  dueOn: string
}

function draftOf(requirement: RequirementView): Draft {
  return {
    title: requirement.title,
    guidance: requirement.guidance ?? "",
    photoTarget: String(requirement.photoTarget),
    dueOn: requirement.due?.dueOn ?? "",
  }
}

function validate(
  draft: Draft,
  editableTitle: boolean
): Partial<Record<keyof Draft, string>> {
  const errors: Partial<Record<keyof Draft, string>> = {}
  const title = draft.title.trim()
  if (editableTitle && (!title || title.length > COVERAGE_LIMITS.titleMax)) {
    errors.title = `Enter a title of up to ${COVERAGE_LIMITS.titleMax} characters.`
  }
  if (draft.guidance.trim().length > COVERAGE_LIMITS.guidanceMax) {
    errors.guidance = `Use up to ${COVERAGE_LIMITS.guidanceMax} characters.`
  }
  const target = Number(draft.photoTarget)
  if (
    !Number.isInteger(target) ||
    target < 1 ||
    target > COVERAGE_LIMITS.photoTargetMax
  ) {
    errors.photoTarget = `Enter a whole number from 1 to ${COVERAGE_LIMITS.photoTargetMax}.`
  }
  return errors
}

function patchOf(
  requirement: RequirementView,
  draft: Draft,
  editableTitle: boolean
): UpdateRequirementInput["patch"] {
  const patch: UpdateRequirementInput["patch"] = {}
  const title = draft.title.trim()
  if (editableTitle && title !== requirement.title) patch.title = title
  const guidance = draft.guidance.trim() || null
  if (guidance !== (requirement.guidance ?? null)) patch.guidance = guidance
  const target = Number(draft.photoTarget)
  if (target !== requirement.photoTarget) patch.photoTarget = target
  const dueOn = draft.dueOn || null
  if (dueOn !== (requirement.due?.dueOn ?? null)) patch.dueOn = dueOn
  return patch
}

/**
 * Setup for one checklist item: guidance, photo target and due date, whether
 * it applies (with a reason when it does not), and retirement. Amenities need a
 * confirmed "present" fact before they can apply; unknown stays "Needs
 * verification".
 */
export function RequirementSetup({
  requirement,
  onUpdate,
  onSetStatus,
  onStale,
}: {
  requirement: RequirementView
  onUpdate: UpdateRequirementHandler
  onSetStatus: SetRequirementStatusHandler
  onStale?: () => void
}) {
  const ids = React.useId()
  const editableTitle = hasEditableTitle(requirement)
  const action = useCoverageAction(onStale)
  const noticeRef = React.useRef<HTMLDivElement>(null)
  // Unsaved edits survive refreshes; only a new revision resets the form.
  const savedKey = `${requirement.id}:${requirement.revision}`
  const [seed, setSeed] = React.useState(savedKey)
  const [draft, setDraft] = React.useState(() => draftOf(requirement))
  const [errors, setErrors] = React.useState<Partial<Record<string, string>>>(
    {}
  )
  if (seed !== savedKey) {
    setSeed(savedKey)
    setDraft(draftOf(requirement))
    setErrors({})
  }
  const [dialog, setDialog] = React.useState<
    "not_applicable" | "retire" | null
  >(null)

  const retired = requirement.status === "retired"
  const patch = patchOf(requirement, draft, editableTitle)
  const dirty = Object.keys(patch).length > 0

  const amenity = requirement.amenity
  const factReady =
    !amenity || (amenity.presence === "present" && amenity.confirmed)
  const factKnown = !amenity || (amenity.presence ?? "unknown") !== "unknown"

  function set<K extends keyof Draft>(key: K, value: string) {
    setDraft((current) => ({ ...current, [key]: value }))
  }

  async function save(event: React.FormEvent) {
    event.preventDefault()
    const found = validate(draft, editableTitle)
    setErrors(found)
    if (Object.keys(found).length > 0 || !dirty) return
    const result = await action.run(
      () =>
        onUpdate({
          requirementId: requirement.id,
          expectedRevision: requirement.revision,
          patch,
        }),
      "Saved."
    )
    if (!result.ok && "fieldErrors" in result && result.fieldErrors) {
      setErrors(result.fieldErrors)
    }
  }

  /** Saves unsaved details first, so the confirmed target is the one shown. */
  async function confirmApplies() {
    const found = validate(draft, editableTitle)
    setErrors(found)
    if (Object.keys(found).length > 0) return
    let revision = requirement.revision
    if (dirty) {
      const saved = await action.run(
        () =>
          onUpdate({
            requirementId: requirement.id,
            expectedRevision: revision,
            patch,
          }),
        "Saved."
      )
      if (!saved.ok) return
      revision = saved.revision
    }
    await action.run(
      () =>
        onSetStatus({
          requirementId: requirement.id,
          expectedRevision: revision,
          status: "active",
        }),
      `Confirmed: ${plural(Number(draft.photoTarget), "photo")} needed. It now counts toward venue coverage.`
    )
  }

  function statusChange(status: "not_applicable" | "retired") {
    return async (reason: string) => {
      const result = await action.run(
        () =>
          onSetStatus({
            requirementId: requirement.id,
            expectedRevision: requirement.revision,
            status,
            reason,
          }),
        status === "retired"
          ? "Retired. Its photos and history are kept."
          : "Marked not applicable. It stays visible and is not counted."
      )
      if (result.ok) return { ok: true as const }
      if (action.reportedOnPage(result)) return REPORTED
      return {
        ok: false as const,
        error: "message" in result ? result.message : "That did not work.",
        fieldError:
          "fieldErrors" in result ? result.fieldErrors?.reason : undefined,
      }
    }
  }

  const issues = requirement.setupIssues

  return (
    <section aria-labelledby={`${ids}-title`} className="grid gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 id={`${ids}-title`} className="text-lg font-medium">
          Setup
        </h2>
        <RequirementStatusBadge
          status={requirement.status}
          satisfied={requirement.progress.satisfied}
        />
      </div>
      <CoverageNotice
        ref={noticeRef}
        notice={action.notice}
        onDismiss={action.dismiss}
      />
      {issues.length > 0 && !retired ? (
        <ul className="grid gap-1 text-sm text-warning">
          {issues.map((issue) => (
            <li key={issue}>{labelFor(SETUP_ISSUE_LABEL, issue)}</li>
          ))}
        </ul>
      ) : null}
      {requirement.statusReason ? (
        <p className="text-sm">
          <span className="font-medium">
            {labelFor(REQUIREMENT_STATUS_LABEL, requirement.status)}:
          </span>{" "}
          {requirement.statusReason}
        </p>
      ) : null}

      {retired ? (
        <p className="text-sm text-muted-foreground">
          Retired items are history only. They are not counted and cannot be
          changed.
        </p>
      ) : (
        <form onSubmit={save} className="grid gap-4" noValidate>
          {editableTitle ? (
            <Field className="gap-1.5">
              <FieldLabel htmlFor={`${ids}-name`}>Title</FieldLabel>
              <Input
                id={`${ids}-name`}
                value={draft.title}
                onChange={(e) => set("title", e.currentTarget.value)}
                maxLength={COVERAGE_LIMITS.titleMax}
                required
                aria-invalid={!!errors.title || undefined}
                className="h-11 sm:h-9"
                disabled={action.pending}
              />
              {errors.title ? <FieldError>{errors.title}</FieldError> : null}
            </Field>
          ) : null}
          <Field className="gap-1.5">
            <FieldLabel htmlFor={`${ids}-guidance`}>
              Guidance for staff
            </FieldLabel>
            <textarea
              id={`${ids}-guidance`}
              value={draft.guidance}
              onChange={(e) => set("guidance", e.currentTarget.value)}
              maxLength={COVERAGE_LIMITS.guidanceMax}
              rows={3}
              aria-invalid={!!errors.guidance || undefined}
              aria-describedby={`${ids}-guidance-help`}
              className={textareaClass}
              disabled={action.pending}
            />
            <FieldDescription id={`${ids}-guidance-help`}>
              What a good photo shows: angle, lighting, what must be in frame.
            </FieldDescription>
            {errors.guidance ? (
              <FieldError>{errors.guidance}</FieldError>
            ) : null}
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field className="gap-1.5">
              <FieldLabel htmlFor={`${ids}-target`}>Photo target</FieldLabel>
              <Input
                id={`${ids}-target`}
                type="number"
                inputMode="numeric"
                min={1}
                max={COVERAGE_LIMITS.photoTargetMax}
                step={1}
                value={draft.photoTarget}
                onChange={(e) => set("photoTarget", e.currentTarget.value)}
                aria-invalid={!!errors.photoTarget || undefined}
                aria-describedby={`${ids}-target-help`}
                className="h-11 sm:h-9"
                disabled={action.pending}
              />
              <FieldDescription id={`${ids}-target-help`}>
                Distinct accepted photos needed.
                {requirement.status === "needs_setup"
                  ? " This is a suggestion until you confirm it."
                  : null}
              </FieldDescription>
              {errors.photoTarget ? (
                <FieldError>{errors.photoTarget}</FieldError>
              ) : null}
            </Field>
            <Field className="gap-1.5">
              <FieldLabel htmlFor={`${ids}-due`}>
                Due date (optional)
              </FieldLabel>
              <Input
                id={`${ids}-due`}
                type="date"
                value={draft.dueOn}
                onChange={(e) => set("dueOn", e.currentTarget.value)}
                aria-invalid={!!errors.dueOn || undefined}
                aria-describedby={`${ids}-due-help`}
                className="h-11 sm:h-9"
                disabled={action.pending}
              />
              <FieldDescription id={`${ids}-due-help`}>
                UK date. Overdue items stay open for follow-up.
              </FieldDescription>
              {errors.dueOn ? <FieldError>{errors.dueOn}</FieldError> : null}
            </Field>
          </div>
          <div>
            <Button
              type="submit"
              variant="outline"
              size="touch"
              disabled={!dirty || action.pending}
              aria-busy={action.pending || undefined}
            >
              {action.pending ? "Saving…" : "Save changes"}
            </Button>
          </div>
        </form>
      )}

      {!retired ? (
        <div className="grid gap-3 rounded-lg border bg-card p-4">
          <h3 className="font-medium">Does this apply to the venue?</h3>
          {requirement.status === "active" ? (
            <p className="text-sm text-muted-foreground">
              Yes. It counts toward venue coverage with a target of{" "}
              {plural(requirement.photoTarget, "photo")}.
            </p>
          ) : requirement.status === "not_applicable" ? (
            <p className="text-sm text-muted-foreground">
              No. It stays visible with its reason and is not counted.
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">
              Not decided yet. Until you decide, it needs setup and the venue
              cannot show complete coverage.
            </p>
          )}
          {!factReady && requirement.status !== "active" ? (
            <p className="text-sm text-warning">
              {factKnown
                ? amenity?.presence === "absent"
                  ? "Recorded as not present. Mark it not applicable with a reason, or change the amenity facts below."
                  : "Confirm the amenity facts below before confirming it applies."
                : "Needs verification: record whether it is present (amenity facts below) first. Photos alone never establish it."}
            </p>
          ) : null}
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            {requirement.status !== "active" ? (
              <Button
                size="touch"
                onClick={() => void confirmApplies()}
                disabled={action.pending || !factReady}
              >
                {requirement.status === "not_applicable" ? (
                  <ArrowCounterClockwiseIcon
                    data-icon="inline-start"
                    aria-hidden
                  />
                ) : (
                  <CheckIcon data-icon="inline-start" aria-hidden />
                )}
                {requirement.status === "not_applicable"
                  ? "It applies after all"
                  : `Confirm: applies, ${plural(Number(draft.photoTarget) || requirement.photoTarget, "photo")}`}
              </Button>
            ) : null}
            {requirement.status !== "not_applicable" ? (
              <Button
                variant="outline"
                size="touch"
                onClick={() => setDialog("not_applicable")}
                disabled={action.pending || !factKnown}
              >
                <ProhibitIcon data-icon="inline-start" aria-hidden />
                Does not apply
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}

      {!retired && requirement.kind !== "menu_section" ? (
        <div className="grid gap-2">
          <Button
            variant="destructive"
            size="touch"
            className="w-fit"
            onClick={() => setDialog("retire")}
            disabled={action.pending}
          >
            <TrashIcon data-icon="inline-start" aria-hidden />
            Retire this item
          </Button>
          <p className="text-sm text-muted-foreground">
            Retiring removes it from the checklist for good. Its photos and
            decisions stay in the history.
          </p>
        </div>
      ) : null}

      <ReasonDialog
        open={dialog === "not_applicable"}
        onOpenChange={(open) => setDialog(open ? "not_applicable" : null)}
        title={`“${requirement.title}” does not apply`}
        description="It stays visible on the checklist with your reason and leaves the applicable count."
        label="Reason"
        help="For example: “No garden at this venue.”"
        confirmLabel="Mark not applicable"
        pendingLabel="Saving…"
        onConfirm={statusChange("not_applicable")}
        reportFocus={() => noticeRef.current}
      />
      <ReasonDialog
        open={dialog === "retire"}
        onOpenChange={(open) => setDialog(open ? "retire" : null)}
        title={`Retire “${requirement.title}”?`}
        description="Assignments end and it leaves the checklist. Its photos and decisions are kept as history. This cannot be undone."
        label="Reason"
        confirmLabel="Retire"
        pendingLabel="Retiring…"
        destructive
        onConfirm={statusChange("retired")}
        reportFocus={() => noticeRef.current}
      />
    </section>
  )
}
