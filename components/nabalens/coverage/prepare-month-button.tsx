"use client"

import * as React from "react"
import { CalendarCheckIcon } from "@phosphor-icons/react"

import { Button } from "@/components/ui/button"

import { CoverageNotice } from "./coverage-notice"
import { plural } from "./copy"
import type { CoverageResult, PreparationRunView } from "./types"
import { useCoverageAction } from "./use-coverage-action"

export type PrepareMonthHandler = () => Promise<
  CoverageResult<{ runs: PreparationRunView[] }>
>

export function preparationSummary(runs: PreparationRunView[]): string {
  const failed = runs.filter((r) => r.status === "failed")
  const copied = runs.reduce((n, r) => n + r.targetsCopied, 0)
  const placeholders = runs.reduce((n, r) => n + r.placeholdersCreated, 0)
  const present = runs.reduce((n, r) => n + r.alreadyPresent, 0)
  const parts = [
    `${plural(copied, "target")} copied from last month`,
    `${plural(placeholders, "person", "people")} need a target set`,
    `${present} already set up`,
  ]
  if (failed.length > 0) {
    return `Preparation failed for ${plural(failed.length, "run")} (code ${failed
      .map((r) => r.errorCode ?? "unknown")
      .join(", ")}). Nothing was half-done; try again. ${parts.join(", ")}.`
  }
  return `This month is prepared: ${parts.join(", ")}.`
}

/**
 * "Prepare this month": the same idempotent step the hourly schedule runs.
 * Copies each person's last target at this venue and flags missing setup;
 * running it again never duplicates anything.
 */
export function PrepareMonthButton({
  label = "Prepare this month",
  onPrepare,
  onStale,
}: {
  label?: string
  onPrepare: PrepareMonthHandler
  onStale?: () => void
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

  return (
    <div className="grid gap-2">
      <div>
        <Button
          variant="outline"
          size="touch"
          onClick={() => void prepare()}
          disabled={action.pending}
          aria-busy={action.pending || undefined}
        >
          <CalendarCheckIcon data-icon="inline-start" aria-hidden />
          {action.pending ? "Preparing…" : label}
        </Button>
      </div>
      <CoverageNotice notice={action.notice} onDismiss={action.dismiss} />
    </div>
  )
}
