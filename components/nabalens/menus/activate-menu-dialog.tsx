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

import {
  ACTIVE_MEANING_COPY,
  LABELS_KEPT_COPY,
  plural,
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

export function ActivateMenuDialog({
  open,
  onOpenChange,
  versionTitle,
  currentActiveTitle,
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
            Activate <span className="break-words">“{versionTitle}”</span>?
          </AlertDialogTitle>
          <AlertDialogDescription>{ACTIVE_MEANING_COPY}</AlertDialogDescription>
        </AlertDialogHeader>
        <ul className="grid list-disc gap-1 pl-5 text-sm">
          <li>
            Staff can label this venue&apos;s photos and videos with its items.
          </li>
          <li>
            {currentActiveTitle ? (
              <>
                The current active menu, “{currentActiveTitle}”, becomes
                retired.
              </>
            ) : (
              "This venue has no active menu now; this becomes its first."
            )}
          </li>
          <li>{LABELS_KEPT_COPY}</li>
        </ul>
        {blocked ? (
          <div
            id={reasonsId}
            className="rounded-md border border-warning/40 bg-warning-surface px-3 py-2 text-sm"
          >
            <p className="font-medium">Activation is blocked</p>
            <ul className="mt-1 grid list-disc gap-0.5 pl-5">
              {blockers.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
          </div>
        ) : null}
        {error ? (
          <p role="alert" className="text-sm text-negative">
            {error}
          </p>
        ) : null}
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
