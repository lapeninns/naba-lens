"use client"

import * as React from "react"
import { SpinnerGapIcon, WarningCircleIcon } from "@phosphor-icons/react"

import { Button } from "@/components/ui/button"
import { Field, FieldError, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  CAPTCHA_RETRY_MESSAGE,
  CAPTCHA_UNAVAILABLE_MESSAGE,
} from "@/lib/auth/captcha"
import {
  normaliseSignInCode,
  SIGN_IN_CODE_FORMAT_MESSAGE,
} from "@/lib/auth/magic-link"
import { cn } from "@/lib/utils"
import { Notice } from "./notice"
import { TurnstileChallenge } from "./turnstile-challenge"

/** Matches the hosted default `max_frequency` between sign-in emails. */
export const RESEND_COOLDOWN_SECONDS = 60

// Long enough for any configured otp_length (6–10) plus spaces or dashes.
const MAX_CODE_DIGITS = 10

export type SignInCodeStepProps = {
  /** When the email being waited for was requested (epoch ms). */
  sentAt: number
  /**
   * Checks the code. Resolve without `error` once signed in; the step then
   * stays busy while the caller moves on.
   */
  onVerify: (code: string) => Promise<{ error?: string } | void>
  /** Sends a new link and code (the same request as the first). */
  onResend: (captchaToken?: string) => Promise<{ error?: string } | void>
  /** Back to the email field, keeping what was typed. */
  onChangeEmail?: () => void
  captchaRequired?: boolean
  captchaSiteKey?: string | null
  className?: string
}

function sentTime(at: number) {
  return new Date(at).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  })
}

function digitsOnly(value: string) {
  return value.replace(/\D/g, "").slice(0, MAX_CODE_DIGITS)
}

/**
 * The waiting step after a sign-in email: enter the code from it (typed, pasted
 * or offered by the phone's keyboard), send a new one after a short wait, or
 * use a different email. The code is only ever passed to `onVerify`; it never
 * goes into a URL, a log or an event.
 */
export function SignInCodeStep({
  sentAt: firstSentAt,
  onVerify,
  onResend,
  onChangeEmail,
  captchaRequired = false,
  captchaSiteKey,
  className,
}: SignInCodeStepProps) {
  const [code, setCode] = React.useState("")
  const [state, setState] = React.useState<"idle" | "checking" | "verified">(
    "idle"
  )
  const [error, setError] = React.useState<string | null>(null)
  const [sentAt, setSentAt] = React.useState(firstSentAt)
  const [resent, setResent] = React.useState(false)
  const [resending, setResending] = React.useState(false)
  const [resendError, setResendError] = React.useState<string | null>(null)
  const [now, setNow] = React.useState(() => Date.now())
  const [captchaToken, setCaptchaToken] = React.useState<string | null>(null)
  const [challengeAttempt, setChallengeAttempt] = React.useState(0)
  const requiresCaptcha = captchaRequired || !!captchaSiteKey
  const inputId = React.useId()
  const errorId = React.useId()
  const waitId = React.useId()
  const codeInput = React.useRef<HTMLInputElement>(null)

  const waitSeconds = Math.max(
    0,
    Math.ceil((sentAt + RESEND_COOLDOWN_SECONDS * 1000 - now) / 1000)
  )
  const coolingDown = waitSeconds > 0

  React.useEffect(() => {
    if (!coolingDown) return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [coolingDown])

  const handleCaptchaToken = React.useCallback((token: string | null) => {
    setCaptchaToken(token)
    if (token) {
      setResendError((current) =>
        current === CAPTCHA_RETRY_MESSAGE ? null : current
      )
    }
  }, [])

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (state !== "idle") return
    const value = normaliseSignInCode(code)
    if (!value) {
      setError(SIGN_IN_CODE_FORMAT_MESSAGE)
      codeInput.current?.focus()
      return
    }
    setError(null)
    setState("checking")
    try {
      const result = await onVerify(value)
      if (result?.error) {
        setError(result.error)
        setState("idle")
        codeInput.current?.focus()
        return
      }
      setState("verified")
    } catch {
      setError(
        "We couldn't reach Naba-Lens. Check your connection and try again."
      )
      setState("idle")
    }
  }

  async function resend() {
    if (coolingDown || resending) return
    if (requiresCaptcha && !captchaSiteKey) {
      setResendError(CAPTCHA_UNAVAILABLE_MESSAGE)
      return
    }
    if (requiresCaptcha && !captchaToken) {
      setResendError(CAPTCHA_RETRY_MESSAGE)
      return
    }
    setResending(true)
    setResendError(null)
    try {
      const result = requiresCaptcha
        ? await onResend(captchaToken!)
        : await onResend()
      if (result?.error) {
        setResendError(result.error)
        return
      }
      const at = Date.now()
      setSentAt(at)
      setNow(at)
      setResent(true)
      setCode("")
      setError(null)
    } catch {
      setResendError(
        "We couldn't reach Naba-Lens. Check your connection, then send it again."
      )
    } finally {
      setResending(false)
      // Turnstile tokens are single-use, including after a failed request.
      if (requiresCaptcha) {
        setCaptchaToken(null)
        setChallengeAttempt((attempt) => attempt + 1)
      }
    }
  }

  const busy = state !== "idle"
  const describedBy = error ? errorId : undefined

  return (
    <div className={cn("grid gap-5", className)}>
      <form onSubmit={submit} noValidate className="grid gap-3">
        <Field className="gap-1.5">
          <FieldLabel
            htmlFor={inputId}
            className="text-label-touch font-semibold text-ink md:text-label"
          >
            Sign-in code
          </FieldLabel>
          <Input
            ref={codeInput}
            id={inputId}
            name="code"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]*"
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            value={code}
            readOnly={busy}
            onChange={(e) => setCode(digitsOnly(e.currentTarget.value))}
            onPaste={(e) => {
              // Pasting "Your code: 123 456" keeps only the digits.
              e.preventDefault()
              if (busy) return
              setCode(digitsOnly(e.clipboardData.getData("text")))
            }}
            aria-invalid={error ? true : undefined}
            aria-describedby={describedBy}
            className="min-h-13 rounded-touch border-line-control bg-panel px-3 font-mono text-body-touch tracking-[0.2em] text-ink aria-invalid:border-negative md:min-h-9 md:rounded-control md:text-body dark:bg-panel"
          />
          {error ? (
            <FieldError
              id={errorId}
              className="flex items-start gap-1.5 text-meta-touch font-semibold text-negative md:text-meta-strong"
            >
              <WarningCircleIcon
                className="mt-0.5 size-4 shrink-0"
                aria-hidden
              />
              <span>{error}</span>
            </FieldError>
          ) : null}
        </Field>
        <Button
          type="submit"
          size="touch"
          className="w-full"
          disabled={busy}
          aria-busy={busy}
        >
          {busy ? (
            <SpinnerGapIcon
              data-icon="inline-start"
              className="motion-safe:animate-spin"
              aria-hidden
            />
          ) : null}
          {busy ? "Signing in…" : "Sign in with code"}
        </Button>
      </form>

      <div className="grid gap-3">
        {resent ? (
          <Notice tone="positive" role="status">
            New link and code sent at {sentTime(sentAt)}. Use the newest sign-in
            email you have. Older ones may stop working.
          </Notice>
        ) : (
          <p className="text-meta-touch text-pretty text-ink-muted md:text-meta">
            Sent at {sentTime(sentAt)}. Use the newest sign-in email you have.
            Older ones may stop working.
          </p>
        )}
        {resendError ? <Notice tone="negative">{resendError}</Notice> : null}
        {!coolingDown && requiresCaptcha ? (
          captchaSiteKey ? (
            <TurnstileChallenge
              key={challengeAttempt}
              siteKey={captchaSiteKey}
              onToken={handleCaptchaToken}
            />
          ) : (
            <Notice tone="negative">{CAPTCHA_UNAVAILABLE_MESSAGE}</Notice>
          )
        ) : null}
        <Button
          type="button"
          variant="secondary"
          size="touch"
          className="w-full"
          onClick={resend}
          disabled={
            busy ||
            coolingDown ||
            resending ||
            (requiresCaptcha && !captchaToken)
          }
          aria-busy={resending}
          aria-describedby={coolingDown ? waitId : undefined}
        >
          {resending ? "Sending…" : "Send a new code"}
        </Button>
        {coolingDown ? (
          <p
            id={waitId}
            className="text-center text-meta-touch text-ink-muted md:text-meta"
          >
            You can ask for a new one in {waitSeconds}{" "}
            {waitSeconds === 1 ? "second" : "seconds"}.
          </p>
        ) : null}
        {onChangeEmail ? (
          <Button
            type="button"
            variant="quiet"
            size="touch"
            className="w-full"
            disabled={busy}
            onClick={onChangeEmail}
          >
            Use a different email
          </Button>
        ) : null}
      </div>
    </div>
  )
}
