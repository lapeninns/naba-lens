"use client"

import * as React from "react"

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

import { Notice } from "../notice"
import {
  LABELS_KEPT_COPY,
  plural,
  possessive,
  type MenuActionResult,
} from "./copy"

type ConfirmMenuActionDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: React.ReactNode
  description: React.ReactNode
  /** A second paragraph under the description, e.g. what it changes for coverage. */
  detail?: React.ReactNode
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
  detail,
  confirmLabel,
  pendingLabel,
  cancelLabel = "Cancel",
  destructive = false,
  fallbackError = "That did not work. Try again.",
  onConfirm,
}: ConfirmMenuActionDialogProps) {
  const [pending, setPending] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const sessionEnded = useSessionEndedCatch()

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
    } catch (cause) {
      setError(sessionEnded(cause) ?? fallbackError)
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
        {detail ? (
          <p className="text-body-touch text-ink-muted md:text-body">
            {detail}
          </p>
        ) : null}
        {error ? <Notice tone="negative">{error}</Notice> : null}
        <AlertDialogFooter>
          <AlertDialogCancel size="touch" disabled={pending}>
            {cancelLabel}
          </AlertDialogCancel>
          <Button
            variant={destructive ? "danger" : "primary"}
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
  /** Names the venue in the title and consequences. */
  venueName?: string
  onConfirm: () => Promise<MenuActionResult>
}

/** active → retired ("archive menu"). */
export function RetireMenuDialog({
  versionTitle,
  venueName,
  ...props
}: VersionDialogProps) {
  return (
    <ConfirmMenuActionDialog
      {...props}
      title={
        venueName ? (
          `Retire ${possessive(venueName)} active menu?`
        ) : (
          <>Retire “{versionTitle}”?</>
        )
      }
      description={`Staff can't choose items from this menu for new labels until another version is active. ${LABELS_KEPT_COPY}`}
      detail={
        venueName
          ? `Nothing carries over automatically, and ${possessive(venueName)} menu coverage shows No active menu.`
          : "Nothing carries over automatically."
      }
      confirmLabel="Retire"
      pendingLabel="Retiring…"
      destructive
      fallbackError="The menu could not be retired. Try again."
    />
  )
}

/** draft → discarded. */
export function DiscardDraftDialog({
  versionTitle,
  venueName,
  activeTitle,
  decisionCount = 0,
  imported = false,
  ...props
}: VersionDialogProps & {
  /** The venue's active version, which stays active. */
  activeTitle?: string | null
  /** Decisions made in this draft that are set aside with it. */
  decisionCount?: number
  /** The draft came from a file (the file stays in the import history). */
  imported?: boolean
}) {
  void venueName
  const what =
    decisionCount > 0
      ? `${versionTitle} and your ${plural(decisionCount, "decision")} are`
      : `${versionTitle} is`
  return (
    <ConfirmMenuActionDialog
      {...props}
      title="Discard this draft?"
      description={[
        `${what} set aside as Discarded.`,
        activeTitle ? `${activeTitle} stays active.` : null,
        imported ? "The imported file stays in the import history." : null,
      ]
        .filter(Boolean)
        .join(" ")}
      confirmLabel="Discard"
      pendingLabel="Discarding…"
      cancelLabel="Keep draft"
      destructive
      fallbackError="The draft could not be discarded. Try again."
    />
  )
}
