"use client"

import * as React from "react"
import {
  CheckIcon,
  ProhibitIcon,
  SpinnerGapIcon,
  TrashIcon,
  WarningIcon,
} from "@phosphor-icons/react"

import { Notice } from "@/components/nabalens/notice"
import { OfflineNotice } from "@/components/nabalens/offline-notice"
import { Button } from "@/components/ui/button"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

import { RequirementChip, requirementIssues } from "./checklist-body"
import { CoverageNotice } from "./coverage-notice"
import {
  COVERAGE_LIMITS,
  REQUIREMENT_KIND_SINGULAR,
  TEAM_SUGGESTION_COPY,
  labelFor,
  plural,
} from "./copy"
import { CoverageSection, Quote } from "./layout"
import { ReasonDialog, textareaClass } from "./reason-dialog"
import { bySurname } from "./roster"
import { Stepper, TeamTag } from "./team-roster"
import type {
  CoveragePerson,
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

export type SetAssigneesHandler = (
  assigneeIds: string[]
) => Promise<CoverageResult<object>>

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
    draft.photoTarget === "" ||
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

function withStop(text: string) {
  return /[.!?]$/.test(text.trim()) ? text.trim() : `${text.trim()}.`
}

function firstName(name: string) {
  return name.trim().split(/\s+/)[0] ?? name
}

/** "Priya", "Priya and Anil", "Priya, Kiran and Anil". */
function listNames(names: string[]) {
  if (names.length <= 1) return names.join("")
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`
}

function overdueText(requirement: RequirementView) {
  const names = requirement.assignees
    .map((p) => p.displayName)
    .sort(bySurname)
    .map(firstName)
  const who =
    names.length > 0
      ? `${listNames(names)} can still send photos, and they count once accepted.`
      : "photos can still be sent, and they count once accepted."
  return `${requirement.due?.label ?? "Past its due date"}. Overdue is for follow-up: ${who}`
}

type Choice = {
  id: string
  name: string
  person: CoveragePerson | null
  /** Assigned here but no longer at the venue. */
  away: boolean
}

/**
 * Who can photograph the item: anyone assigned who has left or moved venue
 * first (so they get reassigned), then everyone at the venue A to Z by
 * surname. Teams are shown, never used to filter.
 */
function choicesOf(
  requirement: RequirementView,
  roster: CoveragePerson[]
): Choice[] {
  const here = new Set(roster.map((p) => p.id))
  const known = new Map(requirement.assignees.map((p) => [p.id, p]))
  const away: Choice[] = requirement.assigneeIds
    .filter((id) => !here.has(id))
    .map((id) => {
      const person = known.get(id) ?? null
      return {
        id,
        name: person?.displayName ?? "A former team member",
        person,
        away: true,
      }
    })
    .sort((a, b) => bySurname(a.name, b.name))
  const current = roster
    .map((p) => ({ id: p.id, name: p.displayName, person: p, away: false }))
    .sort((a, b) => bySurname(a.name, b.name))
  return [...away, ...current]
}

/** Applies / Does not apply as one radio group (`nl-seg is-block`). */
function AppliesChoice({
  label,
  applies,
  onApplies,
  onDoesNotApply,
  appliesDisabled,
  notApplyDisabled,
}: {
  label: string
  applies: boolean
  onApplies: () => void
  onDoesNotApply: () => void
  appliesDisabled?: boolean
  notApplyDisabled?: boolean
}) {
  const options = [
    {
      key: "applies",
      text: "Applies",
      checked: applies,
      disabled: appliesDisabled,
      pick: onApplies,
    },
    {
      key: "not",
      text: "Does not apply",
      checked: !applies,
      disabled: notApplyDisabled,
      pick: onDoesNotApply,
    },
  ]
  const refs = React.useRef<(HTMLButtonElement | null)[]>([])

  function onKeyDown(event: React.KeyboardEvent, index: number) {
    const keys = ["ArrowLeft", "ArrowUp", "ArrowRight", "ArrowDown"]
    if (!keys.includes(event.key)) return
    event.preventDefault()
    const next = (index + 1) % options.length
    if (options[next].disabled) return
    refs.current[next]?.focus()
    options[next].pick()
  }

  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="grid w-full grid-cols-2 gap-1 rounded-control bg-surface-2 p-1"
    >
      {options.map((option, i) => (
        <button
          key={option.key}
          ref={(el) => {
            refs.current[i] = el
          }}
          type="button"
          role="radio"
          aria-checked={option.checked}
          tabIndex={option.checked ? 0 : -1}
          disabled={option.disabled}
          onClick={() => {
            if (!option.checked) option.pick()
          }}
          onKeyDown={(e) => onKeyDown(e, i)}
          className="min-h-11 rounded-control px-3 py-1.5 text-label leading-tight font-bold text-ink-muted transition-[background-color,color,box-shadow] duration-(--duration-quick) outline-none hover:bg-raised hover:text-ink focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-focus focus-visible:outline-solid disabled:cursor-not-allowed disabled:opacity-60 aria-checked:bg-surface aria-checked:text-ink aria-checked:shadow-[0_1px_2px_oklch(0.2_0.01_250/0.16),0_0_0_1.5px_var(--border-strong)]"
        >
          {option.text}
        </button>
      ))}
    </div>
  )
}

const HINT = "text-meta text-ink-muted"
const MUTED = "text-body text-ink-muted"
/** The white card each block of the item sits in (DESIGN.md §4). */
const CARD = "grid min-w-0 gap-4 rounded-card bg-surface p-4 shadow-card"

/**
 * One checklist item: its state, setup (applies, photo target, guidance, due
 * date), who photographs it, and one pinned "Save and confirm" or "Save
 * changes". Amenities need a confirmed "present" fact before they can apply;
 * while a fact needs verification the confirm button stays disabled with its
 * reason beside it. Not applicable and retired items stay visible and are
 * not counted.
 */
export function RequirementSetup({
  requirement,
  venueName = "this venue",
  month,
  roster,
  readOnly = false,
  facts,
  notice,
  photos,
  onUpdate,
  onSetStatus,
  onSetAssignees,
  onStale,
}: {
  requirement: RequirementView
  venueName?: string
  /** "November": the month a complete item is complete for. */
  month?: string
  /** Active staff currently at the venue. Without it, no assignee list. */
  roster?: CoveragePerson[]
  /** History only (retired, or a section of a replaced menu): no setup. */
  readOnly?: boolean
  /** The amenity facts section, shown while the item can be set up. */
  facts?: React.ReactNode
  /** A page notice under the state, such as a replaced menu. */
  notice?: React.ReactNode
  /** The photos section: beside the setup on desktop, below it on phones. */
  photos?: React.ReactNode
  onUpdate: UpdateRequirementHandler
  onSetStatus: SetRequirementStatusHandler
  onSetAssignees?: SetAssigneesHandler
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
  const [reopening, setReopening] = React.useState(false)
  if (seed !== savedKey) {
    setSeed(savedKey)
    setDraft(draftOf(requirement))
    setErrors({})
    setReopening(false)
  }

  // The choice resets only when the saved set changes, not on every refresh:
  // a re-render after another action must not clear an unsaved selection.
  const savedAssignees = [...requirement.assigneeIds].sort().join(",")
  const [assigneeSeed, setAssigneeSeed] = React.useState(savedAssignees)
  const [selected, setSelected] = React.useState<string[]>(
    requirement.assigneeIds
  )
  if (assigneeSeed !== savedAssignees) {
    setAssigneeSeed(savedAssignees)
    setSelected(requirement.assigneeIds)
  }

  const [dialog, setDialog] = React.useState<
    "not_applicable" | "retire" | null
  >(null)

  const { status } = requirement
  const retired = status === "retired"
  const notApplicable = status === "not_applicable"
  const open = status === "active" || status === "needs_setup"
  const settingUp = !readOnly && (open || (notApplicable && reopening))
  const confirming = status === "needs_setup" || notApplicable

  const patch = patchOf(requirement, draft, editableTitle)
  const detailsDirty = Object.keys(patch).length > 0
  const savedSet = new Set(requirement.assigneeIds)
  const assigneesDirty =
    selected.length !== savedSet.size ||
    selected.some((id) => !savedSet.has(id))
  const showAssignees = settingUp && roster != null && onSetAssignees != null
  const dirty = detailsDirty || (showAssignees && assigneesDirty)

  const amenity = requirement.amenity
  const factReady =
    !amenity || (amenity.presence === "present" && amenity.confirmed)
  const factKnown = !amenity || (amenity.presence ?? "unknown") !== "unknown"
  const blocked = !factReady
    ? amenity?.presence === "absent"
      ? "Can't confirm yet: Not present."
      : "Can't confirm yet: Needs verification."
    : null

  function set<K extends keyof Draft>(key: K, value: string) {
    setDraft((current) => ({ ...current, [key]: value }))
  }

  function toggle(id: string) {
    setSelected((current) =>
      current.includes(id) ? current.filter((x) => x !== id) : [...current, id]
    )
  }

  /**
   * Saves the details first so the confirmed target is the one shown, then
   * the status, then who photographs it (assignees need an open item).
   */
  async function save(confirm: boolean) {
    const found: Partial<Record<string, string>> = validate(
      draft,
      editableTitle
    )
    if (showAssignees && selected.length > COVERAGE_LIMITS.assigneesMax) {
      found.assignees = `Choose up to ${COVERAGE_LIMITS.assigneesMax} people.`
    }
    setErrors(found)
    if (Object.keys(found).length > 0) return
    if (!confirm && !dirty) return

    const confirmed = `Confirmed: ${plural(Number(draft.photoTarget), "photo")} needed. It now counts toward venue coverage.`
    const assigned =
      selected.length === 0
        ? "Saved. No one is assigned."
        : `Saved. ${plural(selected.length, "person", "people")} assigned.`
    const saveAssignees = showAssignees && assigneesDirty

    let revision = requirement.revision
    if (detailsDirty) {
      const saved = await action.run(
        () =>
          onUpdate({
            requirementId: requirement.id,
            expectedRevision: revision,
            patch,
          }),
        "Saved."
      )
      if (!saved.ok) {
        if ("fieldErrors" in saved && saved.fieldErrors) {
          setErrors(saved.fieldErrors)
        }
        return
      }
      revision = saved.revision
    }
    if (confirm) {
      const done = await action.run(
        () =>
          onSetStatus({
            requirementId: requirement.id,
            expectedRevision: revision,
            status: "active",
          }),
        confirmed
      )
      if (!done.ok) return
    }
    if (saveAssignees && onSetAssignees) {
      const result = await action.run(
        () => onSetAssignees(selected),
        confirm ? confirmed : assigned
      )
      if (!result.ok && "fieldErrors" in result && result.fieldErrors) {
        setErrors({ assignees: result.fieldErrors.assigneeIds })
      }
    }
  }

  function statusChange(next: "not_applicable" | "retired") {
    return async (reason: string) => {
      const result = await action.run(
        () =>
          onSetStatus({
            requirementId: requirement.id,
            expectedRevision: requirement.revision,
            status: next,
            reason,
          }),
        next === "retired"
          ? "Retired. Its photos and history are kept."
          : "Marked as not applicable. It stays on the checklist and isn't counted."
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

  const issues = requirementIssues(requirement)
  const overdue =
    status === "active" && requirement.progress.overdue && !retired
  const complete =
    status === "active" && requirement.progress.satisfied && !overdue
  const choices = showAssignees ? choicesOf(requirement, roster ?? []) : []
  const statusId = `${ids}-bar-status`
  const barStatus = !settingUp
    ? null
    : confirming
      ? (blocked ??
        (selected.length > 0 ? "Ready to confirm" : "Not confirmed yet"))
      : null

  const left = (
    <div className="grid min-w-0 content-start gap-(--gutter) md:gap-4">
      <OfflineNotice />
      <div className={cn(CARD, "gap-3")}>
        <div className="grid gap-2">
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <RequirementChip requirement={requirement} />
            {notApplicable || retired ? (
              <span className="text-meta text-ink-muted">Not counted</span>
            ) : null}
          </p>
          {issues.length > 0 && !readOnly ? (
            <ul className="grid gap-1">
              {issues.map((issue) => (
                <li
                  key={issue}
                  className="flex items-start gap-1.5 text-meta font-bold text-warn-fg"
                >
                  <WarningIcon
                    aria-hidden
                    className="mt-0.5 size-[18px] shrink-0"
                  />
                  <span>{issue}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
        {notApplicable && requirement.statusReason ? (
          <Quote>{requirement.statusReason}</Quote>
        ) : null}
        {notApplicable ? (
          <p className={MUTED}>
            It stays on the checklist so everyone can see why. Choose Applies to
            set it up again.
          </p>
        ) : null}
        {retired ? (
          <Notice>
            {requirement.statusReason
              ? withStop(requirement.statusReason)
              : "Retired."}{" "}
            Its photos stay in Photos and on people&apos;s profiles.
          </Notice>
        ) : null}
        {overdue ? (
          <Notice tone="negative" role="note" title="Overdue">
            {overdueText(requirement)}
          </Notice>
        ) : null}
        {complete && month ? (
          <p role="status" className={MUTED}>
            Complete for {month}. Extra photos still go to Photos and can be
            accepted.
          </p>
        ) : null}
        {notice}
        <CoverageNotice
          ref={noticeRef}
          notice={action.notice}
          onDismiss={action.dismiss}
        />
      </div>

      {settingUp ? facts : null}

      {!retired && !readOnly ? (
        <CoverageSection title="Setup" id={`${ids}-setup`}>
          <form
            className={cn(CARD, "gap-5")}
            noValidate
            onSubmit={(event) => {
              event.preventDefault()
              void save(confirming)
            }}
          >
            <div className="grid gap-1.5">
              <span className="text-label text-ink">
                Does this apply at {venueName}?
              </span>
              <AppliesChoice
                label={`Does this apply at ${venueName}?`}
                applies={open || reopening}
                appliesDisabled={action.pending}
                notApplyDisabled={
                  action.pending || (!notApplicable && !factKnown)
                }
                onApplies={() => setReopening(true)}
                onDoesNotApply={() =>
                  notApplicable
                    ? setReopening(false)
                    : setDialog("not_applicable")
                }
              />
            </div>

            {settingUp ? (
              <>
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
                      disabled={action.pending}
                    />
                    {errors.title ? (
                      <FieldError>{errors.title}</FieldError>
                    ) : null}
                  </Field>
                ) : null}
                <Field className="gap-1.5">
                  <FieldLabel htmlFor={`${ids}-target`}>
                    Photo target
                  </FieldLabel>
                  <Stepper
                    id={`${ids}-target`}
                    name={`${requirement.title} photo target`}
                    value={draft.photoTarget}
                    onChange={(value) => set("photoTarget", value)}
                    invalid={!!errors.photoTarget}
                    disabled={action.pending}
                    describedBy={`${ids}-target-help`}
                    max={COVERAGE_LIMITS.photoTargetMax}
                  />
                  <FieldDescription id={`${ids}-target-help`} className={HINT}>
                    {requirement.kind === "venue_specific" &&
                    status === "needs_setup"
                      ? "Set how many accepted photos make this complete."
                      : "Accepted photos needed for Complete."}
                  </FieldDescription>
                  {errors.photoTarget ? (
                    <FieldError>{errors.photoTarget}</FieldError>
                  ) : null}
                </Field>
                <Field className="gap-1.5">
                  <FieldLabel htmlFor={`${ids}-guidance`}>
                    Guidance{" "}
                    <span className="font-normal text-ink-muted">
                      (optional)
                    </span>
                  </FieldLabel>
                  <textarea
                    id={`${ids}-guidance`}
                    value={draft.guidance}
                    onChange={(e) => set("guidance", e.currentTarget.value)}
                    maxLength={COVERAGE_LIMITS.guidanceMax}
                    rows={2}
                    aria-invalid={!!errors.guidance || undefined}
                    aria-describedby={`${ids}-guidance-help`}
                    className={cn(textareaClass, "min-h-16")}
                    disabled={action.pending}
                  />
                  <FieldDescription
                    id={`${ids}-guidance-help`}
                    className={HINT}
                  >
                    Staff see this on the task.
                  </FieldDescription>
                  {errors.guidance ? (
                    <FieldError>{errors.guidance}</FieldError>
                  ) : null}
                </Field>
                <Field className="gap-1.5">
                  <FieldLabel htmlFor={`${ids}-due`}>Due date</FieldLabel>
                  <Input
                    id={`${ids}-due`}
                    type="date"
                    value={draft.dueOn}
                    onChange={(e) => set("dueOn", e.currentTarget.value)}
                    aria-invalid={!!errors.dueOn || undefined}
                    aria-describedby={`${ids}-due-help`}
                    className="w-full sm:w-64"
                    disabled={action.pending}
                  />
                  <FieldDescription id={`${ids}-due-help`} className={HINT}>
                    Overdue is for follow-up. It never stops anyone sending
                    photos.
                  </FieldDescription>
                  {errors.dueOn ? (
                    <FieldError>{errors.dueOn}</FieldError>
                  ) : null}
                </Field>
              </>
            ) : null}
          </form>
          {requirement.kind !== "menu_section" ? (
            <div className={cn(CARD, "justify-items-start gap-2")}>
              <Button
                variant="danger"
                size="touch"
                onClick={() => setDialog("retire")}
                disabled={action.pending}
              >
                <TrashIcon data-icon="inline-start" aria-hidden />
                Retire this item
              </Button>
              <p className={HINT}>
                Retiring removes it from the checklist for good. Its photos and
                decisions stay in the history.
              </p>
            </div>
          ) : null}
        </CoverageSection>
      ) : null}

      {showAssignees ? (
        <CoverageSection title="Who photographs it" id={`${ids}-who`}>
          {requirement.assigneeIds.length === 0 ? (
            <Notice tone="attention">
              No one is assigned. Choose who photographs this.
            </Notice>
          ) : null}
          {choices.length === 0 ? (
            <p className={cn(CARD, MUTED)}>No active staff at this venue.</p>
          ) : (
            <ul
              className="grid min-w-0 divide-y divide-line overflow-hidden rounded-card bg-surface shadow-card"
              aria-label="Who photographs it"
            >
              {choices.map((choice) => (
                <li key={choice.id}>
                  <label className="flex min-h-16 cursor-pointer items-center gap-3 px-3 py-2.5 transition-colors duration-(--duration-quick) hover:bg-surface-2 has-checked:bg-accent-soft has-disabled:cursor-not-allowed md:px-4">
                    <input
                      type="checkbox"
                      checked={selected.includes(choice.id)}
                      onChange={() => toggle(choice.id)}
                      disabled={action.pending}
                      className="size-6 shrink-0 accent-select"
                    />
                    <span className="grid min-w-0 gap-0.5">
                      <span className="flex flex-wrap items-center gap-2 text-item-title [overflow-wrap:anywhere] text-ink">
                        {choice.name}
                        {!choice.away && choice.person ? (
                          <TeamTag department={choice.person.department} />
                        ) : null}
                      </span>
                      {choice.away ? (
                        <span className="text-meta font-semibold text-warn-fg">
                          No longer at {venueName}. Can&apos;t be assigned here.
                        </span>
                      ) : choice.person?.jobTitle ? (
                        <span className={HINT}>{choice.person.jobTitle}</span>
                      ) : null}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}
          {errors.assignees ? (
            <FieldError>{errors.assignees}</FieldError>
          ) : null}
          <p className={MUTED}>{TEAM_SUGGESTION_COPY}</p>
        </CoverageSection>
      ) : null}
    </div>
  )

  return (
    <>
      <div
        className={cn(
          "grid gap-(--gutter) md:gap-4",
          photos &&
            "lg:grid-cols-[minmax(0,var(--size-reading))_minmax(340px,1fr)] lg:items-start"
        )}
      >
        {left}
        {photos ? (
          <div className="grid min-w-0 content-start gap-(--gutter) md:gap-4">
            {photos}
          </div>
        ) : null}
      </div>

      {settingUp ? (
        <div className="sticky bottom-[calc(var(--size-tabbar)+env(safe-area-inset-bottom,0px))] z-30 -mx-(--page-gutter) flex flex-wrap items-center justify-between gap-3 border-t border-line bg-surface px-(--page-gutter) py-3 shadow-float md:bottom-0 md:mx-0 md:rounded-card md:border-t-0 md:px-4 md:shadow-card">
          <p id={statusId} role="status" className="text-meta text-ink-muted">
            {barStatus}
          </p>
          <Button
            variant={confirming ? "primary" : "secondary"}
            size="touch"
            className="ms-auto"
            onClick={() => void save(confirming)}
            disabled={action.pending || (confirming ? blocked != null : !dirty)}
            aria-describedby={barStatus ? statusId : undefined}
            aria-busy={action.pending || undefined}
          >
            {action.pending ? (
              <SpinnerGapIcon aria-hidden className="animate-spin" />
            ) : (
              <CheckIcon aria-hidden />
            )}
            {action.pending
              ? "Saving…"
              : confirming
                ? "Save and confirm"
                : "Save changes"}
          </Button>
        </div>
      ) : null}

      <ReasonDialog
        open={dialog === "not_applicable"}
        onOpenChange={(isOpen) => setDialog(isOpen ? "not_applicable" : null)}
        title="Mark as not applicable"
        label="Reason"
        help="Shown on the checklist with the item. Admins can see it."
        emptyError="Add a reason. It's shown with the item on the checklist."
        note="The item stays on the checklist and isn't counted. Photos already sent stay in Photos."
        confirmLabel="Mark as not applicable"
        pendingLabel="Marking…"
        confirmIcon={<ProhibitIcon aria-hidden />}
        onConfirm={statusChange("not_applicable")}
        reportFocus={() => noticeRef.current}
      >
        <p className="text-body">
          <strong className="font-bold text-ink">{requirement.title}</strong>
          <br />
          <span className="text-ink-muted">
            {[
              labelFor(REQUIREMENT_KIND_SINGULAR, requirement.kind),
              venueName,
              month,
            ]
              .filter(Boolean)
              .join(" · ")}
          </span>
        </p>
      </ReasonDialog>
      <ReasonDialog
        open={dialog === "retire"}
        onOpenChange={(isOpen) => setDialog(isOpen ? "retire" : null)}
        title={`Retire “${requirement.title}”?`}
        description="Assignments end and it leaves the checklist. Its photos and decisions are kept as history. This cannot be undone."
        label="Reason"
        confirmLabel="Retire"
        pendingLabel="Retiring…"
        destructive
        onConfirm={statusChange("retired")}
        reportFocus={() => noticeRef.current}
      />
    </>
  )
}
