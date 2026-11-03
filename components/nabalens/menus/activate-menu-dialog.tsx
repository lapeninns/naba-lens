"use client"

import * as React from "react"

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

import { Notice } from "../notice"
import {
  ACTIVE_MEANING_COPY,
  LABELS_KEPT_COPY,
  plural,
  possessive,
  type MenuActionResult,
} from "./copy"

type ActivateMenuDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  versionTitle: string
  /** Title of the venue's current active version, if any (it will retire). */
  currentActiveTitle?: string | null
  /** Uncertain matches still without a decision. */
  unresolvedCount: number
  /** Validation errors (warnings do not block). */
  errorCount: number
  itemCount: number
  /** Unsaved editor changes also block activation. */
  hasUnsavedChanges?: boolean
  /** Names the venue in the consequences ("The Railway's active menu"). */
  venueName?: string
  onConfirm: () => Promise<MenuActionResult>
}

/** Why activation is blocked, in the order an admin should fix them. */
export function activationBlockers({
  unresolvedCount,
  errorCount,
  itemCount,
  hasUnsavedChanges = false,
}: Pick<
  ActivateMenuDialogProps,
  "unresolvedCount" | "errorCount" | "itemCount" | "hasUnsavedChanges"
>): string[] {
  const reasons: string[] = []
  if (hasUnsavedChanges) reasons.push("Save the draft first.")
  if (unresolvedCount > 0)
    reasons.push(
      `Resolve ${plural(unresolvedCount, "uncertain match", "uncertain matches")} first.`
    )
  if (errorCount > 0)
    reasons.push(`Fix ${plural(errorCount, "validation error")} first.`)
  if (itemCount === 0) reasons.push("Add at least one item first.")
  return reasons
}

/** The coverage consequence of a menu change (spec: nothing carries over). */
export function coverageAfterActivationCopy(venueName: string): string {
  return `Nothing carries over automatically. ${possessive(venueName)} coverage shows "Menu changed — review coverage" until its manager decides what still applies.`
}

export function ActivateMenuDialog({
  open,
  onOpenChange,
  versionTitle,
  currentActiveTitle,
  venueName,
  onConfirm,
  ...counts
}: ActivateMenuDialogProps) {
  const [pending, setPending] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const reasonsId = React.useId()
  const blockers = activationBlockers(counts)
  const blocked = blockers.length > 0

  async function confirm() {
    if (blocked) return
    setPending(true)
    setError(null)
    try {
      const result = await onConfirm()
      if (!result.ok) {
        setError(result.error)
        return
      }
      onOpenChange(false)
    } catch {
      setError("The menu could not be activated. Try again.")
    } finally {
      setPending(false)
    }
  }

  const venue = venueName ? possessive(venueName) : "the venue's"

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
          <AlertDialogTitle>
            Activate this draft for labelling?
          </AlertDialogTitle>
          <AlertDialogDescription>
            <span className="break-words">{versionTitle}</span> becomes {venue}{" "}
            active menu for labelling.{" "}
            {currentActiveTitle ? (
              <>
                <span className="break-words">{currentActiveTitle}</span> is
                retired; labels on it are kept.
              </>
            ) : (
              <>It is the venue&apos;s first active menu. {LABELS_KEPT_COPY}</>
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <p className="text-body-touch text-ink-muted md:text-body">
          {currentActiveTitle && venueName
            ? coverageAfterActivationCopy(venueName)
            : "Nothing carries over automatically."}
        </p>
        <p className="text-body-touch text-ink-muted md:text-body-sm">
          {ACTIVE_MEANING_COPY}
        </p>
        {blocked ? (
          <Notice id={reasonsId} tone="attention" title="Activation is blocked">
            <ul className="mt-1 grid list-disc gap-0.5 pl-5">
              {blockers.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
          </Notice>
        ) : null}
        {error ? <Notice tone="negative">{error}</Notice> : null}
        <AlertDialogFooter>
          <AlertDialogCancel size="touch" disabled={pending}>
            Cancel
          </AlertDialogCancel>
          <Button
            size="touch"
            onClick={confirm}
            disabled={blocked || pending}
            aria-busy={pending || undefined}
            aria-describedby={blocked ? reasonsId : undefined}
          >
            {pending ? "Activating…" : "Activate for labelling"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
