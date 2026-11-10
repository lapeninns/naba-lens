"use client"

import * as React from "react"
import {
  SpinnerGapIcon,
  TrashIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react"

import { useSessionEndedCatch } from "@/components/nabalens/session-guard-host"
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

import type { DeleteWarning } from "./delete-impact/copy"
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
  /** Accepted for menu use for these dishes ("Momo (Veg)"); owner only. */
  | { kind: "menu"; dishes: string[] }

/** The neutral body for the owner when the impact is unknown. */
export const DELETE_CONFIRM_COPY = `It's removed from your profile and from Photos. ${RETENTION_NOTE}`

function firstName(name: string) {
  return name.trim().split(/\s+/)[0] || name
}

/** "Soup", "Soup and Pie", "Soup, Pie and Momo" */
function joinNames(names: string[]) {
  return names.length > 1
    ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`
    : (names[0] ?? "")
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
    case "menu": {
      const one = impact.dishes.length === 1
      return `${removed} It's the accepted menu photo for ${joinNames(impact.dishes)}, so ${one ? "that dish" : "those dishes"} may need a new photo. ${RETENTION_NOTE}`
    }
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
  /**
   * What deleting does to venue answers (HM-04), for the owner's own photo:
   * "checking" while it is read, which holds Delete until the warning and
   * its button label are known. Omitted: today's dialog.
   */
  evidence?: "checking" | DeleteWarning
  onConfirm: () => Promise<ActionResult | void> | ActionResult | void
}

export function ConfirmDeleteDialog({
  open,
  onOpenChange,
  mediaType = "image",
  ownerName,
  impact,
  evidence,
  onConfirm,
}: ConfirmDeleteDialogProps) {
  const [pending, setPending] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const sessionEnded = useSessionEndedCatch()
  const noun = mediaType === "video" ? "video" : "photo"
  const checking = evidence === "checking"
  const warning = evidence === "checking" ? undefined : evidence
  const busy = pending || checking

  async function confirm() {
    if (busy) return
    setPending(true)
    setError(null)
    try {
      const result = await onConfirm()
      if (result && !result.ok) {
        setError(result.error)
        return
      }
      onOpenChange(false)
    } catch (cause) {
      setError(
        sessionEnded(cause) ?? `We couldn't delete this ${noun}. Try again.`
      )
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
        {evidence !== undefined ? (
          // Mounted while checking, so lines that arrive are announced.
          <div aria-live="polite" className="grid gap-2">
            {warning?.lines.map((line) => (
              <p key={line} className="text-body text-ink">
                {line}
              </p>
            ))}
          </div>
        ) : null}
        {error ? (
          <p
            role="alert"
            className="flex items-start gap-2 text-body font-semibold text-warn-fg"
          >
            <WarningCircleIcon aria-hidden className="mt-0.5 size-5 shrink-0" />
            <span className="min-w-0">{error}</span>
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
            aria-disabled={busy || undefined}
            aria-busy={busy || undefined}
          >
            {busy ? (
              <SpinnerGapIcon
                data-icon="inline-start"
                aria-hidden
                className="motion-safe:animate-spin"
              />
            ) : (
              <TrashIcon data-icon="inline-start" aria-hidden />
            )}
            {pending
              ? "Deleting…"
              : checking
                ? "Checking…"
                : (warning?.confirmLabel ?? "Delete")}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
