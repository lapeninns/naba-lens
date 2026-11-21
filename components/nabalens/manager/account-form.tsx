"use client"

import { MetaList } from "@/components/nabalens/meta-list"
import * as React from "react"

import { useSessionEndedCatch } from "@/components/nabalens/session-guard-host"
import { Button } from "@/components/ui/button"
import { Field, FieldError, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"

import { Notice } from "../notice"
import { ThemeSetting } from "../theme-setting"
import type { ActionResult } from "../types"
import { MANAGER_COPY } from "./copy"

const COPY = MANAGER_COPY.accountPage
export const DISPLAY_NAME_MAX = 80

/**
 * A manager's own account: the display name is editable; email and venue are
 * read-only (an admin changes the venue). No photo, job title or work profile.
 * Second handoff: the name card on the left; on the right the page's rows
 * (`aside`: Your photos, Two-step sign-in), Appearance, then Sign out.
 */
export function ManagerAccountForm({
  displayName: initialName,
  email,
  venueName,
  onSave,
  aside,
}: {
  displayName: string
  email: string | null
  venueName: string
  onSave: (input: { displayName: string }) => Promise<ActionResult>
  /** Rows the page reads on the server, above Appearance. */
  aside?: React.ReactNode
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
    <div className="grid items-start gap-gutter md:grid-cols-2">
      <div className="grid min-w-0 gap-4 rounded-card bg-surface p-4 shadow-card">
        <form onSubmit={submit} noValidate className="grid min-w-0 gap-4">
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
              disabled={pending}
              aria-busy={pending || undefined}
              className="max-md:w-full"
            >
              {pending ? COPY.saving : COPY.save}
            </Button>
          </div>
        </form>

        <MetaList
          items={[
            { label: COPY.email, value: email ?? COPY.noEmail },
            {
              label: COPY.venue,
              value: (
                <span className="grid gap-0.5">
                  <span>{venueName}</span>
                  <span className="text-meta text-ink-muted">
                    {COPY.venueNote}
                  </span>
                </span>
              ),
            },
          ]}
        />
      </div>

      <div className="grid min-w-0 gap-gutter">
        {aside}
        <ThemeSetting layout="card" />
        <form action="/auth/logout" method="post">
          <Button type="submit" variant="secondary" className="max-md:w-full">
            {COPY.signOut}
          </Button>
        </form>
      </div>
    </div>
  )
}
