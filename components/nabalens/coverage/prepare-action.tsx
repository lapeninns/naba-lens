"use client"

import { ArrowClockwiseIcon, CalendarCheckIcon } from "@phosphor-icons/react"

import { Button } from "@/components/ui/button"

import { CoverageNotice } from "./coverage-notice"
import {
  preparationSummary,
  type PrepareMonthHandler,
} from "./prepare-month-button"
import { useCoverageAction } from "./use-coverage-action"

/**
 * "Prepare this month" as the overview's one action, or "Try again" inside a
 * failed-preparation notice. Runs the same idempotent step as the hourly
 * schedule; the outcome is announced beside the button.
 */
export function PrepareAction({
  onPrepare,
  onStale,
  retry = false,
}: {
  onPrepare: PrepareMonthHandler
  onStale?: () => void
  /** Secondary "Try again" for the failed-preparation notice. */
  retry?: boolean
}) {
  const action = useCoverageAction(onStale)

  async function prepare() {
    const result = await action.run(onPrepare, (r) =>
      preparationSummary(r.runs)
    )
    if (result.ok && result.runs.some((r) => r.status === "failed")) {
      action.setNotice({ tone: "error", text: preparationSummary(result.runs) })
    }
  }

  const Icon = retry ? ArrowClockwiseIcon : CalendarCheckIcon
  return (
    <div className="grid gap-2">
      <Button
        variant={retry ? "secondary" : "primary"}
        size={retry ? "sm" : "touch"}
        onClick={() => void prepare()}
        disabled={action.pending}
        aria-busy={action.pending || undefined}
      >
        <Icon data-icon="inline-start" aria-hidden />
        {action.pending
          ? "Preparing…"
          : retry
            ? "Try again"
            : "Prepare this month"}
      </Button>
      <CoverageNotice notice={action.notice} onDismiss={action.dismiss} />
    </div>
  )
}
