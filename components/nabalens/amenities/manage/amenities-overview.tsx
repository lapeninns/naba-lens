"use client"

import * as React from "react"
import {
  ArrowCounterClockwiseIcon,
  CheckCircleIcon,
  ClockIcon,
  PlusIcon,
  ShieldCheckIcon,
  SpinnerGapIcon,
  WarningIcon,
} from "@phosphor-icons/react"
import Link from "next/link"

import {
  CoverageNotice,
  CoverageSection,
  Tally,
  TallyItem,
} from "@/components/nabalens/coverage"
import { Notice } from "@/components/nabalens/notice"
import { Button, buttonVariants } from "@/components/ui/button"
import {
  PROGRESS_LABEL,
  UI_TEXT,
  amenityHrefs,
  type AmenityResult,
  type CatalogueOption,
  type CheckProgress,
  type CheckSummary,
  type VenueAmenitiesView,
} from "@/lib/amenities/contract"

import {
  KNOWLEDGE_ANSWER_LABEL,
  recheckCauseLine,
  shortDate,
  TO_CONFIRM_COPY,
  VENUE_RECHECKS_COPY,
  toConfirmLine,
  qualifiedInUse,
} from "@/components/nabalens/knowledge/copy"
import { StatusChip } from "@/components/nabalens/status-chip"
import type {
  RecheckTask,
  ToConfirmList,
  ToConfirmRow,
} from "@/lib/knowledge-client/contract"

import { CataloguePicker, type AddOutcome } from "./catalogue-picker"
import { assigneeText, CheckRow } from "./check-row"
import { useAmenityAction } from "./use-amenity-action"

export type AmenitiesOverviewHandlers = {
  enable: () => Promise<AmenityResult<{ created: number }>>
  /** `idempotencyKey`: one per intent, reused on a retry (MG-10). */
  addChecks: (
    keys: string[],
    idempotencyKey: string
  ) => Promise<AmenityResult<{ checkIds: string[] }>>
  restore: (input: {
    checkId: string
    revision: number
    idempotencyKey: string
  }) => Promise<AmenityResult<{ revision: number }>>
}

/** Answers in use that are qualified (b03-design §3.8; B03 UI design §2.6). */
export const QUALIFIED_TITLE =
  "Answered with conditions or temporarily unavailable"

/** Work first: what needs a recheck, then what was never captured, then done. */
export const PROGRESS_ORDER: CheckProgress[] = [
  "needs_recheck",
  "needs_capture",
  "complete",
]

const PROGRESS_ICON = {
  needs_capture: ClockIcon,
  needs_recheck: WarningIcon,
  complete: CheckCircleIcon,
} as const

const PROGRESS_TONE = {
  needs_capture: "neutral",
  needs_recheck: "attention",
  complete: "positive",
} as const

function byPosition(a: CheckSummary, b: CheckSummary) {
  return a.entry.position - b.entry.position
}

function plural(n: number, one: string, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`
}

/**
 * One venue's amenity checks for its manager or an admin: whether Amenities
 * are on, counts, the active checks by progress, recent answers and the
 * archive. Adding comes from the shared catalogue.
 */
export function AmenitiesOverview({
  view,
  catalogue,
  basePath,
  handlers,
  toConfirm = null,
  toConfirmFailed = false,
  rechecks,
}: {
  view: VenueAmenitiesView
  /** Null when the catalogue could not be read (or Amenities are off). */
  catalogue: CatalogueOption[] | null
  basePath: string
  handlers: AmenitiesOverviewHandlers
  /** Findings and answers waiting for a decision, when they could be read. */
  toConfirm?: ToConfirmList | null
  /** The findings to confirm couldn't be read: say so (MG-03). */
  toConfirmFailed?: boolean
  /**
   * A41: the venue's open rechecks, oldest due first (the tasks the triage
   * row counts); null when they couldn't be read, undefined when not read.
   */
  rechecks?: readonly RecheckTask[] | null
}) {
  const hrefs = amenityHrefs(basePath)
  const action = useAmenityAction()
  const [pickerOpen, setPickerOpen] = React.useState(false)
  const [show, setShow] = React.useState<"all" | "findings" | "imports">("all")
  const venue = view.venue.name
  const rootRef = React.useRef<HTMLDivElement>(null)
  const noticeRef = React.useRef<HTMLDivElement>(null)
  // Restore moves the row out of the archive, taking its button with it:
  // focus follows the check to its new row once the page re-reads, or the
  // notice when the restore didn't land.
  const [restored, setRestored] = React.useState<string | null>(null)
  const focusNotice = React.useRef(false)
  const restoring = React.useRef(false)
  React.useEffect(() => {
    if (!restored) return
    const link = rootRef.current?.querySelector<HTMLElement>(
      `li[data-check-id="${restored}"]:not([data-archived]) a`
    )
    if (!link) return
    setRestored(null)
    link.focus()
  }, [restored, view])
  React.useEffect(() => {
    if (!action.notice || !focusNotice.current) return
    focusNotice.current = false
    // A restore that landed moves focus to its row instead.
    if (restoring.current && action.notice.tone === "success") return
    noticeRef.current?.focus()
  }, [action.notice])

  async function enable() {
    // Enable is replaced by the checks once it lands.
    focusNotice.current = true
    restoring.current = false
    await action.run(handlers.enable, (r) =>
      r.created > 0
        ? `Amenities are on for ${venue}: ${plural(r.created, "core check")} added.`
        : `Amenities are on for ${venue}.`
    )
  }

  async function add(keys: string[]): Promise<AddOutcome> {
    const result = await action.runKeyed(
      `amenity-venue:${view.venue.id}:add`,
      { keys },
      (idempotencyKey) => handlers.addChecks(keys, idempotencyKey),
      (r) => `${plural(r.checkIds.length, "check")} added.`
    )
    if (result.ok) return { ok: true }
    if (result.code === "invalid_input")
      return {
        ok: false,
        error: result.message,
        fieldError: result.fieldErrors?.keys,
      }
    // Anything else is reported on the page, which re-reads itself if stale.
    return {
      ok: false,
      error: result.message,
      close: result.code !== "network",
    }
  }

  async function restore(check: CheckSummary) {
    focusNotice.current = true
    restoring.current = true
    const input = { checkId: check.id, revision: check.revision }
    const result = await action.runKeyed(
      `amenity-check:${check.id}:restore`,
      input,
      (idempotencyKey) => handlers.restore({ ...input, idempotencyKey }),
      `Restored “${check.entry.question}”.`
    )
    if (result.ok) setRestored(check.id)
  }

  const notice = (
    <CoverageNotice
      ref={noticeRef}
      notice={action.notice}
      onDismiss={action.dismiss}
    />
  )

  if (!view.enabled) {
    return (
      <div ref={rootRef} className="grid gap-4">
        {notice}
        {view.canEnable ? (
          <Notice
            title={`Amenities aren't on for ${venue} yet`}
            action={
              <Button
                size="touch"
                onClick={enable}
                disabled={action.pending}
                aria-busy={action.pending || undefined}
              >
                {action.pending ? (
                  <SpinnerGapIcon aria-hidden className="animate-spin" />
                ) : null}
                {UI_TEXT.enable}
              </Button>
            }
          >
            Enabling adds the four core checks (step-free entrance, parking,
            guest toilets and guest Wi-Fi), unassigned. The venue&apos;s manager
            can then add more from the catalogue.
          </Notice>
        ) : (
          <Notice title={`Amenities aren't on for ${venue} yet`}>
            An admin must enable Amenities for {venue} before you can add or
            assign checks.
          </Notice>
        )}
      </div>
    )
  }

  // A qualified answer reads needs recheck but is an answer in use (§2.6):
  // it gets its own group and count, never the recheck ones.
  const qualified = view.active
    .filter((check) => qualifiedInUse(check.qualification))
    .sort(byPosition)
  const groups = PROGRESS_ORDER.map((progress) => ({
    progress,
    checks: view.active
      .filter(
        (check) =>
          check.progress === progress && !qualifiedInUse(check.qualification)
      )
      .sort(byPosition),
  }))
  const countOf = (progress: CheckProgress) =>
    progress === "needs_recheck"
      ? Math.max(0, view.counts[progress] - qualified.length)
      : view.counts[progress]

  // B03-f (§7.1): imports and findings can be shown apart; the server's
  // order is kept either way.
  const isImportRow = (row: ToConfirmRow) =>
    row.source === "legacy_fact" || row.source === "external_source"
  const hasImports = (toConfirm?.items ?? []).some(isImportRow)
  const shownRows = (toConfirm?.items ?? []).filter((row) =>
    !hasImports || show === "all"
      ? true
      : show === "imports"
        ? isImportRow(row)
        : !isImportRow(row)
  )
  // One row per question: its findings are decided together.
  const confirmGroups = new Map<string, ToConfirmRow[]>()
  for (const row of shownRows)
    confirmGroups.set(row.checkId, [
      ...(confirmGroups.get(row.checkId) ?? []),
      row,
    ])
  const confirmCount = toConfirm?.count ?? 0
  // §6.3: a recheck's assignee is always its check's, read from the check.
  const assigneeOf = (checkId: string) => {
    const check = view.active.find((c) => c.id === checkId)
    return check?.assignee ? assigneeText(check) : null
  }

  return (
    <div ref={rootRef} className="grid gap-6 md:gap-8">
      {notice}
      <Tally>
        {confirmCount > 0 ? (
          <TallyItem
            label={TO_CONFIRM_COPY.title}
            value={confirmCount}
            tone="attention"
            icon={ShieldCheckIcon}
            href="#amenities-to-confirm"
          />
        ) : null}
        {PROGRESS_ORDER.map((progress) => (
          <TallyItem
            key={progress}
            label={PROGRESS_LABEL[progress]}
            value={countOf(progress)}
            tone={PROGRESS_TONE[progress]}
            icon={PROGRESS_ICON[progress]}
            href={`#amenities-${progress}`}
          />
        ))}
        {qualified.length > 0 ? (
          <TallyItem
            label={QUALIFIED_TITLE}
            value={qualified.length}
            icon={WarningIcon}
            href="#amenities-qualified"
          />
        ) : null}
      </Tally>

      <div className="flex flex-wrap items-center gap-3">
        <Button
          size="touch"
          variant="secondary"
          onClick={() => setPickerOpen(true)}
          disabled={!catalogue}
        >
          <PlusIcon aria-hidden />
          {UI_TEXT.addFromCatalogue}
        </Button>
        {!catalogue ? (
          <p className="text-meta-touch text-ink-muted md:text-meta">
            The catalogue couldn&apos;t be loaded. Reload the page to try again.
          </p>
        ) : null}
      </div>
      {catalogue ? (
        <CataloguePicker
          open={pickerOpen}
          onOpenChange={setPickerOpen}
          options={catalogue}
          venueName={venue}
          onAdd={add}
        />
      ) : null}

      {toConfirmFailed ? (
        <Notice tone="negative" role="alert">
          {TO_CONFIRM_COPY.failed}
        </Notice>
      ) : null}
      {confirmCount > 0 ? (
        <CoverageSection
          id="amenities-to-confirm"
          title={TO_CONFIRM_COPY.title}
          count={confirmCount}
        >
          {hasImports ? (
            <fieldset className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1">
              <legend className="sr-only">Show</legend>
              <span
                aria-hidden
                className="text-label-touch text-ink md:text-label"
              >
                Show:
              </span>
              {(
                [
                  ["all", "All"],
                  ["findings", "Findings"],
                  ["imports", "Imports"],
                ] as const
              ).map(([value, label]) => (
                <label
                  key={value}
                  className="flex min-h-11 cursor-pointer items-center gap-2 text-body-touch text-ink md:text-body"
                >
                  <input
                    type="radio"
                    name="amenities-to-confirm-show"
                    className="size-5 shrink-0 accent-primary"
                    checked={show === value}
                    onChange={() => setShow(value)}
                  />
                  {label}
                </label>
              ))}
            </fieldset>
          ) : null}
          <ul className="grid min-w-0 divide-y divide-line">
            {[...confirmGroups].map(([checkId, rows]) => (
              <li key={checkId}>
                <Link
                  href={`${hrefs.check(checkId)}#amenity-to-confirm`}
                  className="grid min-h-16 min-w-0 gap-1 py-3 outline-none hover:bg-surface-2 focus-visible:outline-3 focus-visible:-outline-offset-3 focus-visible:outline-focus focus-visible:outline-solid"
                >
                  <span className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-item-title [overflow-wrap:anywhere] text-ink">
                      {rows[0].question}
                    </span>
                    <StatusChip state="awaiting_confirmation" />
                  </span>
                  <span className="text-body-touch text-ink md:text-body">
                    {toConfirmLine(rows)}
                  </span>
                  {rows.length === 1 ? (
                    <span className="text-meta-touch text-ink-muted md:text-meta">
                      {[
                        rows[0].answer
                          ? `Answer: ${KNOWLEDGE_ANSWER_LABEL[rows[0].answer]}`
                          : null,
                        rows[0].sentAt
                          ? `Sent ${shortDate(rows[0].sentAt)}`
                          : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  ) : null}
                  {rows.some((row) => row.disputes) ? (
                    <span className="text-meta-touch text-ink-muted md:text-meta">
                      Readers are told it&apos;s being checked.
                    </span>
                  ) : null}
                </Link>
              </li>
            ))}
          </ul>
        </CoverageSection>
      ) : null}

      {rechecks === null ? (
        <Notice tone="negative" role="alert">
          {VENUE_RECHECKS_COPY.failed}
        </Notice>
      ) : rechecks && rechecks.length > 0 ? (
        <CoverageSection
          id="amenities-rechecks"
          title={VENUE_RECHECKS_COPY.title}
          count={rechecks.length}
        >
          <ul className="grid min-w-0 divide-y divide-line">
            {rechecks.map((task) => {
              const assignee = assigneeOf(task.checkId)
              return (
                <li
                  key={task.taskId}
                  data-check-id={task.checkId}
                  className="grid min-w-0 gap-2 py-3"
                >
                  <Link
                    href={hrefs.check(task.checkId)}
                    className="grid min-h-11 min-w-0 gap-1 outline-none hover:bg-surface-2 focus-visible:outline-3 focus-visible:-outline-offset-3 focus-visible:outline-focus focus-visible:outline-solid"
                  >
                    <span className="text-item-title [overflow-wrap:anywhere] text-ink">
                      {task.question}
                    </span>
                    <span className="text-body-touch text-ink md:text-body">
                      {recheckCauseLine(task)}
                    </span>
                    <span className="text-meta-touch text-ink-muted md:text-meta">
                      {[
                        VENUE_RECHECKS_COPY.due(task.dueAt),
                        assignee ?? VENUE_RECHECKS_COPY.notAssigned,
                      ].join(" · ")}
                    </span>
                  </Link>
                  <div>
                    {/* Assigns the check; the recheck follows it (§6.3). */}
                    <Link
                      href={`${hrefs.check(task.checkId)}#amenity-assignee`}
                      aria-label={`${VENUE_RECHECKS_COPY.assign}: ${task.question}`}
                      className={buttonVariants({
                        variant: "secondary",
                        size: "sm",
                      })}
                    >
                      {VENUE_RECHECKS_COPY.assign}
                    </Link>
                  </div>
                </li>
              )
            })}
          </ul>
        </CoverageSection>
      ) : null}

      {view.active.length === 0 ? (
        <p className="text-body-touch text-ink-muted md:text-body">
          No active checks. Add questions from the catalogue, or restore an
          archived check.
        </p>
      ) : (
        groups.map(({ progress, checks }) => (
          <CoverageSection
            key={progress}
            id={`amenities-${progress}`}
            title={PROGRESS_LABEL[progress]}
            count={checks.length}
          >
            {checks.length === 0 ? (
              <p className="text-body-touch text-ink-muted md:text-body-sm">
                None.
              </p>
            ) : (
              <ul className="grid min-w-0">
                {checks.map((check) => (
                  <CheckRow
                    key={check.id}
                    check={check}
                    href={hrefs.check(check.id)}
                  />
                ))}
              </ul>
            )}
          </CoverageSection>
        ))
      )}

      {qualified.length > 0 ? (
        <CoverageSection
          id="amenities-qualified"
          title={QUALIFIED_TITLE}
          count={qualified.length}
        >
          <ul className="grid min-w-0">
            {qualified.map((check) => (
              <CheckRow
                key={check.id}
                check={check}
                href={hrefs.check(check.id)}
              />
            ))}
          </ul>
        </CoverageSection>
      ) : null}

      <CoverageSection
        id="amenities-recent"
        title={UI_TEXT.recentlyCompleted}
        count={view.recentlyCompleted.length || undefined}
      >
        {view.recentlyCompleted.length === 0 ? (
          <p className="text-body-touch text-ink-muted md:text-body-sm">
            Nothing answered yet.
          </p>
        ) : (
          <ul className="grid min-w-0">
            {view.recentlyCompleted.map((check) => (
              <CheckRow
                key={check.id}
                check={check}
                href={hrefs.check(check.id)}
                showAnswered
              />
            ))}
          </ul>
        )}
      </CoverageSection>

      {view.archived.length > 0 ? (
        <CoverageSection
          id="amenities-archived"
          title={UI_TEXT.archived}
          count={view.archived.length}
        >
          <ul className="grid min-w-0">
            {[...view.archived].sort(byPosition).map((check) => (
              <CheckRow
                key={check.id}
                check={check}
                href={hrefs.check(check.id)}
                labelId={`archived-${check.id}`}
                action={
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => restore(check)}
                    disabled={action.pending}
                    aria-describedby={`archived-${check.id}`}
                  >
                    <ArrowCounterClockwiseIcon aria-hidden />
                    {UI_TEXT.restore}
                  </Button>
                }
              />
            ))}
          </ul>
        </CoverageSection>
      ) : null}
    </div>
  )
}
