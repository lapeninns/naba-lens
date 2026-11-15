"use client"

import Link from "next/link"
import { CaretRightIcon } from "@phosphor-icons/react/dist/ssr"

import type { LabelWork } from "@/lib/knowledge/contract"

import { useAdd, useAddFailed } from "../shell/add-context"
import { OWN_WORK_COPY } from "../tasks/copy"

const ROW =
  "flex min-h-11 w-full items-center gap-3 px-4 py-3 text-left text-body text-ink focus-ring outline-none"

/**
 * Decision 19: the person's own photo work on goal-led Home, as compact rows
 * under the retake note. Photos that need a dish label (or whose label save
 * needs attention) and uploads that didn't finish on this phone. These are
 * the person's own actions, not assignments, and never the one blue action
 * (decision 12). Renders nothing when there is nothing to do.
 */
export function OwnWorkRows({
  labels,
  portfolioPath,
}: {
  /** Null when there is no label work, or it couldn't be read. */
  labels: LabelWork | null
  portfolioPath: string
}) {
  const failed = useAddFailed() ?? 0
  const openAdd = useAdd()
  const labelLines = labels
    ? [
        labels.needsLabels > 0
          ? OWN_WORK_COPY.labels(labels.needsLabels)
          : null,
        labels.needsAttention > 0
          ? OWN_WORK_COPY.labelAttention(labels.needsAttention)
          : null,
      ].filter((line): line is string => line !== null)
    : []
  const showFailed = failed > 0 && openAdd !== null
  if (labelLines.length === 0 && !showFailed) return null
  return (
    <ul className="grid divide-y divide-line overflow-hidden rounded-card bg-surface shadow-card">
      {showFailed ? (
        <li>
          <button type="button" onClick={() => openAdd()} className={ROW}>
            <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">
              {OWN_WORK_COPY.failed(failed)}
            </span>
            <span className="font-bold underline underline-offset-3">
              {OWN_WORK_COPY.failedAction}
            </span>
            <CaretRightIcon aria-hidden weight="bold" className="size-5" />
          </button>
        </li>
      ) : null}
      {labelLines.length > 0 ? (
        <li>
          <Link href={`${portfolioPath}#needs-labels-heading`} className={ROW}>
            <span className="grid min-w-0 flex-1 gap-0.5 [overflow-wrap:anywhere]">
              {labelLines.map((line) => (
                <span key={line}>{line}</span>
              ))}
            </span>
            <span className="font-bold underline underline-offset-3">
              {OWN_WORK_COPY.labelAction}
            </span>
            <CaretRightIcon aria-hidden weight="bold" className="size-5" />
          </Link>
        </li>
      ) : null}
    </ul>
  )
}
