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
import { Button } from "@/components/ui/button"
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
  shortDate,
  TO_CONFIRM_COPY,
  toConfirmLine,
} from "@/components/nabalens/knowledge/copy"
import { StatusChip } from "@/components/nabalens/status-chip"
import type {
  ToConfirmList,
  ToConfirmRow,
} from "@/lib/knowledge-client/contract"

import { CataloguePicker, type AddOutcome } from "./catalogue-picker"
import { CheckRow } from "./check-row"
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
}) {
  const hrefs = amenityHrefs(basePath)
  const action = useAmenityAction()
  const [pickerOpen, setPickerOpen] = React.useState(false)
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

  const groups = PROGRESS_ORDER.map((progress) => ({
    progress,
    checks: view.active
      .filter((check) => check.progress === progress)
      .sort(byPosition),
  }))

  // One row per question: its findings are decided together.
  const confirmGroups = new Map<string, ToConfirmRow[]>()
  for (const row of toConfirm?.items ?? [])
    confirmGroups.set(row.checkId, [
      ...(confirmGroups.get(row.checkId) ?? []),
      row,
    ])
  const confirmCount = toConfirm?.count ?? 0

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
            value={view.counts[progress]}
            tone={PROGRESS_TONE[progress]}
            icon={PROGRESS_ICON[progress]}
            href={`#amenities-${progress}`}
          />
        ))}
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
