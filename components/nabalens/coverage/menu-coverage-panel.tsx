"use client"

import * as React from "react"
import {
  ArrowRightIcon,
  CheckIcon,
  ForkKnifeIcon,
  TrashIcon,
} from "@phosphor-icons/react"

import { formatDateTime } from "@/components/nabalens/menus/copy"
import { OptionSelect } from "@/components/nabalens/option-select"
import { Button } from "@/components/ui/button"
import { FieldError } from "@/components/ui/field"

import { CoverageNotice } from "./coverage-notice"
import { MENU_STATE_LABEL, labelFor, plural, type CopyMap } from "./copy"
import { EvidenceThumb } from "./evidence-image"
import { ReasonField } from "./reason-dialog"
import { RequirementList } from "./requirement-list"
import type {
  CoverageResult,
  MenuCoverageView,
  MenuPlanInput,
  ReconcileMenuRequirementInput,
  RequirementView,
  SubmissionView,
} from "./types"
import { useCoverageAction } from "./use-coverage-action"
import { manageHrefs } from "./manage-nav"
import { MenuChangedBanner } from "./venue-coverage-summary"

export type MenuCoverageHandlers = {
  start: (menuVersionId: string) => Promise<CoverageResult<object>>
  confirm: (input: MenuPlanInput) => Promise<CoverageResult<object>>
  discard: (input: MenuPlanInput) => Promise<CoverageResult<object>>
  reconcile: (
    input: ReconcileMenuRequirementInput
  ) => Promise<CoverageResult<object>>
}

const SECTION_KIND: CopyMap = {
  food: "Food",
  drinks: "Drinks",
  other: "Other",
}

function sectionLabel(requirement: RequirementView): string {
  return requirement.menuSection?.sectionName ?? requirement.title
}

function ReconcileCard({
  requirement,
  evidence,
  targets,
  onReconcile,
  pending,
}: {
  requirement: RequirementView
  evidence: SubmissionView[]
  targets: RequirementView[]
  onReconcile: (
    input: ReconcileMenuRequirementInput
  ) => Promise<{ ok: boolean; fieldErrors?: Partial<Record<string, string>> }>
  pending: boolean
}) {
  const ids = React.useId()
  const carryable = evidence.filter(
    (s) => s.state === "accepted" && s.asset.available
  )
  const [selected, setSelected] = React.useState<string[]>(() =>
    carryable.map((s) => s.id)
  )
  const [targetId, setTargetId] = React.useState<string | null>(null)
  const [reason, setReason] = React.useState("")
  const [errors, setErrors] = React.useState<Partial<Record<string, string>>>(
    {}
  )

  function toggle(id: string) {
    setSelected((current) =>
      current.includes(id) ? current.filter((x) => x !== id) : [...current, id]
    )
  }

  async function submit(carry: boolean) {
    const found: Record<string, string> = {}
    if (carry && !targetId) found.toRequirementId = "Choose the new section."
    if (carry && selected.length === 0)
      found.submissionIds = "Choose at least one photo, or carry nothing."
    if (!reason.trim()) found.reason = "Give a reason."
    setErrors(found)
    if (Object.keys(found).length > 0) return
    const result = await onReconcile({
      fromRequirementId: requirement.id,
      toRequirementId: carry ? targetId : null,
      submissionIds: carry ? selected : [],
      reason: reason.trim(),
    })
    if (!result.ok) setErrors(result.fieldErrors ?? {})
  }

  const options = targets.map((t) => ({ id: t.id, name: sectionLabel(t) }))

  return (
    <li className="grid gap-3 rounded-lg border bg-card p-4">
      <div className="grid gap-0.5">
        <h3 className="font-medium break-words">
          Previous section: {sectionLabel(requirement)}
        </h3>
        <p className="text-sm text-muted-foreground">
          {plural(carryable.length, "accepted photo")} with the photo still
          available
          {requirement.menuSection?.sectionKind
            ? ` · ${labelFor(SECTION_KIND, requirement.menuSection.sectionKind)}`
            : null}
        </p>
      </div>
      {carryable.length > 0 ? (
        <fieldset className="grid gap-2" disabled={pending}>
          <legend className="mb-1 text-sm font-medium">
            Photos to carry over
          </legend>
          <ul className="grid grid-cols-3 gap-2 sm:grid-cols-6">
            {carryable.map((submission) => (
              <li key={submission.id}>
                <label className="grid cursor-pointer gap-1 rounded-chip p-1 has-checked:bg-accent-soft has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-focus">
                  <EvidenceThumb src={submission.asset.thumbnailUrl} />
                  <span className="flex items-center gap-1.5 text-xs">
                    <input
                      type="checkbox"
                      checked={selected.includes(submission.id)}
                      onChange={() => toggle(submission.id)}
                      className="size-4 accent-primary"
                    />
                    <span className="min-w-0 break-words">
                      {submission.author.displayName}
                    </span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
          {errors.submissionIds ? (
            <FieldError>{errors.submissionIds}</FieldError>
          ) : null}
        </fieldset>
      ) : null}
      {carryable.length > 0 ? (
        <div className="grid gap-1.5">
          <label htmlFor={`${ids}-target`} className="text-sm font-medium">
            Carry them to this section of the new menu
          </label>
          <OptionSelect
            id={`${ids}-target`}
            options={options}
            value={targetId}
            onValueChange={setTargetId}
            placeholder={
              options.length ? "Choose a section…" : "No active section yet"
            }
            disabled={pending || options.length === 0}
            invalid={!!errors.toRequirementId}
          />
          {errors.toRequirementId ? (
            <FieldError>{errors.toRequirementId}</FieldError>
          ) : null}
        </div>
      ) : null}
      <ReasonField
        id={`${ids}-reason`}
        label="Reason"
        help="For example: “Same dishes, section renamed” or “Section removed from the menu”."
        value={reason}
        onChange={setReason}
        error={errors.reason}
        disabled={pending}
      />
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        {carryable.length > 0 ? (
          <Button
            size="touch"
            onClick={() => void submit(true)}
            disabled={pending || options.length === 0}
          >
            <ArrowRightIcon data-icon="inline-start" aria-hidden />
            Carry {plural(selected.length, "photo")}
          </Button>
        ) : null}
        <Button
          variant="outline"
          size="touch"
          onClick={() => void submit(false)}
          disabled={pending}
        >
          Carry nothing and close it
        </Button>
      </div>
    </li>
  )
}

/**
 * Menu coverage: confirm the venue's active menu version as the source of
 * section requirements, set each section up, and after a menu change carry
 * accepted photos to the new sections one by one. Nothing is matched by name.
 */
export function MenuCoveragePanel({
  menu,
  evidence,
  basePath,
  handlers,
  onStale,
}: {
  menu: MenuCoverageView
  /** Accepted photos of each superseded requirement, by requirement id. */
  evidence: Record<string, SubmissionView[]>
  /** The venue's manager tools (`/staff/manage` or an admin venue). */
  basePath: string
  handlers: MenuCoverageHandlers
  onStale?: () => void
}) {
  const action = useCoverageAction(onStale)
  const requirementHref = manageHrefs(basePath).requirement
  const { activeVersion, draftPlan, currentPlan } = menu
  const draftOpen = menu.draft.filter((r) => r.status === "needs_setup")
  const reconcileTargets = menu.current.filter((r) => r.status === "active")
  const canStart =
    !!activeVersion &&
    !draftPlan &&
    (menu.menuState === "needs_setup" || menu.menuState === "menu_changed")

  return (
    <div className="grid gap-6">
      <section aria-labelledby="menu-state-title" className="grid gap-3">
        <h2
          id="menu-state-title"
          className="flex flex-wrap items-center gap-2 text-lg font-medium"
        >
          <ForkKnifeIcon aria-hidden />
          {labelFor(MENU_STATE_LABEL, menu.menuState)}
        </h2>
        <MenuChangedBanner state={menu.menuState} />
        <p className="max-w-prose text-sm text-muted-foreground">
          Each menu section you include needs a set number of distinct accepted
          photos. Dishes do not each need a photo, and optional dish labels
          never count toward completion.
        </p>
        {activeVersion ? (
          <p className="text-sm">
            Active menu:{" "}
            <span className="font-medium">{activeVersion.title}</span>
            {activeVersion.activatedAt
              ? ` (since ${formatDateTime(activeVersion.activatedAt)})`
              : null}
            {currentPlan && currentPlan.menuVersionId !== activeVersion.id
              ? ". Coverage still follows the previous menu until you confirm the new one."
              : null}
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">
            There is no active menu at this venue. An admin activates menus;
            menu sections join the checklist after that.
          </p>
        )}
        <CoverageNotice notice={action.notice} onDismiss={action.dismiss} />
      </section>

      {canStart && activeVersion ? (
        <section
          aria-labelledby="menu-start-title"
          className="grid gap-3 rounded-lg border bg-card p-4"
        >
          <h2 id="menu-start-title" className="font-medium">
            Use “{activeVersion.title}” for menu coverage
          </h2>
          <p className="text-sm text-muted-foreground">
            This adds one checklist item per section below, each needing setup.
            You then choose which sections apply, their photo targets and who
            takes them, and confirm.
            {currentPlan
              ? " The previous plan and its photos stay until you confirm."
              : null}
          </p>
          <ul className="grid gap-1 text-sm sm:grid-cols-2">
            {activeVersion.sections.map((section) => (
              <li key={section.sectionId}>
                {section.name}{" "}
                <span className="text-muted-foreground">
                  ({labelFor(SECTION_KIND, section.kind)})
                </span>
              </li>
            ))}
          </ul>
          <div>
            <Button
              size="touch"
              onClick={() =>
                void action.run(
                  () => handlers.start(activeVersion.id),
                  "Menu sections added. Set each one up, then confirm."
                )
              }
              disabled={action.pending || activeVersion.sections.length === 0}
            >
              {action.pending ? "Starting…" : "Start from this menu"}
            </Button>
          </div>
        </section>
      ) : null}

      {draftPlan ? (
        <section aria-labelledby="menu-draft-title" className="grid gap-3">
          <div className="grid gap-1">
            <h2 id="menu-draft-title" className="text-lg font-medium">
              New menu plan (not confirmed)
            </h2>
            <p className="text-sm text-muted-foreground">
              {menu.draft.length - draftOpen.length} of{" "}
              {plural(menu.draft.length, "section")} set up. Open each section
              to confirm whether it applies, its photo target and who takes it.
            </p>
          </div>
          <RequirementList
            requirements={menu.draft}
            hrefFor={requirementHref}
            kinds={["menu_section"]}
            emptyTitle="This plan has no sections."
          />
          {draftOpen.length > 0 ? (
            <p className="text-sm text-warning">
              Set up or exclude {plural(draftOpen.length, "more section")}{" "}
              before confirming.
            </p>
          ) : null}
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button
              size="touch"
              onClick={() =>
                void action.run(
                  () =>
                    handlers.confirm({
                      planId: draftPlan.id,
                      expectedRevision: draftPlan.revision,
                    }),
                  currentPlan
                    ? "Confirmed. Now choose which photos carry over from the previous menu."
                    : "Menu coverage confirmed."
                )
              }
              disabled={action.pending || draftOpen.length > 0}
            >
              <CheckIcon data-icon="inline-start" aria-hidden />
              Confirm menu coverage
            </Button>
            <Button
              variant="outline"
              size="touch"
              onClick={() =>
                void action.run(
                  () =>
                    handlers.discard({
                      planId: draftPlan.id,
                      expectedRevision: draftPlan.revision,
                    }),
                  "Draft plan discarded."
                )
              }
              disabled={action.pending}
            >
              <TrashIcon data-icon="inline-start" aria-hidden />
              Discard draft
            </Button>
          </div>
        </section>
      ) : null}

      {menu.superseded.length > 0 ? (
        <section aria-labelledby="menu-reconcile-title" className="grid gap-3">
          <div className="grid gap-1">
            <h2 id="menu-reconcile-title" className="text-lg font-medium">
              Carry photos from the previous menu
            </h2>
            <p className="max-w-prose text-sm text-muted-foreground">
              For each previous section, choose which accepted photos still fit
              a section of the new menu. Nothing is matched by name. Carried
              photos count for venue coverage only, never for monthly targets,
              and the previous plan stays in the history.
            </p>
          </div>
          <ul className="grid gap-3">
            {menu.superseded.map((requirement) => (
              <ReconcileCard
                key={requirement.id}
                requirement={requirement}
                evidence={evidence[requirement.id] ?? []}
                targets={reconcileTargets}
                pending={action.pending}
                onReconcile={async (input) => {
                  const result = await action.run(
                    () => handlers.reconcile(input),
                    input.toRequirementId
                      ? `Carried ${plural(input.submissionIds?.length ?? 0, "photo")} to the new section.`
                      : `Closed “${sectionLabel(requirement)}” without carrying photos.`
                  )
                  return {
                    ok: result.ok,
                    fieldErrors:
                      !result.ok && "fieldErrors" in result
                        ? result.fieldErrors
                        : undefined,
                  }
                }}
              />
            ))}
          </ul>
        </section>
      ) : null}

      {currentPlan ? (
        <section aria-labelledby="menu-current-title" className="grid gap-3">
          <h2 id="menu-current-title" className="text-lg font-medium">
            Current menu sections
          </h2>
          <RequirementList
            requirements={menu.current}
            hrefFor={requirementHref}
            kinds={["menu_section"]}
            emptyTitle="No sections in the confirmed plan."
          />
        </section>
      ) : null}
    </div>
  )
}
