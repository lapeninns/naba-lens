"use client"

import * as React from "react"
import {
  ArrowCounterClockwiseIcon,
  CheckCircleIcon,
  ClockIcon,
  PlusIcon,
  SpinnerGapIcon,
  WarningIcon,
} from "@phosphor-icons/react"

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

import { CataloguePicker, type AddOutcome } from "./catalogue-picker"
import { CheckRow } from "./check-row"
import { useAmenityAction } from "./use-amenity-action"

export type AmenitiesOverviewHandlers = {
  enable: () => Promise<AmenityResult<{ created: number }>>
  addChecks: (keys: string[]) => Promise<AmenityResult<{ checkIds: string[] }>>
  restore: (input: {
    checkId: string
    revision: number
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
}: {
  view: VenueAmenitiesView
  /** Null when the catalogue could not be read (or Amenities are off). */
  catalogue: CatalogueOption[] | null
  basePath: string
  handlers: AmenitiesOverviewHandlers
}) {
  const hrefs = amenityHrefs(basePath)
  const action = useAmenityAction()
  const [pickerOpen, setPickerOpen] = React.useState(false)
  const venue = view.venue.name

  async function enable() {
    await action.run(handlers.enable, (r) =>
      r.created > 0
        ? `Amenities are on for ${venue}: ${plural(r.created, "core check")} added.`
        : `Amenities are on for ${venue}.`
    )
  }

  async function add(keys: string[]): Promise<AddOutcome> {
    const result = await action.run(
      () => handlers.addChecks(keys),
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
    await action.run(
      () => handlers.restore({ checkId: check.id, revision: check.revision }),
      `Restored “${check.entry.question}”.`
    )
  }

  const notice = (
    <CoverageNotice notice={action.notice} onDismiss={action.dismiss} />
  )

  if (!view.enabled) {
    return (
      <div className="grid gap-4">
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

  return (
    <div className="grid gap-6 md:gap-8">
      {notice}
      <Tally>
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
