import Link from "next/link"
import { PlusIcon } from "@phosphor-icons/react/dist/ssr"

import { buttonVariants } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"

import { CardHead } from "../common-room"
import { formatDate } from "../format"
import { StatusChip as SystemChip } from "../status-chip"
import { completionBreakdown } from "./copy"
import { EvidenceThumb } from "./evidence-thumb"
import { StatusChip } from "./status-badges"
import { ReviewReason } from "./submission-list"
import type { MonthlyProgress, MonthPhotoView } from "./types"

/**
 * Photo progress drawn by `Progress mode="segments"` (goals plan, decision 6):
 * green accepted, striped waiting, grey still needed; merged into one bar
 * above 12. Decorative: the caller's words carry the numbers. Being retired
 * (DS-205): new code renders `Progress` with its own label.
 */
export function PhotoSegments({
  accepted,
  pending = 0,
  target,
  className,
}: {
  accepted: number
  pending?: number
  target: number
  className?: string
}) {
  const total = Math.max(0, Math.floor(target))
  if (total === 0) return null
  return (
    <div aria-hidden className={className}>
      <Progress
        mode="segments"
        aria-label="Photo progress"
        accepted={accepted}
        submitted={pending}
        total={total}
      />
    </div>
  )
}

/**
 * One person's progress for a month against their target. A missing target or
 * team reads Needs setup, never complete. Monthly numbers stay here and are
 * never added to a venue's checklist progress.
 */
export function MonthCard({
  monthly,
  periodLabel,
  venueName,
  readOnly = false,
  replaceHref = null,
  replaceCount = 0,
  addHref = null,
}: {
  monthly: MonthlyProgress | null
  /** "November 2026", for the heading and a month with no target row. */
  periodLabel: string
  /** Name the venue when a month spans a transfer. */
  venueName?: string | null
  readOnly?: boolean
  /** Lead action while a photo needs replacing this month. */
  replaceHref?: string | null
  replaceCount?: number
  /** Secondary action: where to add photos, or null to hide it. */
  addHref?: string | null
}) {
  const completion = monthly?.completionProgress
  const heading = `${completion ? "Your target for" : "Your photos for"} ${periodLabel}${venueName ? ` at ${venueName}` : ""}`
  const headingId = `month-${monthly?.venue.id ?? "none"}`
  const needsSetup = monthly?.status === "needs_setup"
  const target = monthly?.targetCount ?? 0
  const count = completion?.total ?? monthly?.accepted ?? 0
  const pending = completion ? 0 : (monthly?.pending ?? 0)
  // Decision 13: a photo a reviewer wants redone holds its own frame.
  const redo = completion ? 0 : (monthly?.needsAnotherPhoto ?? 0)
  const toTake = Math.max(0, target - count - pending - redo)
  const unit = completion ? "items completed" : "photos accepted"
  const key = {
    accepted:
      count > 0
        ? `${count} ${completion ? "completed" : "accepted"}`
        : undefined,
    submitted:
      pending > 0
        ? `${pending}${monthly?.complete ? " more" : ""} waiting for review`
        : undefined,
    needsAnother:
      redo > 0
        ? `${redo} ${redo === 1 ? "needs" : "need"} another photo`
        : undefined,
    needed:
      toTake > 0
        ? `${toTake} ${completion ? "to complete" : "to take"}`
        : undefined,
  }

  return (
    <section
      aria-labelledby={headingId}
      className="grid min-w-0 gap-4 rounded-card bg-surface p-4 shadow-card"
    >
      <CardHead>
        <h2
          id={headingId}
          className="type-section-title [overflow-wrap:anywhere] text-ink"
        >
          {heading}
        </h2>
        {needsSetup || readOnly ? (
          <span className="flex flex-wrap gap-1.5">
            {needsSetup ? (
              <StatusChip tone="warning">Needs setup</StatusChip>
            ) : null}
            {readOnly ? <StatusChip tone="muted">Read-only</StatusChip> : null}
          </span>
        ) : null}
      </CardHead>

      {monthly && !needsSetup ? (
        <div className="grid gap-3">
          <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <span className="type-count text-ink tabular-nums">{count}</span>
            <span className="type-section-title text-ink-muted">
              of {target} {completion ? "completed" : "accepted"}
            </span>
            {monthly.complete ? (
              <StatusChip tone="positive">Target met</StatusChip>
            ) : null}
          </p>
          <Progress
            mode="segments"
            aria-label={`${count} of ${target} ${unit}`}
            valueText={[
              `${count} of ${target} ${unit}`,
              key.submitted,
              key.needsAnother,
              key.needed,
            ]
              .filter(Boolean)
              .join(", ")}
            accepted={count}
            submitted={pending}
            needsAnother={redo}
            total={target}
            keyLabels={key}
          />
        </div>
      ) : null}

      {completion ? (
        <p className="text-meta text-ink-muted">
          {completionBreakdown(completion)}
        </p>
      ) : null}

      {!monthly ? (
        <p className="text-body text-ink-muted">
          There&apos;s no photo target for you this month.
        </p>
      ) : null}

      {replaceHref && replaceCount > 0 ? (
        <p className="flex flex-wrap items-center gap-2">
          <StatusChip tone="warning">Needs another photo</StatusChip>
          <Link
            href={replaceHref}
            className={buttonVariants({ variant: "link" })}
          >
            {replaceCount === 1
              ? "1 photo to replace"
              : `${replaceCount} photos to replace`}
          </Link>
        </p>
      ) : null}

      {monthly?.due && !readOnly ? (
        <p className="font-mono text-meta text-ink-muted tabular-nums">
          {monthly.due.label}
        </p>
      ) : null}

      {addHref ? (
        <div className="border-t border-line pt-3">
          <Link
            href={addHref}
            className={buttonVariants({
              variant: "secondary",
              className: "w-full sm:w-auto",
            })}
          >
            <PlusIcon data-icon="inline-start" aria-hidden />
            Add photos for this month
          </Link>
        </div>
      ) : null}
    </section>
  )
}

/** The state word of one photo in the month (decision 13). */
function MonthPhotoChip({ state }: { state: MonthPhotoView["state"] }) {
  if (state === "waiting")
    return <SystemChip state="submitted">Waiting for review</SystemChip>
  return <SystemChip state={state} />
}

/** What the photo is of: the dishes it was labelled with, or what it was sent to. */
export function monthPhotoTitle(photo: MonthPhotoView): string {
  if (photo.itemNames.length > 0) return photo.itemNames.join(", ")
  return photo.sent?.requirementTitle ?? "Monthly photo"
}

/**
 * The person's own photos in a month, one row each, with the same states the
 * month card counts: accepted, needs another photo, waiting for review.
 */
export function MonthPhotoList({
  photos,
  label,
}: {
  photos: MonthPhotoView[]
  /** Accessible name of the list. */
  label: string
}) {
  return (
    <ul
      aria-label={label}
      className="grid divide-y divide-line overflow-hidden rounded-card bg-surface shadow-card"
    >
      {photos.map((photo) => {
        const title = monthPhotoTitle(photo)
        const uploaded = formatDate(photo.uploadedAt)
        const by = photo.decision?.decidedBy.displayName
        return (
          <li
            key={photo.assetId}
            className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-start gap-3 p-3"
          >
            <EvidenceThumb
              thumbnailUrl={photo.asset.thumbnailUrl}
              previewUrl={photo.asset.previewUrl}
              label={`${title}: photo taken ${uploaded}`}
              className="size-16 rounded-control sm:size-20"
            />
            <div className="flex min-w-0 flex-col gap-1">
              <p className="text-item-title [overflow-wrap:anywhere] text-ink">
                {title}
              </p>
              <p className="text-meta text-ink-muted">
                Taken {uploaded}
                {photo.itemNames.length > 0 && photo.sent?.requirementTitle
                  ? ` · Sent to ${photo.sent.requirementTitle}`
                  : ""}
              </p>
              {photo.state === "needs_another_photo" ? (
                <ReviewReason reason={photo.reason} />
              ) : null}
              {photo.decision ? (
                <p className="text-meta text-ink-muted">
                  {photo.state === "accepted" ? "Accepted" : "Reviewed"}
                  {by ? ` by ${by}` : ""} on{" "}
                  {formatDate(photo.decision.decidedAt)}
                </p>
              ) : null}
              <span className="mt-0.5 flex flex-wrap items-center gap-1.5">
                <MonthPhotoChip state={photo.state} />
                {!photo.asset.available ? (
                  <StatusChip tone="negative">Photo removed</StatusChip>
                ) : null}
              </span>
            </div>
          </li>
        )
      })}
    </ul>
  )
}
