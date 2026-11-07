"use client"

import * as React from "react"
import {
  ArrowCounterClockwiseIcon,
  SpinnerGapIcon,
} from "@phosphor-icons/react"

import { ReasonField } from "@/components/nabalens/coverage"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  LIMITS,
  REOPEN_PRESETS,
  REOPEN_PRESET_LABEL,
  UI_TEXT,
  type ReopenPreset,
} from "@/lib/amenities/contract"

export type ReopenOutcome =
  | { ok: true }
  | {
      ok: false
      error: string
      fieldErrors?: Partial<Record<string, string>>
      /** Reported on the page instead (stale or refused): just close. */
      close?: boolean
    }

export const OTHER_REASON_REQUIRED = "Say what needs rechecking."

/**
 * Reopens a complete check for staff to recapture. A preset is required;
 * free text is required for Other and optional otherwise. The current answer
 * stays visible until a new finding replaces it.
 */
export function ReopenDialog({
  open,
  onOpenChange,
  question,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  question: string
  onConfirm: (input: {
    preset: ReopenPreset
    reason?: string
  }) => Promise<ReopenOutcome>
}) {
  const id = React.useId()
  const [preset, setPreset] = React.useState<ReopenPreset | null>(null)
  const [reason, setReason] = React.useState("")
  const [pending, setPending] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = React.useState<
    Partial<Record<string, string>>
  >({})

  function reset() {
    setPreset(null)
    setReason("")
    setError(null)
    setFieldErrors({})
  }

  function close(next: boolean) {
    if (pending) return
    if (!next) reset()
    onOpenChange(next)
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    const trimmed = reason.trim()
    const errors: Partial<Record<string, string>> = {}
    if (!preset) errors.preset = "Choose why it needs a recheck."
    if (preset === "other" && !trimmed) errors.reason = OTHER_REASON_REQUIRED
    if (errors.preset || errors.reason) {
      setFieldErrors(errors)
      return
    }
    setPending(true)
    setError(null)
    setFieldErrors({})
    try {
      const outcome = await onConfirm({
        preset: preset!,
        reason: trimmed || undefined,
      })
      if (!outcome.ok && !outcome.close) {
        setError(outcome.error)
        setFieldErrors(outcome.fieldErrors ?? {})
        return
      }
      setPending(false)
      reset()
      onOpenChange(false)
    } finally {
      setPending(false)
    }
  }

  const presetError = fieldErrors.preset
  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent>
        <form onSubmit={submit} className="grid gap-4" noValidate>
          <DialogHeader>
            <DialogTitle>Reopen this check</DialogTitle>
            <DialogDescription className="break-words">
              “{question}” goes back to Needs recheck for staff to capture
              again. The current answer stays until a new finding replaces it.
            </DialogDescription>
          </DialogHeader>
          <fieldset
            className="grid gap-2"
            aria-describedby={presetError ? `${id}-preset-error` : undefined}
          >
            <legend className="mb-1 text-label-touch text-ink md:text-label">
              Why does it need a recheck?
            </legend>
            {REOPEN_PRESETS.map((value) => (
              <label
                key={value}
                className="flex min-h-11 items-center gap-3 text-body-touch text-ink md:min-h-8 md:text-body"
              >
                <input
                  type="radio"
                  name={`${id}-preset`}
                  value={value}
                  checked={preset === value}
                  onChange={() => setPreset(value)}
                  disabled={pending}
                  className="size-5 shrink-0 accent-accent"
                />
                {REOPEN_PRESET_LABEL[value]}
              </label>
            ))}
            {presetError ? (
              <p
                id={`${id}-preset-error`}
                role="alert"
                className="text-meta-touch font-semibold text-negative md:text-meta-strong"
              >
                {presetError}
              </p>
            ) : null}
          </fieldset>
          <ReasonField
            id={`${id}-reason`}
            label="Details"
            value={reason}
            onChange={setReason}
            error={fieldErrors.reason}
            required={preset === "other"}
            maxLength={LIMITS.reason}
            help="Staff see this when they recapture."
            disabled={pending}
          />
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
              disabled={pending}
              aria-busy={pending || undefined}
            >
              {pending ? (
                <SpinnerGapIcon aria-hidden className="animate-spin" />
              ) : (
                <ArrowCounterClockwiseIcon aria-hidden />
              )}
              {UI_TEXT.reopen}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
