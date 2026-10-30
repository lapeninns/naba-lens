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

import { LABELS_KEPT_COPY, type MenuActionResult } from "./copy"

type ConfirmMenuActionDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: React.ReactNode
  description: React.ReactNode
  confirmLabel: string
  pendingLabel: string
  cancelLabel?: string
  destructive?: boolean
  /** Shown if `onConfirm` throws. */
  fallbackError?: string
  onConfirm: () => Promise<MenuActionResult>
}

/** Pending/error-aware confirmation used by retire, discard and archive. */
export function ConfirmMenuActionDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  pendingLabel,
  cancelLabel = "Cancel",
  destructive = false,
  fallbackError = "That did not work. Try again.",
  onConfirm,
}: ConfirmMenuActionDialogProps) {
  const [pending, setPending] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  async function confirm() {
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
      setError(fallbackError)
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
          <AlertDialogTitle className="break-words">{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        {error ? (
          <p role="alert" className="text-sm text-negative">
            {error}
          </p>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel size="touch" disabled={pending}>
            {cancelLabel}
          </AlertDialogCancel>
          <Button
            variant={destructive ? "destructive" : "default"}
            size="touch"
            onClick={confirm}
            disabled={pending}
            aria-busy={pending || undefined}
          >
            {pending ? pendingLabel : confirmLabel}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

type VersionDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  versionTitle: string
  onConfirm: () => Promise<MenuActionResult>
}

/** active → retired ("archive menu"). */
export function RetireMenuDialog({
  versionTitle,
  ...props
}: VersionDialogProps) {
  return (
    <ConfirmMenuActionDialog
      {...props}
      title={<>Retire “{versionTitle}”?</>}
      description={`Staff will have no menu items to label with at this venue until another version is activated; they can still add content types and notes. ${LABELS_KEPT_COPY}`}
      confirmLabel="Retire menu"
      pendingLabel="Retiring…"
      cancelLabel="Keep active"
      destructive
      fallbackError="The menu could not be retired. Try again."
    />
  )
}

/** draft → discarded. */
export function DiscardDraftDialog({
  versionTitle,
  ...props
}: VersionDialogProps) {
  return (
    <ConfirmMenuActionDialog
      {...props}
      title={<>Discard draft “{versionTitle}”?</>}
      description="The draft stays in the history as discarded and can no longer be edited or activated. The active menu and existing labels do not change."
      confirmLabel="Discard draft"
      pendingLabel="Discarding…"
      cancelLabel="Keep draft"
      destructive
      fallbackError="The draft could not be discarded. Try again."
    />
  )
}
