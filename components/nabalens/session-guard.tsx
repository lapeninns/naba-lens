"use client"

import * as React from "react"

import { Button, buttonVariants } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

import { CAPTCHA_UNAVAILABLE_MESSAGE } from "@/lib/auth/captcha"
import { lastSignInSent, recordSignInSent } from "@/lib/auth/pending-sign-in"
import { loginHref } from "@/lib/auth/routes"

import { Notice } from "./notice"
import { RESEND_COOLDOWN_SECONDS, SignInCodeStep } from "./sign-in-code-step"
import { TurnstileChallenge } from "./turnstile-challenge"

/**
 * What a page needs to recover from an ended session without leaving: who to
 * send the sign-in link to, how to send it (the login page's own action), and a
 * cheap check of whether this browser is signed in again.
 */
export type SessionGuard = {
  email: string | null
  /**
   * Who the page's work belongs to (the first signed-in user seen). A code that
   * signs in anyone else does not resume it.
   */
  userId?: string | null
  captchaRequired: boolean
  captchaSiteKey: string | null
  sendLink: (
    email: string,
    captchaToken?: string
  ) => Promise<{ error?: string }>
  /**
   * Resolves false only when the browser is known to be signed out. Offline or
   * unsure resolves true, so a lost signal is never mistaken for a sign-out.
   */
  isSignedIn: () => Promise<boolean>
  /**
   * Signs this browser in with the code from the sign-in email and resolves the
   * signed-in user's id, or `{ error }`. Without it the sheet offers the link
   * only.
   */
  verifyCode?: (
    email: string,
    code: string
  ) => Promise<{ error?: string; userId?: string }>
}

export const DIFFERENT_ACCOUNT_MESSAGE =
  "That code signed in a different account, so the stopped files were not resumed. Reload the page to continue as that account."
export const DIFFERENT_ACCOUNT_PAGE_MESSAGE =
  "That code signed in a different account. Reload the page to continue as that account."

const SessionGuardContext = React.createContext<SessionGuard | null>(null)

export function SessionGuardProvider({
  value,
  children,
}: {
  value: SessionGuard
  children: React.ReactNode
}) {
  return (
    <SessionGuardContext.Provider value={value}>
      {children}
    </SessionGuardContext.Provider>
  )
}

export function useSessionGuard() {
  return React.useContext(SessionGuardContext)
}

/**
 * Calls `onSignedIn` once the browser is signed in again: checked when the tab
 * comes back into view or gets focus (the link opens in another tab) and every
 * few seconds while `active`.
 */
export function useSignedInAgain(
  active: boolean,
  isSignedIn: (() => Promise<boolean>) | undefined,
  onSignedIn: () => void
) {
  const latest = React.useRef(onSignedIn)
  React.useEffect(() => {
    latest.current = onSignedIn
  })
  React.useEffect(() => {
    if (!active || !isSignedIn) return
    let stopped = false
    const check = async () => {
      if (await isSignedIn().catch(() => false)) {
        if (!stopped) latest.current()
      }
    }
    const onVisible = () => {
      if (document.visibilityState === "visible") void check()
    }
    window.addEventListener("focus", check)
    document.addEventListener("visibilitychange", onVisible)
    const timer = window.setInterval(check, 3000)
    return () => {
      stopped = true
      window.removeEventListener("focus", check)
      document.removeEventListener("visibilitychange", onVisible)
      window.clearInterval(timer)
    }
  }, [active, isSignedIn])
}

function count(n: number, one: string, many: string) {
  return `${n} ${n === 1 ? one : many}`
}

/**
 * E7 Sign in again: a sheet over the page that sends a sign-in link, so the
 * page, and anything waiting on it, stays where it is. `uploads` speaks about
 * the files the ended session stopped; `page` about the page itself (what was
 * typed stays, what was tried while signed out was not saved).
 */
export function SignInAgainSheet({
  open,
  onOpenChange,
  guard,
  done = 0,
  stopped = 0,
  onSignedIn,
  variant = "uploads",
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  guard: SessionGuard
  /**
   * The same person signed in again with a code: resume what was waiting. The
   * sheet closes itself when this is not given.
   */
  onSignedIn?: () => void
  /** Files that finished before the session ended. */
  done?: number
  /** Files that stopped because of it. */
  stopped?: number
  variant?: "uploads" | "page"
}) {
  const page = variant === "page"
  const [sending, setSending] = React.useState(false)
  const [sent, setSent] = React.useState(false)
  const [sentAt, setSentAt] = React.useState(0)
  const [error, setError] = React.useState<string | null>(null)
  const [captchaToken, setCaptchaToken] = React.useState<string | null>(null)
  const [challengeAttempt, setChallengeAttempt] = React.useState(0)
  const needsCaptcha = guard.captchaRequired || !!guard.captchaSiteKey
  const captchaUnavailable = needsCaptcha && !guard.captchaSiteKey

  // Signing in from a new tab comes back to this page.
  const [loginLink, setLoginLink] = React.useState<string>(loginHref())

  React.useEffect(() => {
    if (open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLoginLink(loginHref(window.location.pathname + window.location.search))
      return
    }
    // Each time the sheet opens it starts from the request, not the result.
    setSent(false)
    setError(null)
  }, [open])

  async function send() {
    if (!guard.email) return
    setError(null)
    // Reopened within the resend wait: nothing new would arrive, so go back to
    // the email already sent instead of claiming another.
    const last = lastSignInSent(guard.email)
    if (last !== null && Date.now() - last < RESEND_COOLDOWN_SECONDS * 1000) {
      setSentAt(last)
      setSent(true)
      return
    }
    setSending(true)
    try {
      const result = await guard.sendLink(
        guard.email,
        needsCaptcha ? (captchaToken ?? undefined) : undefined
      )
      if (result.error) setError(result.error)
      else {
        const at = Date.now()
        recordSignInSent(guard.email, at)
        setSentAt(at)
        setSent(true)
      }
    } catch {
      setError("Check your connection and try again. Nothing is sent twice.")
    } finally {
      setSending(false)
      // Turnstile tokens are single-use, including after a failed request.
      if (needsCaptcha) {
        setCaptchaToken(null)
        setChallengeAttempt((attempt) => attempt + 1)
      }
    }
  }

  const { email, userId, verifyCode } = guard
  const withCode = sent && !!email && !!verifyCode

  async function checkCode(code: string) {
    if (!email || !verifyCode) return
    const result = await verifyCode(email, code)
    if (result.error) return { error: result.error }
    if (userId && result.userId && result.userId !== userId) {
      return {
        error: page
          ? DIFFERENT_ACCOUNT_PAGE_MESSAGE
          : DIFFERENT_ACCOUNT_MESSAGE,
      }
    }
    if (onSignedIn) onSignedIn()
    else onOpenChange(false)
  }

  const summary = page
    ? "You were signed out, so anything you tried since then wasn't saved."
    : [
        "You were signed out after a while away.",
        done > 0
          ? `${count(done, "photo", "photos")} finished uploading and ${done === 1 ? "is" : "are"} safe.`
          : null,
        stopped > 0 ? `${stopped} stopped.` : null,
      ]
        .filter(Boolean)
        .join(" ")

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {sent ? "Check your email" : "Sign in again"}
          </DialogTitle>
          {withCode ? (
            <DialogDescription>
              If {guard.email} has an account, a sign-in link is on its way.
              Enter the code from the same email here to carry on, or open the
              link on this phone.
            </DialogDescription>
          ) : sent ? (
            <DialogDescription>
              If {guard.email} has an account, a sign-in link is on its way. It
              works once. Open it on this phone to stay signed in here.
            </DialogDescription>
          ) : page ? (
            guard.email ? (
              <DialogDescription>
                We&apos;ll send a sign-in link and code to{" "}
                <strong className="font-bold [overflow-wrap:anywhere] text-ink">
                  {guard.email}
                </strong>
                . Sign in here to carry on. This page stays open, with what
                you&apos;ve entered.
              </DialogDescription>
            ) : (
              <DialogDescription>
                Sign in again in a new tab, then come back here. This page stays
                open, with what you&apos;ve entered.
              </DialogDescription>
            )
          ) : guard.email ? (
            <DialogDescription>
              We&apos;ll send a sign-in link to{" "}
              <strong className="font-bold [overflow-wrap:anywhere] text-ink">
                {guard.email}
              </strong>
              . Open it on this phone, then choose the stopped{" "}
              {stopped === 1 ? "photo" : "photos"} again to finish{" "}
              {stopped === 1 ? "it" : "them"}. Nothing is sent twice.
            </DialogDescription>
          ) : (
            // Off-deck: no email on the profile, so sign in on /login instead.
            <DialogDescription>
              Sign in again in a new tab, then choose the stopped{" "}
              {stopped === 1 ? "photo" : "photos"} again to finish{" "}
              {stopped === 1 ? "it" : "them"}. Nothing is sent twice.
            </DialogDescription>
          )}
        </DialogHeader>
        {/* Common Room: what happened is information, not a warning. */}
        {sent ? null : (
          <Notice tone="info" role="status">
            {summary}
          </Notice>
        )}
        {error ? <Notice tone="negative">{error}</Notice> : null}
        {withCode ? (
          <SignInCodeStep
            sentAt={sentAt}
            captchaRequired={guard.captchaRequired}
            captchaSiteKey={guard.captchaSiteKey}
            onVerify={checkCode}
            onResend={async (token) => {
              const result = await guard.sendLink(email!, token)
              if (!result.error) recordSignInSent(email!, Date.now())
              return result
            }}
          />
        ) : null}
        {!sent && guard.email && needsCaptcha ? (
          guard.captchaSiteKey ? (
            <TurnstileChallenge
              key={challengeAttempt}
              siteKey={guard.captchaSiteKey}
              onToken={setCaptchaToken}
            />
          ) : (
            <Notice tone="negative">{CAPTCHA_UNAVAILABLE_MESSAGE}</Notice>
          )
        ) : null}
        <DialogFooter>
          <Button
            variant="secondary"
            size="touch"
            onClick={() => onOpenChange(false)}
          >
            {/* Off-deck: E7 lists only "Not now"; "Done" closes the sent state. */}
            {sent ? "Done" : "Not now"}
          </Button>
          {sent ? null : guard.email ? (
            <Button
              variant="primary"
              size="touch"
              onClick={send}
              disabled={
                sending || captchaUnavailable || (needsCaptcha && !captchaToken)
              }
              aria-busy={sending}
            >
              {sending ? "Sending…" : "Send sign-in link"}
            </Button>
          ) : (
            <a
              href={loginLink}
              target="_blank"
              rel="noopener"
              className={buttonVariants({ variant: "primary", size: "touch" })}
            >
              Sign in again
            </a>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
