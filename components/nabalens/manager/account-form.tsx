"use client"

import * as React from "react"

import { Button } from "@/components/ui/button"
import { Field, FieldError, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"

import { Notice } from "../notice"
import type { ActionResult } from "../types"
import { MANAGER_COPY } from "./copy"

const COPY = MANAGER_COPY.accountPage
export const DISPLAY_NAME_MAX = 80

/**
 * A manager's own account: the display name is editable; email and venue are
 * read-only (an admin changes the venue). No photo, job title or work profile.
 */
export function ManagerAccountForm({
  displayName: initialName,
  email,
  venueName,
  onSave,
}: {
  displayName: string
  email: string | null
  venueName: string
  onSave: (input: { displayName: string }) => Promise<ActionResult>
}) {
  const [displayName, setDisplayName] = React.useState(initialName)
  const [pending, setPending] = React.useState(false)
  const [fieldError, setFieldError] = React.useState<string | null>(null)
  const [result, setResult] = React.useState<ActionResult | null>(null)
  const nameId = React.useId()
  const errorId = React.useId()

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    const trimmed = displayName.trim()
    setResult(null)
    if (trimmed.length < 1 || trimmed.length > DISPLAY_NAME_MAX) {
      setFieldError(COPY.displayNameError)
      return
    }
    setFieldError(null)
    setPending(true)
    try {
      const outcome = await onSave({ displayName: trimmed })
      setResult(outcome)
      if (outcome.ok) setDisplayName(trimmed)
      else setFieldError(outcome.fieldErrors?.displayName ?? null)
    } catch {
      setResult({ ok: false, error: COPY.saveFailed })
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="grid max-w-(--size-reading) gap-6">
      <form onSubmit={submit} noValidate className="grid gap-4">
        <Field className="gap-1.5" data-invalid={!!fieldError || undefined}>
          <FieldLabel htmlFor={nameId}>{COPY.displayName}</FieldLabel>
          <Input
            id={nameId}
            name="displayName"
            value={displayName}
            onChange={(e) => setDisplayName(e.currentTarget.value)}
            required
            maxLength={DISPLAY_NAME_MAX}
            autoComplete="name"
            aria-invalid={!!fieldError || undefined}
            aria-describedby={fieldError ? errorId : undefined}
            className="h-11 sm:h-9"
          />
          {fieldError ? (
            <FieldError id={errorId}>{fieldError}</FieldError>
          ) : null}
        </Field>
        {result && !result.ok ? (
          <Notice tone="negative">{result.error}</Notice>
        ) : null}
        {result?.ok ? <Notice tone="positive">{COPY.saved}</Notice> : null}
        <div>
          <Button
            type="submit"
            variant="primary"
            size="touch"
            disabled={pending}
            aria-busy={pending || undefined}
          >
            {pending ? COPY.saving : COPY.save}
          </Button>
        </div>
      </form>

      <dl className="grid gap-4 text-body-touch md:text-body">
        <div className="grid gap-0.5">
          <dt className="text-meta-touch font-semibold text-ink-muted md:text-meta-strong">
            {COPY.email}
          </dt>
          <dd className="break-words text-ink">{email ?? COPY.noEmail}</dd>
        </div>
        <div className="grid gap-0.5">
          <dt className="text-meta-touch font-semibold text-ink-muted md:text-meta-strong">
            {COPY.venue}
          </dt>
          <dd className="text-ink">{venueName}</dd>
          <dd className="text-meta-touch text-ink-muted md:text-meta">
            {COPY.venueNote}
          </dd>
        </div>
      </dl>

      <form action="/auth/logout" method="post">
        <Button type="submit" variant="outline" size="touch">
          {COPY.signOut}
        </Button>
      </form>
    </div>
  )
}
