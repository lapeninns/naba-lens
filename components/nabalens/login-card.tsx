"use client"

import * as React from "react"
import { EnvelopeSimpleIcon, WarningCircleIcon } from "@phosphor-icons/react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Field, FieldError, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

type LoginCardProps = {
  /**
   * Request a magic link. Resolve for any known or unknown email (neutral
   * response); return `{ error }` only for failures the user can act on.
   */
  onSubmit: (email: string) => Promise<{ error?: string } | void>
  /** The previous link was expired or already used. */
  linkExpired?: boolean
  /** Message for other callback failures, e.g. an inactive account. */
  notice?: string | null
  className?: string
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function LoginCard({
  onSubmit,
  linkExpired = false,
  notice,
  className,
}: LoginCardProps) {
  const [email, setEmail] = React.useState("")
  const [state, setState] = React.useState<"idle" | "sending" | "sent">("idle")
  const [error, setError] = React.useState<string | null>(null)
  const inputId = React.useId()
  const errorId = React.useId()

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    const value = email.trim()
    if (!EMAIL.test(value)) {
      setError("Enter the email address your invitation was sent to.")
      return
    }
    setError(null)
    setState("sending")
    try {
      const result = await onSubmit(value)
      if (result?.error) {
        setError(result.error)
        setState("idle")
        return
      }
      setState("sent")
    } catch {
      setError(
        "The sign-in link could not be sent. Check your connection and try again."
      )
      setState("idle")
    }
  }

  return (
    <section
      aria-labelledby={`${inputId}-title`}
      className={cn(
        "w-full max-w-sm rounded-xl border bg-card p-6 sm:p-8",
        className
      )}
    >
      <p className="text-base font-semibold tracking-tight">NabaLens</p>
      {state === "sent" ? (
        <div className="mt-6 grid gap-4" role="status">
          <EnvelopeSimpleIcon
            className="size-8 text-muted-foreground"
            aria-hidden
          />
          <h1
            id={`${inputId}-title`}
            className="text-xl font-semibold tracking-tight"
          >
            Check your email
          </h1>
          <p className="text-sm text-muted-foreground">
            If{" "}
            <span className="font-medium text-foreground">{email.trim()}</span>{" "}
            has a NabaLens account, a sign-in link is on its way. Open it on
            this device. It can only be used once.
          </p>
          <Button
            variant="outline"
            size="touch"
            onClick={() => {
              setState("idle")
              setError(null)
            }}
          >
            Use a different email
          </Button>
        </div>
      ) : (
        <form onSubmit={submit} noValidate className="mt-6 grid gap-5">
          <div className="grid gap-1.5">
            <h1
              id={`${inputId}-title`}
              className="text-xl font-semibold tracking-tight"
            >
              Sign in
            </h1>
            <p className="text-sm text-muted-foreground">
              We email you a sign-in link. No password needed.
            </p>
          </div>
          {linkExpired ? (
            <Alert variant="warning">
              <WarningCircleIcon aria-hidden />
              <AlertTitle>That sign-in link has expired</AlertTitle>
              <AlertDescription className="text-pretty">
                Links work once and for a short time. Enter your email to get a
                new one.
              </AlertDescription>
            </Alert>
          ) : null}
          {notice ? (
            <Alert variant="warning">
              <AlertDescription className="text-pretty">{notice}</AlertDescription>
            </Alert>
          ) : null}
          <Field className="gap-1.5">
            <FieldLabel htmlFor={inputId}>Email</FieldLabel>
            <Input
              id={inputId}
              type="email"
              inputMode="email"
              autoComplete="email"
              spellCheck={false}
              value={email}
              onChange={(e) => setEmail(e.currentTarget.value)}
              aria-invalid={!!error || undefined}
              aria-describedby={error ? errorId : undefined}
              className="h-11 sm:h-10"
            />
            {error ? <FieldError id={errorId}>{error}</FieldError> : null}
          </Field>
          <Button
            type="submit"
            size="touch"
            className="sm:h-10"
            disabled={state === "sending"}
            aria-busy={state === "sending"}
          >
            {state === "sending" ? "Sending…" : "Send sign-in link"}
          </Button>
        </form>
      )}
    </section>
  )
}
