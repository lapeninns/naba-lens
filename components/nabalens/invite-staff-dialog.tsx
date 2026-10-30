"use client"

import * as React from "react"
import { CheckCircleIcon, WarningIcon } from "@phosphor-icons/react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Field, FieldError, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"

import { OptionSelect } from "./option-select"
import type { Option } from "./types"

export type InviteFormValues = {
  displayName: string
  email: string
  jobTitle: string
  venueId: string
}

export type InviteResult =
  | { status: "sent" }
  /** The account exists but the email did not go out; no false success. */
  | { status: "partial"; message: string }
  | {
      status: "error"
      error: string
      fieldErrors?: Partial<Record<keyof InviteFormValues, string>>
    }

type InviteStaffDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Active venues only. */
  venues: Option[]
  onSubmit: (values: InviteFormValues) => Promise<InviteResult> | InviteResult
}

export function InviteStaffDialog(props: InviteStaffDialogProps) {
  const [pending, setPending] = React.useState(false)
  return (
    <Dialog
      open={props.open}
      onOpenChange={(next) => {
        if (!pending) props.onOpenChange(next)
      }}
    >
      <DialogContent className="max-h-[calc(100svh-1rem)] overflow-y-auto sm:max-w-md">
        <InviteForm {...props} pending={pending} setPending={setPending} />
      </DialogContent>
    </Dialog>
  )
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function InviteForm({
  onOpenChange,
  venues,
  onSubmit,
  pending,
  setPending,
}: InviteStaffDialogProps & {
  pending: boolean
  setPending: (p: boolean) => void
}) {
  const [values, setValues] = React.useState<InviteFormValues>({
    displayName: "",
    email: "",
    jobTitle: "",
    venueId: "",
  })
  const [result, setResult] = React.useState<InviteResult | null>(null)
  const [localErrors, setLocalErrors] = React.useState<
    Partial<Record<keyof InviteFormValues, string>>
  >({})
  const id = React.useId()

  const set = (key: keyof InviteFormValues) => (value: string) =>
    setValues((v) => ({ ...v, [key]: value }))

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    const trimmed = {
      displayName: values.displayName.trim(),
      email: values.email.trim().toLowerCase(),
      jobTitle: values.jobTitle.trim(),
      venueId: values.venueId,
    }
    const errors: Partial<Record<keyof InviteFormValues, string>> = {}
    if (!trimmed.displayName) errors.displayName = "Enter their name."
    if (!EMAIL.test(trimmed.email))
      errors.email = "Enter a valid email address."
    if (!trimmed.venueId) errors.venueId = "Choose a venue."
    setLocalErrors(errors)
    if (Object.keys(errors).length > 0) return

    setPending(true)
    setResult(null)
    try {
      setResult(await onSubmit(trimmed))
    } catch {
      setResult({
        status: "error",
        error: "The invitation could not be sent. Try again.",
      })
    } finally {
      setPending(false)
    }
  }

  if (result?.status === "sent" || result?.status === "partial") {
    const sent = result.status === "sent"
    return (
      <div className="grid gap-5">
        <DialogHeader>
          <DialogTitle>
            {sent ? "Invitation sent" : "Account created, email not sent"}
          </DialogTitle>
          <DialogDescription>
            {sent
              ? `${values.displayName.trim()} will get a sign-in link at ${values.email.trim().toLowerCase()}.`
              : `${values.displayName.trim()} now has a staff account.`}
          </DialogDescription>
        </DialogHeader>
        <Alert variant={sent ? "default" : "warning"}>
          {sent ? <CheckCircleIcon aria-hidden /> : <WarningIcon aria-hidden />}
          <AlertTitle>{sent ? "Done" : "Invitation email failed"}</AlertTitle>
          <AlertDescription>
            {sent
              ? "They appear in the staff list as Invited until they sign in."
              : result.message}
          </AlertDescription>
        </Alert>
        <DialogFooter>
          <Button size="touch" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </div>
    )
  }

  const serverFieldErrors =
    result?.status === "error" ? (result.fieldErrors ?? {}) : {}
  const errorFor = (key: keyof InviteFormValues) =>
    localErrors[key] ?? serverFieldErrors[key]

  const text = (
    key: "displayName" | "email" | "jobTitle",
    label: string,
    extra: React.ComponentProps<typeof Input>
  ) => (
    <Field className="gap-1.5">
      <FieldLabel htmlFor={`${id}-${key}`}>{label}</FieldLabel>
      <Input
        id={`${id}-${key}`}
        value={values[key]}
        onChange={(e) => set(key)(e.currentTarget.value)}
        aria-invalid={!!errorFor(key) || undefined}
        aria-describedby={errorFor(key) ? `${id}-${key}-error` : undefined}
        className="h-11 sm:h-9"
        {...extra}
      />
      {errorFor(key) ? (
        <FieldError id={`${id}-${key}-error`}>{errorFor(key)}</FieldError>
      ) : null}
    </Field>
  )

  return (
    <form
      onSubmit={submit}
      className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-5"
      noValidate
    >
      <DialogHeader>
        <DialogTitle>Invite staff</DialogTitle>
        <DialogDescription>
          They get an email with a sign-in link. Invitations create staff
          accounts only.
        </DialogDescription>
      </DialogHeader>
      {result?.status === "error" ? (
        <Alert variant="destructive">
          <AlertDescription>{result.error}</AlertDescription>
        </Alert>
      ) : null}
      {text("displayName", "Name", { autoComplete: "off", maxLength: 80 })}
      {text("email", "Email", {
        type: "email",
        inputMode: "email",
        autoComplete: "off",
        spellCheck: false,
      })}
      {text("jobTitle", "Job title (optional)", { maxLength: 80 })}
      <Field className="gap-1.5">
        <FieldLabel htmlFor={`${id}-venueId`}>Venue</FieldLabel>
        <OptionSelect
          id={`${id}-venueId`}
          options={venues}
          value={values.venueId || null}
          onValueChange={(v) => set("venueId")(v ?? "")}
          placeholder="Choose a venue"
          invalid={!!errorFor("venueId")}
        />
        {errorFor("venueId") ? (
          <FieldError>{errorFor("venueId")}</FieldError>
        ) : null}
      </Field>
      <DialogFooter>
        <Button
          type="button"
          variant="outline"
          size="touch"
          onClick={() => onOpenChange(false)}
          disabled={pending}
        >
          Cancel
        </Button>
        <Button
          type="submit"
          size="touch"
          disabled={pending}
          aria-busy={pending}
        >
          {pending ? "Sending…" : "Send invitation"}
        </Button>
      </DialogFooter>
    </form>
  )
}
