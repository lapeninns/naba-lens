"use client"

import { useActionState } from "react"

import { Notice } from "@/components/nabalens/notice"
import { Button } from "@/components/ui/button"
import { FormField } from "@/components/ui/field"
import { Input } from "@/components/ui/input"

import { resetMfaAction, type MfaResetState } from "./mfa-reset-actions"

/**
 * Reset a lost authenticator (FA-23, spec §3.2): removes the person's second
 * factor so they set up a new one at their next sign-in. Admins need one to
 * work as an admin; managers may have turned one on. Never shown for the
 * admin's own account.
 */
export function MfaResetPanel({
  profileId,
  firstName,
}: {
  profileId: string
  firstName: string
}) {
  const [state, action, pending] = useActionState<MfaResetState, FormData>(
    resetMfaAction,
    { status: "idle" }
  )
  return (
    <section
      aria-labelledby="mfa-reset-heading"
      className="grid gap-3 rounded-card bg-surface p-4 shadow-card"
      data-testid="mfa-reset"
    >
      <h2 id="mfa-reset-heading" className="type-section-title text-ink">
        Authenticator app
      </h2>
      <p className="text-body text-ink-muted">
        If {firstName} lost the phone with their authenticator, reset it. They
        set up a new one the next time they sign in. Kept in Activity.
      </p>
      {state.status === "done" ? (
        <Notice tone="positive" role="status">
          {state.removed === 0
            ? `${firstName} had no authenticator set up. Nothing changed.`
            : `Reset. ${firstName} sets up a new authenticator at their next sign-in.`}
        </Notice>
      ) : (
        <form action={action} className="grid gap-3" noValidate>
          <input type="hidden" name="profileId" value={profileId} />
          <FormField
            label="Why are you resetting it?"
            error={
              state.status === "error" && state.field
                ? state.message
                : undefined
            }
          >
            <Input name="reason" maxLength={500} />
          </FormField>
          {state.status === "error" && !state.field ? (
            <Notice tone="negative" role="alert">
              {state.message}
            </Notice>
          ) : null}
          <div>
            <Button type="submit" variant="secondary" loading={pending}>
              Reset authenticator
            </Button>
          </div>
        </form>
      )}
    </section>
  )
}
