"use client"

import { CheckCircleIcon, ProhibitIcon } from "@phosphor-icons/react"

import { cn } from "@/lib/utils"

import { formatDateTime, ineligibleCopy } from "./copy"
import { EvidenceImage } from "./evidence-image"
import type { AssetIneligibleReason, SubmittablePhoto } from "./types"

/**
 * Own photos to send, newest first. Ineligible photos stay visible with the
 * reason (still processing, already sent, needs another photo here...) so
 * nothing silently disappears; they cannot be selected.
 */
export function PhotoPicker({
  photos,
  selected,
  onToggle,
  maxSelected,
  flagged,
  monthly,
}: {
  photos: SubmittablePhoto[]
  selected: readonly string[]
  onToggle: (assetId: string) => void
  maxSelected: number
  /** Reasons from the last submit attempt, which override the listing. */
  flagged: ReadonlyMap<string, AssetIneligibleReason>
  /** Monthly-only submission (no task): older photos are ineligible. */
  monthly: boolean
}) {
  const full = selected.length >= maxSelected
  return (
    <div className="flex flex-col gap-2">
      <ul
        aria-label="Your photos"
        className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6"
      >
        {photos.map((photo) => {
          const reason = flagged.get(photo.assetId) ?? photo.reason
          const eligible = photo.eligible && !flagged.has(photo.assetId)
          const isSelected = selected.includes(photo.assetId)
          const blocked = !isSelected && (!eligible || full)
          const noteId = `photo-note-${photo.assetId}`
          // An eligible photo that is live elsewhere is the author's own photo
          // waiting for review on another task: sending it here moves it.
          const sentAsMonthly =
            (reason === "already_submitted" && monthly) ||
            (reason === "counted_elsewhere" &&
              photo.live?.requirementId === null)
          const note = !eligible
            ? sentAsMonthly
              ? "Already sent as a monthly photo."
              : ineligibleCopy(reason)
            : photo.live
              ? "Waiting for review on another task. Sending it here moves it."
              : !monthly && !photo.countsTowardMonthly
                ? "Task only (from an earlier month)"
                : null
          return (
            <li key={photo.assetId} className="flex min-w-0 flex-col gap-1">
              <div
                className={cn(
                  "relative aspect-square overflow-hidden rounded-md ring-offset-2 ring-offset-background",
                  isSelected && "ring-3 ring-primary",
                  !eligible && "opacity-60"
                )}
              >
                <EvidenceImage src={photo.thumbnailUrl} className="size-full" />
                {isSelected ? (
                  <span className="absolute top-1 right-1 rounded-full bg-background text-primary">
                    <CheckCircleIcon
                      weight="fill"
                      className="size-6"
                      aria-hidden
                    />
                  </span>
                ) : null}
                <button
                  type="button"
                  aria-pressed={isSelected}
                  aria-disabled={blocked || undefined}
                  aria-label={`Photo uploaded ${formatDateTime(photo.uploadedAt)}`}
                  aria-describedby={note ? noteId : undefined}
                  onClick={() => {
                    if (!blocked) onToggle(photo.assetId)
                  }}
                  className={cn(
                    "absolute inset-0 z-10 rounded-md outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                    blocked ? "cursor-not-allowed" : "cursor-pointer"
                  )}
                />
              </div>
              {note ? (
                <p
                  id={noteId}
                  className="flex items-start gap-1 text-meta-touch break-words text-ink-muted md:text-meta"
                >
                  {eligible ? null : (
                    <ProhibitIcon
                      className="mt-0.5 size-3.5 shrink-0"
                      aria-hidden
                    />
                  )}
                  {note}
                </p>
              ) : null}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
