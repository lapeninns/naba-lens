"use client"

import * as React from "react"
import Link from "next/link"
import { EnvelopeSimpleIcon } from "@phosphor-icons/react"

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
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { isDepartment, type Department } from "@/lib/config/departments"
import { cn } from "@/lib/utils"

import { Notice } from "./notice"
import { OfflineNotice, useOnline } from "./offline-notice"
import { OptionSelect } from "./option-select"
import type { Option } from "./types"

export type InviteFormValues = {
  displayName: string
  email: string
  jobTitle: string
  department?: Department | null
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

/** An account that already uses an email address, to point the admin at it. */
export type ExistingAccount = {
  displayName: string
  venueName: string | null
  href: string
}

type InviteStaffDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Active venues only. */
  venues: Option[]
  onSubmit: (values: InviteFormValues) => Promise<InviteResult> | InviteResult
  /** Looks up who already has an email the server refused as taken. */
  findAccount?: (email: string) => ExistingAccount | null
}

const firstWord = (name: string) => name.trim().split(/\s+/)[0] ?? name

export function InviteStaffDialog(props: InviteStaffDialogProps) {
  const [pending, setPending] = React.useState(false)
  return (
    <Dialog
      open={props.open}
      onOpenChange={(next) => {
        if (!pending) props.onOpenChange(next)
      }}
    >
      <DialogContent>
        <InviteForm {...props} pending={pending} setPending={setPending} />
      </DialogContent>
    </Dialog>
  )
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const TEAMS = [
  { id: "foh", name: "Front of house" },
  { id: "boh", name: "Back of house" },
  { id: "", name: "Unassigned" },
] as const

/** Front of house, Back of house or Unassigned, as one radio group. */
export function TeamField({
  value,
  onChange,
  hint,
  error,
}: {
  value: Department | null
  onChange: (value: Department | null) => void
  hint: string
  error?: string
}) {
  const id = React.useId()
  return (
    <fieldset
      className="grid min-w-0 gap-1.5"
      aria-describedby={`${id}-hint`}
      aria-invalid={!!error || undefined}
    >
      <legend className="mb-1.5 text-label-touch md:text-label">Team</legend>
      <div className="grid grid-cols-3 gap-0.5 rounded-control border border-line-control bg-panel p-0.5">
        {TEAMS.map((team) => {
          const checked = (value ?? "") === team.id
          return (
            <label
              key={team.name}
              className={cn(
                "flex min-h-11 cursor-pointer items-center justify-center rounded-chip px-2 text-center text-meta-touch font-semibold has-focus-visible:outline-2 has-focus-visible:outline-offset-1 has-focus-visible:outline-focus md:min-h-8 md:text-meta-strong",
                checked
                  ? "bg-well text-ink"
                  : "text-ink-muted hover:bg-fill-hover"
              )}
            >
              <input
                type="radio"
                name={id}
                value={team.id}
                checked={checked}
                onChange={() =>
                  onChange(isDepartment(team.id) ? team.id : null)
                }
                className="sr-only"
              />
              {team.name}
            </label>
          )
        })}
      </div>
      <p
        id={`${id}-hint`}
        className="text-meta-touch text-ink-muted md:text-meta"
      >
        {hint}
      </p>
      {error ? <FieldError>{error}</FieldError> : null}
    </fieldset>
  )
}

function InviteForm({
  onOpenChange,
  venues,
  onSubmit,
  findAccount,
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
    department: null,
    venueId: "",
  })
  const [result, setResult] = React.useState<InviteResult | null>(null)
  const online = useOnline()
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
      department: values.department ?? null,
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

  const name = values.displayName.trim()
  const first = firstWord(name)

  if (result?.status === "sent" || result?.status === "partial") {
    const sent = result.status === "sent"
    return (
      <div className="grid gap-5">
        <DialogHeader>
          <DialogTitle>
            {sent ? "Invitation sent" : "Account created, email not sent"}
          </DialogTitle>
          {sent ? (
            <DialogDescription className="text-ink">
              {name} can sign in from the link in the email sent to{" "}
              {values.email.trim().toLowerCase()}. {first} shows as Invited
              until then.
            </DialogDescription>
          ) : null}
        </DialogHeader>
        {result.status === "partial" ? (
          <Notice tone="attention">{result.message}</Notice>
        ) : null}
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
  const taken =
    serverFieldErrors.email && findAccount
      ? findAccount(values.email.trim().toLowerCase())
      : null
  const errorFor = (key: keyof InviteFormValues) =>
    localErrors[key] ?? serverFieldErrors[key]
  const emailError: React.ReactNode = taken ? (
    <>
      This email already has an account: {taken.displayName}
      {taken.venueName ? `, ${taken.venueName}` : ""}.{" "}
      <Link
        href={taken.href}
        className="font-semibold text-ink underline underline-offset-3"
      >
        Open {firstWord(taken.displayName)}&apos;s profile
      </Link>{" "}
      instead.
    </>
  ) : (
    errorFor("email")
  )

  const text = (
    key: "displayName" | "email" | "jobTitle",
    label: React.ReactNode,
    extra: React.ComponentProps<typeof Input>,
    options: { hint?: string; error?: React.ReactNode } = {}
  ) => {
    const error = options.error ?? errorFor(key)
    const describedBy = [
      error ? `${id}-${key}-error` : null,
      options.hint ? `${id}-${key}-hint` : null,
    ]
      .filter(Boolean)
      .join(" ")
    return (
      <Field className="gap-1.5">
        <FieldLabel htmlFor={`${id}-${key}`}>{label}</FieldLabel>
        <Input
          id={`${id}-${key}`}
          value={values[key]}
          onChange={(e) => set(key)(e.currentTarget.value)}
          aria-invalid={!!error || undefined}
          aria-describedby={describedBy || undefined}
          className="h-11 md:h-9"
          {...extra}
        />
        {error ? (
          <FieldError id={`${id}-${key}-error`}>{error}</FieldError>
        ) : options.hint ? (
          <FieldDescription id={`${id}-${key}-hint`}>
            {options.hint}
          </FieldDescription>
        ) : null}
      </Field>
    )
  }

  return (
    <form
      onSubmit={submit}
      className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-5"
      noValidate
    >
      <DialogHeader>
        <DialogTitle>Invite staff</DialogTitle>
        <DialogDescription>
          Creates a staff account and emails a single-use sign-in link. New
          admins are added through setup, not here.
        </DialogDescription>
      </DialogHeader>
      {/* OfflineNotice needs the app router; mount it only when it shows so
          the dialog still renders outside one. */}
      {online ? null : <OfflineNotice />}
      {result?.status === "error" && !taken ? (
        <Notice tone="negative">{result.error}</Notice>
      ) : null}
      {text("displayName", "Name", { autoComplete: "off", maxLength: 80 })}
      {text(
        "email",
        "Email",
        {
          type: "email",
          inputMode: "email",
          autoComplete: "off",
          spellCheck: false,
        },
        {
          hint: "The sign-in link goes here. Only admins see email addresses.",
          error: emailError,
        }
      )}
      {text(
        "jobTitle",
        <>
          Job title{" "}
          <span className="font-normal text-ink-muted">(optional)</span>
        </>,
        { maxLength: 80 }
      )}
      <Field className="gap-1.5">
        <FieldLabel htmlFor={`${id}-venueId`}>Venue</FieldLabel>
        <OptionSelect
          id={`${id}-venueId`}
          options={venues}
          value={values.venueId || null}
          onValueChange={(v) => set("venueId")(v ?? "")}
          placeholder="Choose a venue"
          invalid={!!errorFor("venueId")}
          aria-describedby={`${id}-venueId-hint`}
        />
        {errorFor("venueId") ? (
          <FieldError>{errorFor("venueId")}</FieldError>
        ) : (
          <FieldDescription id={`${id}-venueId-hint`}>
            Only active venues. Photos are counted at this venue.
          </FieldDescription>
        )}
      </Field>
      <TeamField
        value={values.department ?? null}
        onChange={(department) => setValues((v) => ({ ...v, department }))}
        hint="Teams (FOH/BOH) only suggest who to assign. They do not give anyone extra access. Without a team, the monthly target shows Needs setup."
        error={errorFor("department")}
      />
      <DialogFooter>
        <Button
          type="button"
          variant="secondary"
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
          <EnvelopeSimpleIcon aria-hidden />
          {pending ? "Sending…" : "Send invitation"}
        </Button>
      </DialogFooter>
    </form>
  )
}
