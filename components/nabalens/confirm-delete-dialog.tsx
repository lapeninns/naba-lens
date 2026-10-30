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

import type { ActionResult } from "./types"

/** Spec section7 removal copy plus the owner-approved indefinite backup disclosure. */
export const DELETE_CONFIRM_COPY =
  "Remove this file from your portfolio and the admin library? When backups are enabled, copies are retained indefinitely for recovery. Previously downloaded copies cannot be recalled."

type ConfirmDeleteDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Name of the file being removed, shown for context. */
  fileName?: string
  onConfirm: () => Promise<ActionResult | void> | ActionResult | void
}

export function ConfirmDeleteDialog({
  open,
  onOpenChange,
  fileName,
  onConfirm,
}: ConfirmDeleteDialogProps) {
  const [pending, setPending] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  async function confirm() {
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
      setError("The file could not be removed. Try again.")
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
            Delete{" "}
            {fileName ? (
              <span className="break-all">{fileName}</span>
            ) : (
              "this file"
            )}
            ?
          </AlertDialogTitle>
          <AlertDialogDescription>{DELETE_CONFIRM_COPY}</AlertDialogDescription>
        </AlertDialogHeader>
        {error ? (
          <p role="alert" className="text-sm text-negative">
            {error}
          </p>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel size="touch" disabled={pending}>
            Keep file
          </AlertDialogCancel>
          <Button
            variant="destructive"
            size="touch"
            onClick={confirm}
            disabled={pending}
            aria-busy={pending}
          >
            {pending ? "Deleting…" : "Delete"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
