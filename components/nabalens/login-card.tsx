"use client"

import * as React from "react"
import {
  EnvelopeSimpleIcon,
  SpinnerGapIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react"

import {
  SIGN_IN_CARD,
  SignInCard,
  SignInHeading,
  SignInWordmark,
} from "@/app/login/sign-in-frame"
import { Button } from "@/components/ui/button"
import { Field, FieldError, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  CAPTCHA_RETRY_MESSAGE,
  CAPTCHA_UNAVAILABLE_MESSAGE,
} from "@/lib/auth/captcha"
import {
  clearPendingSignIn,
  forgetSignIns,
  lastSignInSent,
  pendingSignIn,
  recordSignInSent,
} from "@/lib/auth/pending-sign-in"
import { cn } from "@/lib/utils"
import { Notice } from "./notice"
import { RESEND_COOLDOWN_SECONDS, SignInCodeStep } from "./sign-in-code-step"
import { TurnstileChallenge } from "./turnstile-challenge"

function BusyIcon() {
  return (
    <SpinnerGapIcon
      data-icon="inline-start"
      className="motion-safe:animate-spin"
      aria-hidden
    />
  )
}

type LoginCardProps = {
  /**
   * Request a magic link. Resolve for any known or unknown email (neutral
   * response); return `{ error }` only for failures the user can act on.
   */
  onSubmit: (
    email: string,
    captchaToken?: string
  ) => Promise<{ error?: string } | void>
  /**
   * Sign in with the code from the email. Return `{ ok: true }` once signed in
   * (the card then loads "/" so role routing runs), or `{ error }`.
   */
  onVerifyCode?: (
    email: string,
    code: string
  ) => Promise<{ error?: string; ok?: true }>
  captchaRequired?: boolean
  captchaSiteKey?: string | null
  /** The previous link was expired or already used. */
  linkExpired?: boolean
  /** Arrived here by logging out. */
  signedOut?: boolean
  className?: string
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const EMAIL_ERROR = "Enter a full email address, like name@example.com."
const CODE_FALLBACK_ERROR = "That code didn't work. Try again."
/** How long a waiting code step survives a reload (the local otp_expiry). */
export const PENDING_SIGN_IN_MS = 60 * 60 * 1000

export function LoginCard({
  onSubmit,
  onVerifyCode,
  linkExpired = false,
  signedOut = false,
  captchaRequired = false,
  captchaSiteKey,
  className,
}: LoginCardProps) {
  const [email, setEmail] = React.useState("")
  const [state, setState] = React.useState<"idle" | "sending" | "sent">("idle")
  const [sentAt, setSentAt] = React.useState(0)
  // Once a new link is on its way, "Use a different email" returns to Sign in.
  const [expired, setExpired] = React.useState(linkExpired)
  const [error, setError] = React.useState<string | null>(null)
  const [unreachable, setUnreachable] = React.useState(false)
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
  const titleId = `${inputId}-title`
  const sentHeading = React.useRef<HTMLHeadingElement>(null)
  const emailInput = React.useRef<HTMLInputElement>(null)
  const returning = React.useRef(false)

  // A phone may reload /login while the person reads their email: come back
  // to the code step for that request instead of sending another. After
  // mount only, so the server render and hydration match.
  React.useEffect(() => {
    // Arriving from an expired link or a log out starts from the email form.
    if (!onVerifyCode || linkExpired || signedOut) return
    const pending = pendingSignIn(PENDING_SIGN_IN_MS)
    if (!pending) return
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setEmail(pending.email)
    setSentAt(pending.sentAt)
    setExpired(false)
    setState("sent")
  }, [onVerifyCode, linkExpired, signedOut])

  React.useEffect(() => {
    if (state === "sent") sentHeading.current?.focus()
    else if (state === "idle" && returning.current) {
      returning.current = false
      emailInput.current?.focus()
    }
  }, [state])

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
    setUnreachable(false)
    // Within the resend wait for this address (after "Use a different email"),
    // nothing new would arrive: return to that request's step instead. After an
    // expired or used link the earlier email is spent, so always ask again.
    const last = expired ? null : lastSignInSent(value)
    if (last !== null && Date.now() - last < RESEND_COOLDOWN_SECONDS * 1000) {
      if (onVerifyCode) recordSignInSent(value, last, { pending: true })
      setExpired(false)
      setSentAt(last)
      setState("sent")
      return
    }
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
      const at = Date.now()
      recordSignInSent(value, at, { pending: !!onVerifyCode })
      setExpired(false)
      setSentAt(at)
      setState("sent")
    } catch {
      setUnreachable(true)
      setState("idle")
    } finally {
      // Turnstile tokens are single-use, including after a failed request.
      if (requiresCaptcha) {
        setCaptchaToken(null)
        setChallengeAttempt((attempt) => attempt + 1)
      }
    }
  }

  function changeEmail() {
    clearPendingSignIn()
    returning.current = true
    setState("idle")
    setError(null)
  }

  if (state === "sent") {
    const sentTo = email.trim()
    return (
      <SignInCard aria-labelledby={titleId} className={className}>
        <div role="status" className="grid gap-5">
          <EnvelopeSimpleIcon className="size-8 text-ink-muted" aria-hidden />
          <SignInHeading
            id={titleId}
            title="Check your email"
            headingRef={sentHeading}
          >
            If <strong>{sentTo}</strong> has an account, a sign-in link is on
            its way.{" "}
            {onVerifyCode
              ? "Open the link on this phone, or enter the code from the same email here. Each works once."
              : "It works once. Open it on this phone to stay signed in here."}
          </SignInHeading>
        </div>
        {onVerifyCode ? (
          <SignInCodeStep
            sentAt={sentAt}
            captchaRequired={captchaRequired}
            captchaSiteKey={captchaSiteKey}
            onVerify={async (code) => {
              const result = await onVerifyCode(sentTo, code)
              if (result.error || !result.ok) {
                return { error: result.error ?? CODE_FALLBACK_ERROR }
              }
              forgetSignIns()
              // A full load, so "/" routes by role with the new session cookies
              // (the Server Function cannot redirect() inside the step's catch).
              // eslint-disable-next-line @next/next/no-location-assign-relative-destination
              window.location.assign("/")
            }}
            onResend={async (token) => {
              const result = requiresCaptcha
                ? await onSubmit(sentTo, token)
                : await onSubmit(sentTo)
              if (!result?.error)
                recordSignInSent(sentTo, Date.now(), { pending: true })
              return result ?? undefined
            }}
            onChangeEmail={changeEmail}
          />
        ) : (
          <Button
            variant="secondary"
            size="touch"
            className="w-full"
            onClick={changeEmail}
          >
            Use a different email
          </Button>
        )}
      </SignInCard>
    )
  }

  const sending = state === "sending"
  return (
    <form
      onSubmit={submit}
      noValidate
      aria-labelledby={titleId}
      className={cn(SIGN_IN_CARD, className)}
    >
      <SignInWordmark />
      {unreachable ? (
        <Notice tone="negative" title="We couldn't reach Naba-Lens">
          Check your connection, then send the link again. Nothing is sent
          twice.
        </Notice>
      ) : signedOut && !expired ? (
        <Notice tone="positive">You have signed out.</Notice>
      ) : null}
      {expired ? (
        <SignInHeading id={titleId} title="That sign-in link has expired">
          Links work once and expire after a short time. We&apos;ll send a new
          one to this email.
        </SignInHeading>
      ) : (
        <SignInHeading id={titleId} title="Sign in">
          We&apos;ll email you a link and a code. There&apos;s no password.
        </SignInHeading>
      )}
      <Field className="gap-1.5">
        <FieldLabel
          htmlFor={inputId}
          className="text-label-touch font-semibold text-ink md:text-label"
        >
          Email
        </FieldLabel>
        <Input
          ref={emailInput}
          id={inputId}
          type="email"
          inputMode="email"
          autoComplete="email"
          spellCheck={false}
          placeholder="name@example.com"
          value={email}
          onChange={(e) => setEmail(e.currentTarget.value)}
          aria-invalid={emailError || undefined}
          aria-describedby={emailError ? errorId : undefined}
          className="min-h-13 rounded-touch border-line-control bg-panel px-3 text-body-touch text-ink placeholder:text-ink-subtle aria-invalid:border-negative md:min-h-9 md:rounded-control md:text-body dark:bg-panel"
        />
        {emailError ? (
          <FieldError
            id={errorId}
            className="flex items-start gap-1.5 text-meta-touch font-semibold text-negative md:text-meta-strong"
          >
            <WarningCircleIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span>{error}</span>
          </FieldError>
        ) : null}
      </Field>
      {error && !emailError ? <Notice tone="negative">{error}</Notice> : null}
      {requiresCaptcha ? (
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
        type="submit"
        size="touch"
        className="w-full"
        disabled={sending || (requiresCaptcha && !captchaToken)}
        aria-busy={sending}
      >
        {sending ? <BusyIcon /> : null}
        {sending
          ? "Sending…"
          : expired
            ? "Send a new link"
            : "Send sign-in link"}
      </Button>
      {expired ? null : (
        <p className="text-center text-meta-touch text-ink-muted md:text-meta">
          Accounts are by invitation only.
        </p>
      )}
    </form>
  )
}

/**
 * Continue on the email link's landing page. The page's form is a plain HTML
 * POST, so it works without JavaScript; with it, this shows progress and stops
 * a second press from sending the one-time token again.
 */
export function ConfirmSignInButton({ invite }: { invite: boolean }) {
  const button = React.useRef<HTMLButtonElement>(null)
  const [pending, setPending] = React.useState(false)

  React.useEffect(() => {
    const form = button.current?.form
    if (!form) return
    let submitted = false
    const onSubmit = (event: SubmitEvent) => {
      if (submitted) event.preventDefault()
      submitted = true
      setPending(true)
    }
    // Back restores the page from the bfcache mid-submit.
    const onPageShow = (event: PageTransitionEvent) => {
      if (!event.persisted) return
      submitted = false
      setPending(false)
    }
    form.addEventListener("submit", onSubmit)
    window.addEventListener("pageshow", onPageShow)
    return () => {
      form.removeEventListener("submit", onSubmit)
      window.removeEventListener("pageshow", onPageShow)
    }
  }, [])

  return (
    <Button
      ref={button}
      type="submit"
      size="touch"
      className="w-full"
      aria-busy={pending}
      aria-disabled={pending || undefined}
    >
      {pending ? <BusyIcon /> : null}
      {pending ? "Signing in…" : invite ? "Accept your invitation" : "Continue"}
    </Button>
  )
}
