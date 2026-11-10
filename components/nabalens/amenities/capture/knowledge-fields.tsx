"use client"

import * as React from "react"

import {
  UNKNOWN_PRESETS,
  type UnknownPreset,
} from "@/lib/knowledge-client/contract"
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
import { cn } from "@/lib/utils"

import { ReasonField } from "../../coverage/reason-dialog"
import { UNKNOWN_PRESET_LABEL, dateAndTime } from "../../knowledge/copy"
import { Notice } from "../../notice"
import { FieldMessage, LABEL } from "./field-parts"

const RADIO_ROW =
  "flex min-h-11 cursor-pointer items-center gap-3 text-body-touch text-ink has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-focus md:min-h-8 md:text-body"

/** Couldn't establish: why (a preset) and what was tried. */
export function UnknownFields({
  id,
  preset,
  tried,
  onPreset,
  onTried,
  presetError,
  triedError,
  disabled,
}: {
  id: string
  preset: UnknownPreset | null
  tried: string
  onPreset: (preset: UnknownPreset) => void
  onTried: (value: string) => void
  presetError?: string
  triedError?: string
  disabled: boolean
}) {
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <fieldset
        className="grid gap-1"
        disabled={disabled}
        aria-describedby={presetError ? `${id}-preset-error` : undefined}
      >
        <legend className={cn(LABEL, "mb-1")}>
          Why couldn&apos;t you establish it? (required)
        </legend>
        {UNKNOWN_PRESETS.map((value) => (
          <label key={value} className={RADIO_ROW}>
            <input
              type="radio"
              name={`${id}-preset`}
              value={value}
              checked={preset === value}
              onChange={() => onPreset(value)}
              className="size-5 shrink-0 accent-primary"
            />
            {UNKNOWN_PRESET_LABEL[value]}
          </label>
        ))}
        <FieldMessage id={`${id}-preset-error`} error={presetError} />
      </fieldset>
      <ReasonField
        id={`${id}-tried`}
        label="What did you try?"
        value={tried}
        onChange={onTried}
        maxLength={500}
        help="For example: “Asked the duty manager; the car park sign was covered.”"
        error={triedError}
        disabled={disabled}
      />
    </div>
  )
}

/**
 * A manager on a confirmation-required question chooses, every time, whether
 * the answer is used now as their own confirmed finding.
 */
export const SelfConfirmFieldset = React.forwardRef<
  HTMLFieldSetElement,
  {
    id: string
    value: boolean | null
    onChange: (value: boolean) => void
    /** The server refused a self-confirmation: only the other choice is left. */
    ownAllowed: boolean
    error?: string
    disabled: boolean
  }
>(function SelfConfirmFieldset(
  { id, value, onChange, ownAllowed, error, disabled },
  ref
) {
  const options = [
    ...(ownAllowed
      ? [
          {
            own: true,
            label: "I confirm it now",
            hint: "It's used straight away and recorded as confirmed by you, your own finding.",
          },
        ]
      : []),
    {
      own: false,
      label: "Leave it for another manager or an admin",
      hint: "It waits in To confirm until someone else decides.",
    },
  ]
  return (
    <fieldset
      ref={ref}
      tabIndex={-1}
      className="grid gap-2 outline-none"
      disabled={disabled}
      aria-describedby={error ? `${id}-error` : undefined}
    >
      <legend className={cn(LABEL, "mb-1")}>
        Who confirms this answer? (required)
      </legend>
      {options.map((option) => (
        <label
          key={String(option.own)}
          className="flex min-h-13 cursor-pointer items-start gap-3 rounded-control border border-line-control bg-panel px-4 py-3 text-body-touch has-checked:border-ink has-checked:bg-accent-soft has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-focus md:min-h-11 md:text-body"
        >
          <input
            type="radio"
            name={`${id}-own`}
            checked={value === option.own}
            onChange={() => onChange(option.own)}
            aria-labelledby={`${id}-${option.own}-word`}
            aria-describedby={`${id}-${option.own}-hint`}
            className="mt-0.5 size-5 shrink-0 accent-primary"
          />
          <span className="grid gap-0.5">
            <span id={`${id}-${option.own}-word`} className="font-semibold">
              {option.label}
            </span>
            <span
              id={`${id}-${option.own}-hint`}
              className="text-meta-touch text-ink-muted md:text-meta"
            >
              {option.hint}
            </span>
          </span>
        </label>
      ))}
      <FieldMessage id={`${id}-error`} error={error} />
    </fieldset>
  )
})

/** "What changed?" on a change report. */
export function ChangeReasonField({
  id,
  value,
  onChange,
  error,
  disabled,
}: {
  id: string
  value: string
  onChange: (value: string) => void
  error?: string
  disabled: boolean
}) {
  return (
    <ReasonField
      id={id}
      label="What changed?"
      value={value}
      onChange={onChange}
      maxLength={500}
      help="For example: “The ramp at the side door was removed on Monday.”"
      error={error}
      disabled={disabled}
    />
  )
}

/** "Discard this draft?": shared by the capture form and Me. */
export function DiscardDraftDialog({
  open,
  onOpenChange,
  onDiscard,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onDiscard: () => Promise<void> | void
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Discard this draft?</AlertDialogTitle>
          <AlertDialogDescription className="text-ink">
            It&apos;s deleted. Nothing was sent.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <Button
            type="button"
            variant="danger-quiet"
            size="touch"
            onClick={() => {
              onOpenChange(false)
              void onDiscard()
            }}
          >
            Discard
          </Button>
          <AlertDialogCancel variant="primary" size="touch">
            Keep draft
          </AlertDialogCancel>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
/** The person's saved draft came back: say when, and offer to discard it. */
export function DraftRestoredNotice({
  savedAt,
  nearPurge,
  onDiscard,
  disabled,
}: {
  /** The account copy's save time; null when this phone's copy was restored. */
  savedAt: string | null
  /** Saved 80 days ago or more: drafts are deleted after 90. */
  nearPurge: boolean
  onDiscard: () => Promise<void> | void
  disabled: boolean
}) {
  const [open, setOpen] = React.useState(false)
  return (
    <Notice
      tone="plain"
      role="note"
      action={
        <Button
          type="button"
          variant="quiet"
          size="touch"
          disabled={disabled}
          onClick={() => setOpen(true)}
        >
          Discard draft
        </Button>
      }
    >
      <p>
        {savedAt
          ? `You saved this on ${dateAndTime(savedAt)}. It hasn't been sent.`
          : "Restored from this phone. It hasn't been sent."}
      </p>
      {nearPurge ? <p>Saved drafts are deleted after 90 days.</p> : null}
      <DiscardDraftDialog
        open={open}
        onOpenChange={setOpen}
        onDiscard={onDiscard}
      />
    </Notice>
  )
}
