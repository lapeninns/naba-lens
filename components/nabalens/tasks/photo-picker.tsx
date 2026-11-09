"use client"

import { CheckIcon, InfoIcon, ProhibitIcon } from "@phosphor-icons/react"

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
        className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6"
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
              : !monthly && photo.completionTarget
                ? "Checklist item only"
                : !monthly && !photo.countsTowardMonthly
                  ? "Task only (from an earlier month)"
                  : null
          return (
            <li key={photo.assetId} className="flex min-w-0 flex-col gap-1.5">
              <div
                className={cn(
                  "relative aspect-square overflow-hidden rounded-control bg-media-placeholder",
                  isSelected && "shadow-[0_0_0_3px_var(--select)]",
                  !eligible && "[&_img]:opacity-70 [&_img]:saturate-[.3]",
                  blocked && eligible && "[&_img]:opacity-55"
                )}
              >
                <EvidenceImage src={photo.thumbnailUrl} className="size-full" />
                {eligible ? (
                  // The tick box (drawn only; the button below carries the state).
                  <span
                    aria-hidden
                    className={cn(
                      "absolute top-2 right-2 grid size-7 place-items-center rounded-[6px] border-2",
                      isSelected
                        ? "border-select bg-select text-on-select"
                        : "border-border-strong bg-surface"
                    )}
                  >
                    {isSelected ? (
                      <CheckIcon weight="bold" className="size-5" />
                    ) : null}
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
                    "absolute inset-0 z-10 rounded-[inherit] outline-none focus-visible:outline-3 focus-visible:-outline-offset-3 focus-visible:outline-focus focus-visible:outline-solid",
                    blocked ? "cursor-not-allowed" : "cursor-pointer"
                  )}
                />
              </div>
              {note ? (
                <p
                  id={noteId}
                  className="flex items-start gap-1.5 text-meta break-words text-ink-muted"
                >
                  {eligible ? (
                    <InfoIcon
                      className="mt-0.5 size-[18px] shrink-0"
                      aria-hidden
                    />
                  ) : (
                    <ProhibitIcon
                      className="mt-0.5 size-[18px] shrink-0"
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
