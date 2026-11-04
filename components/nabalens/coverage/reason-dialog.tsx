"use client"

import * as React from "react"
import { SpinnerGapIcon, WarningCircleIcon } from "@phosphor-icons/react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

import { COVERAGE_LIMITS } from "./copy"
import type { Reported } from "./use-coverage-action"

export const textareaClass =
  "block min-h-24 w-full min-w-0 resize-y rounded-control border border-line-control bg-panel px-3 py-2 text-body-touch text-ink outline-none placeholder:text-ink-subtle focus-visible:border-focus focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-1 focus-visible:outline-focus disabled:cursor-not-allowed disabled:bg-well disabled:text-ink-muted aria-invalid:border-negative md:text-body"

/**
 * Dialog `finalFocus` that sends focus to `reportFocus` after a `REPORTED`
 * close. Base UI would focus the first tabbable element inside it (a notice's
 * Dismiss button), so the target is focused directly instead.
 */
export function useReportedFocus(reportFocus?: () => HTMLElement | null) {
  const reportedRef = React.useRef(false)
  function finalFocus() {
    const target = reportedRef.current ? reportFocus?.() : null
    reportedRef.current = false
    if (!target) return true
    queueMicrotask(() => target.focus())
    return false
  }
  return { reportedRef, finalFocus }
}

export type ReasonOutcome =
  { ok: true } | { ok: false; error: string; fieldError?: string } | Reported

/** Required, trimmed reason (1–500 characters) for a recorded decision. */
export function ReasonField({
  id,
  label,
  value,
  onChange,
  error,
  help,
  disabled,
  maxLength = COVERAGE_LIMITS.reasonMax,
  required = true,
}: {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  error?: string | null
  help?: React.ReactNode
  disabled?: boolean
  maxLength?: number
  required?: boolean
}) {
  const describedBy = [
    help && !error ? `${id}-help` : null,
    `${id}-count`,
    error ? `${id}-error` : null,
  ]
    .filter(Boolean)
    .join(" ")
  return (
    <div className="grid gap-1.5">
      <label htmlFor={id} className="text-label-touch text-ink md:text-label">
        {label}
        {required ? null : (
          <span className="font-normal text-ink-muted"> (optional)</span>
        )}
      </label>
      <textarea
        id={id}
        value={value}
        onChange={(e) => onChange(e.currentTarget.value)}
        maxLength={maxLength}
        required={required}
        rows={3}
        disabled={disabled}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={textareaClass}
      />
      <div className="flex items-start gap-3">
        {error ? (
          <p
            id={`${id}-error`}
            role="alert"
            className="flex items-start gap-1.5 text-meta-touch font-semibold text-negative md:text-meta-strong"
          >
            <WarningCircleIcon aria-hidden className="mt-px size-4 shrink-0" />
            {error}
          </p>
        ) : help ? (
          <p
            id={`${id}-help`}
            className="text-meta-touch text-ink-muted md:text-meta"
          >
            {help}
          </p>
        ) : null}
        <p
          id={`${id}-count`}
          className="ms-auto text-meta-touch whitespace-nowrap text-ink-muted tabular-nums md:text-caption"
        >
          {value.length} / {maxLength}
        </p>
      </div>
    </div>
  )
}

/** Dialog that records a decision with a required reason. */
export function ReasonDialog({
  open,
  onOpenChange,
  title,
  description,
  label,
  help,
  confirmLabel,
  pendingLabel,
  destructive,
  emptyError = "Give a reason.",
  note,
  confirmIcon,
  children,
  onConfirm,
  reportFocus,
  reportFocusOnSuccess,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: React.ReactNode
  description?: React.ReactNode
  label: string
  help?: React.ReactNode
  confirmLabel: string
  pendingLabel: string
  destructive?: boolean
  /** Shown when the reason is left empty. */
  emptyError?: string
  /** A rule shown under the reason. */
  note?: React.ReactNode
  confirmIcon?: React.ReactNode
  /** Extra content shown above the reason (e.g. the photo). */
  children?: React.ReactNode
  onConfirm: (reason: string) => Promise<ReasonOutcome>
  /** Takes focus after a `REPORTED` close; the dialog's trigger may have gone. */
  reportFocus?: () => HTMLElement | null
  /** Also focus `reportFocus` after a success, when the decision removes the trigger. */
  reportFocusOnSuccess?: boolean
}) {
  const id = React.useId()
  const { reportedRef, finalFocus } = useReportedFocus(reportFocus)
  const [reason, setReason] = React.useState("")
  const [pending, setPending] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [fieldError, setFieldError] = React.useState<string | null>(null)

  function close(next: boolean) {
    if (pending) return
    if (!next) {
      setReason("")
      setError(null)
      setFieldError(null)
    }
    onOpenChange(next)
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    const trimmed = reason.trim()
    if (!trimmed) {
      setFieldError(emptyError)
      return
    }
    setPending(true)
    setError(null)
    setFieldError(null)
    try {
      const outcome = await onConfirm(trimmed)
      if (!outcome.ok && !("reported" in outcome)) {
        setError(outcome.error)
        setFieldError(outcome.fieldError ?? null)
        return
      }
      reportedRef.current = !outcome.ok || reportFocusOnSuccess === true
      setReason("")
      onOpenChange(false)
    } catch {
      setError(
        "Could not reach the server. Check your connection and try again."
      )
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent finalFocus={finalFocus}>
        <form onSubmit={submit} className="grid gap-4" noValidate>
          <DialogHeader>
            <DialogTitle className="break-words">{title}</DialogTitle>
            {description ? (
              <DialogDescription>{description}</DialogDescription>
            ) : null}
          </DialogHeader>
          {children}
          <ReasonField
            id={`${id}-reason`}
            label={label}
            help={help}
            value={reason}
            onChange={setReason}
            error={fieldError}
            disabled={pending}
          />
          {note ? (
            <p className="text-body-touch text-ink-muted md:text-body-sm">
              {note}
            </p>
          ) : null}
          {error ? (
            <p
              role="alert"
              className="text-body-touch text-negative md:text-body-sm"
            >
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <Button
              type="button"
              variant="secondary"
              size="touch"
              onClick={() => close(false)}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              size="touch"
              variant={destructive ? "destructive" : "primary"}
              disabled={pending}
              aria-busy={pending || undefined}
            >
              {pending && confirmIcon ? (
                <SpinnerGapIcon aria-hidden className="animate-spin" />
              ) : (
                confirmIcon
              )}
              {pending ? pendingLabel : confirmLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
