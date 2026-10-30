"use client"

import * as React from "react"
import { EnvelopeSimpleIcon, WarningCircleIcon } from "@phosphor-icons/react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  CAPTCHA_RETRY_MESSAGE,
  CAPTCHA_UNAVAILABLE_MESSAGE,
} from "@/lib/auth/captcha"
import { cn } from "@/lib/utils"
import { TurnstileChallenge } from "./turnstile-challenge"

type LoginCardProps = {
  /**
   * Request a magic link. Resolve for any known or unknown email (neutral
   * response); return `{ error }` only for failures the user can act on.
   */
  onSubmit: (
    email: string,
    captchaToken?: string
  ) => Promise<{ error?: string } | void>
  captchaRequired?: boolean
  captchaSiteKey?: string | null
  /** The previous link was expired or already used. */
  linkExpired?: boolean
  /** Message for other callback failures, e.g. an inactive account. */
  notice?: string | null
  className?: string
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const EMAIL_ERROR = "Enter the email address your invitation was sent to."

export function LoginCard({
  onSubmit,
  linkExpired = false,
  notice,
  captchaRequired = false,
  captchaSiteKey,
  className,
}: LoginCardProps) {
  const [email, setEmail] = React.useState("")
  const [state, setState] = React.useState<"idle" | "sending" | "sent">("idle")
  const [error, setError] = React.useState<string | null>(null)
  const [captchaToken, setCaptchaToken] = React.useState<string | null>(null)
  const [challengeAttempt, setChallengeAttempt] = React.useState(0)
  const requiresCaptcha = captchaRequired || !!captchaSiteKey
  const emailError = error === EMAIL_ERROR
  const handleCaptchaToken = React.useCallback((token: string | null) => {
    setCaptchaToken(token)
    if (token) {
      setError((current) =>
        current === CAPTCHA_RETRY_MESSAGE ? null : current
      )
    }
  }, [])
  const inputId = React.useId()
  const errorId = React.useId()

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    const value = email.trim()
    if (!EMAIL.test(value)) {
      setError(EMAIL_ERROR)
      return
    }
    if (requiresCaptcha && !captchaSiteKey) {
      setError(CAPTCHA_UNAVAILABLE_MESSAGE)
      return
    }
    if (requiresCaptcha && !captchaToken) {
      setError(CAPTCHA_RETRY_MESSAGE)
      return
    }
    setError(null)
    setState("sending")
    try {
      const result = requiresCaptcha
        ? await onSubmit(value, captchaToken!)
        : await onSubmit(value)
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
    } finally {
      // Turnstile tokens are single-use, including after a failed request.
      if (requiresCaptcha) {
        setCaptchaToken(null)
        setChallengeAttempt((attempt) => attempt + 1)
      }
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
      <p className="text-base font-semibold tracking-tight">Naba-Lens</p>
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
            has a Naba-Lens account, a sign-in link is on its way. Open it on
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
              <AlertDescription className="text-pretty">
                {notice}
              </AlertDescription>
            </Alert>
          ) : null}
          <FieldGroup>
            <Field className="gap-1.5" data-invalid={emailError || undefined}>
              <FieldLabel htmlFor={inputId}>Email</FieldLabel>
              <Input
                id={inputId}
                type="email"
                inputMode="email"
                autoComplete="email"
                spellCheck={false}
                value={email}
                onChange={(e) => setEmail(e.currentTarget.value)}
                aria-invalid={emailError || undefined}
                aria-describedby={emailError ? errorId : undefined}
                className="h-11 sm:h-10"
              />
              {emailError ? (
                <FieldError id={errorId}>{error}</FieldError>
              ) : null}
            </Field>
            {error && !emailError ? (
              <Alert variant="warning">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}
            {requiresCaptcha ? (
              captchaSiteKey ? (
                <TurnstileChallenge
                  key={challengeAttempt}
                  siteKey={captchaSiteKey}
                  onToken={handleCaptchaToken}
                />
              ) : (
                <Alert variant="warning">
                  <AlertDescription>
                    {CAPTCHA_UNAVAILABLE_MESSAGE}
                  </AlertDescription>
                </Alert>
              )
            ) : null}
            <Button
              type="submit"
              size="touch"
              className="sm:h-10"
              disabled={
                state === "sending" || (requiresCaptcha && !captchaToken)
              }
              aria-busy={state === "sending"}
            >
              {state === "sending" ? "Sending…" : "Send sign-in link"}
            </Button>
          </FieldGroup>
        </form>
      )}
    </section>
  )
}
