"use client"

import * as React from "react"
import { SpinnerGapIcon, TrashIcon } from "@phosphor-icons/react"

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"

import type { ActionResult, MediaType } from "./types"

/** Owner-approved disclosure: shown in every variant, before the recall line. */
const RETENTION_NOTE =
  "When backups are enabled, copies are retained indefinitely for recovery. Previously downloaded copies cannot be recalled."

/**
 * What deleting does to the photo's coverage credit. Only pass it when the
 * caller has read it from the server; without it the dialog says nothing
 * about tasks or targets.
 */
export type DeleteImpact =
  /** Counts this month: "Chef's Specials", "November". No task: monthly target only. */
  | { kind: "counts"; taskName?: string | null; monthName: string }
  /** Counted in a closed month: "October 2026". */
  | { kind: "past"; monthName: string }
  | { kind: "none" }

/** The neutral body for the owner when the impact is unknown. */
export const DELETE_CONFIRM_COPY = `It's removed from your profile and from Photos. ${RETENTION_NOTE}`

function firstName(name: string) {
  return name.trim().split(/\s+/)[0] || name
}

function ownBody(impact: DeleteImpact | undefined) {
  const removed = "It's removed from your profile and from Photos."
  switch (impact?.kind) {
    case "counts":
      return impact.taskName
        ? `${removed} It stops counting for ${impact.taskName} and your ${impact.monthName} target, and the task reopens. ${RETENTION_NOTE}`
        : `${removed} It stops counting for your ${impact.monthName} target. ${RETENTION_NOTE}`
    case "past":
      return `${removed} ${impact.monthName} is closed, so your history keeps a note that a photo was removed and the month's result doesn't change. ${RETENTION_NOTE}`
    case "none":
      return `${removed} It isn't counting toward any task. ${RETENTION_NOTE}`
    default:
      return DELETE_CONFIRM_COPY
  }
}

function adminBody(ownerName: string, impact: DeleteImpact | undefined) {
  const owner = firstName(ownerName)
  const removed = `Remove this file from ${owner}'s profile, Photos and the library?`
  switch (impact?.kind) {
    case "counts":
      return impact.taskName
        ? `${removed} It stops counting for ${impact.taskName} and ${owner}'s ${impact.monthName} target. ${RETENTION_NOTE}`
        : `${removed} It stops counting for ${owner}'s ${impact.monthName} target. ${RETENTION_NOTE}`
    case "past":
      return `${removed} ${impact.monthName} is closed, so ${owner}'s history keeps a note that a photo was removed and the month's result doesn't change. ${RETENTION_NOTE}`
    default:
      return `${removed} ${RETENTION_NOTE}`
  }
}

type ConfirmDeleteDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Not shown: original file names stay out of the confirm. */
  fileName?: string
  mediaType?: MediaType
  /**
   * Set when an admin removes someone else's file: the copy names that
   * person and the safe default reads "Keep file".
   */
  ownerName?: string
  impact?: DeleteImpact
  onConfirm: () => Promise<ActionResult | void> | ActionResult | void
}

export function ConfirmDeleteDialog({
  open,
  onOpenChange,
  mediaType = "image",
  ownerName,
  impact,
  onConfirm,
}: ConfirmDeleteDialogProps) {
  const [pending, setPending] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const noun = mediaType === "video" ? "video" : "photo"

  async function confirm() {
    if (pending) return
    setPending(true)
    setError(null)
    try {
      const result = await onConfirm()
      if (result && !result.ok) {
        setError(result.error)
        return
      }
      onOpenChange(false)
    } catch {
      setError(`We couldn't delete this ${noun}. Try again.`)
    } finally {
      setPending(false)
    }
  }

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (pending) return
        if (!next) setError(null)
        onOpenChange(next)
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete this {noun}?</AlertDialogTitle>
          <AlertDialogDescription className="text-ink">
            {ownerName === undefined
              ? ownBody(impact)
              : adminBody(ownerName, impact)}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error ? (
          <p
            role="alert"
            className="text-body-touch text-negative md:text-body-sm"
          >
            {error}
          </p>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel
            variant="secondary"
            size="touch"
            disabled={pending}
          >
            {ownerName === undefined ? `Keep ${noun}` : "Keep file"}
          </AlertDialogCancel>
          <Button
            variant="danger"
            size="touch"
            onClick={confirm}
            aria-disabled={pending || undefined}
            aria-busy={pending || undefined}
          >
            {pending ? (
              <SpinnerGapIcon
                data-icon="inline-start"
                aria-hidden
                className="motion-safe:animate-spin"
              />
            ) : (
              <TrashIcon data-icon="inline-start" aria-hidden />
            )}
            {pending ? "Deleting…" : "Delete"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
