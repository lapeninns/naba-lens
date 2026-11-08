"use client"

import * as React from "react"

import { useSessionEndedCatch } from "@/components/nabalens/session-guard-host"
import { Button } from "@/components/ui/button"
import { Field, FieldError, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"

import { Card } from "../common-room/card"
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
  const sessionEnded = useSessionEndedCatch()
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
    } catch (cause) {
      setResult({ ok: false, error: sessionEnded(cause) ?? COPY.saveFailed })
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="grid max-w-(--size-reading) gap-(--gutter)">
      <form
        onSubmit={submit}
        noValidate
        className="grid min-w-0 gap-4 rounded-card bg-surface p-4 shadow-card"
      >
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
            className="max-md:w-full"
          >
            {pending ? COPY.saving : COPY.save}
          </Button>
        </div>
      </form>

      <Card>
        <dl className="grid gap-3 text-body">
          <div className="grid gap-0.5">
            <dt className="text-meta-strong text-ink-muted">{COPY.email}</dt>
            <dd className="font-mono [overflow-wrap:anywhere] text-ink">
              {email ?? COPY.noEmail}
            </dd>
          </div>
          <div className="grid gap-0.5 border-t border-line pt-3">
            <dt className="text-meta-strong text-ink-muted">{COPY.venue}</dt>
            <dd className="font-bold text-ink">{venueName}</dd>
            <dd className="text-meta text-ink-muted">{COPY.venueNote}</dd>
          </div>
        </dl>
      </Card>

      <form action="/auth/logout" method="post">
        <Button
          type="submit"
          variant="secondary"
          size="touch"
          className="max-md:w-full"
        >
          {COPY.signOut}
        </Button>
      </form>
    </div>
  )
}
