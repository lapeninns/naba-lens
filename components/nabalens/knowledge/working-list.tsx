"use client"

import * as React from "react"
import Link from "next/link"
import { CaretRightIcon } from "@phosphor-icons/react/dist/ssr"

import { buttonVariants } from "@/components/ui/button"
import { staffCaptureHref } from "@/lib/amenities/contract"
import type { WorkingList, WorkingSlot } from "@/lib/knowledge-client/contract"
import { cn } from "@/lib/utils"

import { CountBadge, StatusChip } from "../status-chip"
import { slotRow, type SlotRow } from "./copy"

export const WORKING_LIST_HEADING_ID = "working-list-heading"

/** §4.1 order: needs me, closed assignments, drafts, open, answered. */
function rank(slot: WorkingSlot, row: SlotRow): number {
  if (slot.myLatest?.state === "needs_attention") return 0
  if (row.needsMe) return slot.progress === "needs_recheck" ? 1 : 2
  if (row.dismissable) return 3
  if (slot.myDraft) return 4
  if (slot.answerInUse.status !== "available") return 5
  return 6
}

/**
 * Home's "Amenity checks" on a working-list venue (B01-06, design §4.1): one
 * card per question saying where it stands for this person, the whole card a
 * link named by its action and question. A closed assignment says who
 * answered and can be dismissed. Only rows that need the person count in the
 * badge: open questions, drafts and proposals are optional.
 */
export function WorkingListSection({
  list,
  onDismiss,
  inTodo = 0,
}: {
  list: WorkingList
  /** S13: hides a closed-assignment row for this person. Best effort. */
  onDismiss?: (input: { eventId: number }) => Promise<unknown>
  /** Questions left out of this list because they are in To do. */
  inTodo?: number
}) {
  const [dismissed, setDismissed] = React.useState<ReadonlySet<number>>(
    () => new Set()
  )
  const rows = list.slots
    .filter(
      (slot) =>
        !slot.closedAssignment || !dismissed.has(slot.closedAssignment.eventId)
    )
    .map((slot) => ({ slot, row: slotRow(slot) }))
    .sort((a, b) => rank(a.slot, a.row) - rank(b.slot, b.row))
  if (rows.length === 0) return null
  const needsMe = rows.filter(({ row }) => row.needsMe).length

  function dismiss(eventId: number) {
    // The button goes with its row: hand focus to the heading first.
    document.getElementById(WORKING_LIST_HEADING_ID)?.focus()
    setDismissed((current) => new Set(current).add(eventId))
    // The row also leaves on its own after 14 days, so a failure is quiet.
    void onDismiss?.({ eventId }).catch(() => {})
  }

  return (
    <section
      aria-labelledby={WORKING_LIST_HEADING_ID}
      className="grid scroll-mt-4 gap-(--gutter)"
    >
      <div className="grid gap-1 px-1 pt-2">
        <h2
          id={WORKING_LIST_HEADING_ID}
          tabIndex={-1}
          // As To do: Chrome names an inline-grid badge with a stray space.
          aria-label={
            needsMe > 0 ? `Amenity checks, ${needsMe} to do` : "Amenity checks"
          }
          className="flex items-center gap-2 rounded-control font-display text-section-title [overflow-wrap:anywhere] text-ink outline-none focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-focus focus-visible:outline-solid"
        >
          Amenity checks
          <CountBadge count={needsMe} label="to do" />
        </h2>
        <p className="max-w-(--size-reading) text-body text-ink-muted">
          Questions about {list.venue.name}. Anyone working here can help answer
          them.
          {inTodo > 0
            ? ` ${inTodo} more ${inTodo === 1 ? "is" : "are"} in To do.`
            : null}
        </p>
      </div>
      <ul aria-label="Amenity checks" className="grid gap-(--gutter)">
        {rows.map(({ slot, row }) => (
          <li
            key={slot.checkId}
            className={cn(
              "relative grid min-h-16 min-w-0 gap-2 rounded-card bg-surface p-4 shadow-card",
              row.action &&
                "transition-colors duration-(--duration-quick) hover:bg-surface-2 has-[a:focus-visible]:outline-3 has-[a:focus-visible]:outline-offset-2 has-[a:focus-visible]:outline-focus has-[a:focus-visible]:outline-solid",
              row.needsMe &&
                "shadow-[var(--elevation-card),inset_4px_0_0_var(--warn-fg)]"
            )}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="min-w-0 text-meta font-semibold [overflow-wrap:anywhere] text-ink-muted">
                {slot.category}
              </span>
              {"state" in row.chip ? (
                <StatusChip state={row.chip.state} />
              ) : (
                <StatusChip tone={row.chip.tone}>{row.chip.word}</StatusChip>
              )}
            </div>
            <h3 className="text-item-title [overflow-wrap:anywhere] text-ink">
              {row.action ? (
                // The whole card is the link; its name leads with the action.
                <Link
                  href={staffCaptureHref(slot.checkId)}
                  aria-label={`${row.action}: ${slot.question}`}
                  className="outline-none after:absolute after:inset-0 after:rounded-card"
                >
                  {slot.question}
                </Link>
              ) : (
                slot.question
              )}
            </h3>
            <p className="text-body [overflow-wrap:anywhere] text-ink">
              {row.status}
            </p>
            {row.action ? (
              <div
                aria-hidden
                className="flex items-center justify-end gap-1 text-label font-semibold text-ink"
              >
                {row.action}
                <CaretRightIcon className="size-5 shrink-0 text-ink-muted" />
              </div>
            ) : null}
            {row.dismissable && slot.closedAssignment ? (
              <button
                type="button"
                onClick={() => dismiss(slot.closedAssignment!.eventId)}
                aria-label={`Dismiss: ${slot.question}`}
                className={buttonVariants({
                  variant: "quiet",
                  size: "touch",
                  className: "relative z-10 justify-self-start",
                })}
              >
                Dismiss
              </button>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  )
}
