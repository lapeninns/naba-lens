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
import { Checkbox } from "@/components/ui/checkbox"
import { FormField } from "@/components/ui/field"
import { Input } from "@/components/ui/input"

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
  /**
   * Items of the current menu this draft drops (spec §8 A3 "proposed
   * retirements"). When there are any, the admin must tick that they retire
   * them before activating (AC28).
   */
  retirements?: string[]
  /** Offer "Schedule for later" (spec §4.3 scheduled activation). */
  allowSchedule?: boolean
  onConfirm: (choice: ActivationChoice) => Promise<MenuActionResult>
}

/** What the admin confirmed: retirements counted, now or at `at`. */
export type ActivationChoice = { retirements: number; at: string | null }

/** Up to this many retiring names are listed; the rest are counted. */
const RETIREMENTS_LISTED = 8

/** A `datetime-local` value as an ISO instant in the browser's zone. */
export function scheduleInstant(local: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local)) return null
  const at = new Date(local)
  return Number.isFinite(at.getTime()) ? at.toISOString() : null
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
  retirements = [],
  allowSchedule = false,
  onConfirm,
  ...counts
}: ActivateMenuDialogProps) {
  const [pending, setPending] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [retireConfirmed, setRetireConfirmed] = React.useState(false)
  const [later, setLater] = React.useState(false)
  const [when, setWhen] = React.useState("")
  const sessionEnded = useSessionEndedCatch()
  const reasonsId = React.useId()
  const retireId = React.useId()
  const laterId = React.useId()
  const blockers = activationBlockers(counts)
  const at = later ? scheduleInstant(when) : null
  const blocked =
    blockers.length > 0 ||
    (retirements.length > 0 && !retireConfirmed) ||
    (later && !at)

  async function confirm() {
    if (blocked) return
    setPending(true)
    setError(null)
    try {
      const result = await onConfirm({ retirements: retirements.length, at })
      if (!result.ok) {
        setError(result.error)
        return
      }
      onOpenChange(false)
    } catch (cause) {
      setError(
        sessionEnded(cause) ?? "The menu could not be activated. Try again."
      )
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
        if (!next) {
          setError(null)
          setRetireConfirmed(false)
          setLater(false)
          setWhen("")
        }
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
        <p className="text-body text-ink-muted">
          {currentActiveTitle && venueName
            ? coverageAfterActivationCopy(venueName)
            : "Nothing carries over automatically."}
        </p>
        <p className="text-body text-ink-muted">{ACTIVE_MEANING_COPY}</p>
        {retirements.length > 0 ? (
          <div className="grid gap-2">
            <p className="text-body text-ink">
              {plural(retirements.length, "item")} on the current menu{" "}
              {retirements.length === 1 ? "is" : "are"} not in this draft:{" "}
              <span className="break-words">
                {retirements.slice(0, RETIREMENTS_LISTED).join(", ")}
                {retirements.length > RETIREMENTS_LISTED
                  ? ` and ${retirements.length - RETIREMENTS_LISTED} more`
                  : ""}
              </span>
              .
            </p>
            <label
              htmlFor={retireId}
              className="flex items-start gap-3 text-body text-ink"
            >
              <Checkbox
                id={retireId}
                checked={retireConfirmed}
                onCheckedChange={(checked) => setRetireConfirmed(checked)}
                disabled={pending}
              />
              <span>
                Retire {retirements.length === 1 ? "it" : "them"} from current
                coverage. Photos and history are kept.
              </span>
            </label>
          </div>
        ) : null}
        {allowSchedule ? (
          <div className="grid gap-2">
            <label
              htmlFor={laterId}
              className="flex items-start gap-3 text-body text-ink"
            >
              <Checkbox
                id={laterId}
                checked={later}
                onCheckedChange={(checked) => setLater(checked)}
                disabled={pending}
              />
              <span>
                Schedule for later. Until then the current menu stays as it is.
              </span>
            </label>
            {later ? (
              <FormField
                label="Activate at"
                description="Your local time. Saving the draft again cancels the schedule."
              >
                <Input
                  type="datetime-local"
                  value={when}
                  onChange={(event) => setWhen(event.target.value)}
                  disabled={pending}
                />
              </FormField>
            ) : null}
          </div>
        ) : null}
        {blockers.length > 0 ? (
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
          <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
          <Button
            variant="primary"
            onClick={confirm}
            disabled={blocked || pending}
            aria-busy={pending || undefined}
            aria-describedby={blockers.length > 0 ? reasonsId : undefined}
          >
            {later
              ? pending
                ? "Scheduling…"
                : "Schedule activation"
              : pending
                ? "Activating…"
                : "Activate for labelling"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
