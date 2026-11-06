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

import { Notice } from "./notice"
import { TurnstileChallenge } from "./turnstile-challenge"

/**
 * What a page needs to recover from an ended session without leaving: who to
 * send the sign-in link to, how to send it (the login page's own action), and a
 * cheap check of whether this browser is signed in again.
 */
export type SessionGuard = {
  email: string | null
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
}

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
 * page, and anything waiting on it, stays where it is.
 */
export function SignInAgainSheet({
  open,
  onOpenChange,
  guard,
  done,
  stopped,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  guard: SessionGuard
  /** Files that finished before the session ended. */
  done: number
  /** Files that stopped because of it. */
  stopped: number
}) {
  const [sending, setSending] = React.useState(false)
  const [sent, setSent] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [captchaToken, setCaptchaToken] = React.useState<string | null>(null)
  const [challengeAttempt, setChallengeAttempt] = React.useState(0)
  const needsCaptcha = guard.captchaRequired || !!guard.captchaSiteKey
  const captchaUnavailable = needsCaptcha && !guard.captchaSiteKey

  React.useEffect(() => {
    if (open) return
    // Each time the sheet opens it starts from the request, not the result.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSent(false)
    setError(null)
  }, [open])

  async function send() {
    if (!guard.email) return
    setSending(true)
    setError(null)
    try {
      const result = await guard.sendLink(
        guard.email,
        needsCaptcha ? (captchaToken ?? undefined) : undefined
      )
      if (result.error) setError(result.error)
      else setSent(true)
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

  const summary = [
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
          {sent ? (
            <DialogDescription>
              If {guard.email} has an account, a sign-in link is on its way. It
              works once. Open it on this phone to stay signed in here.
            </DialogDescription>
          ) : guard.email ? (
            <DialogDescription>
              We&apos;ll send a sign-in link to{" "}
              <strong className="font-semibold text-ink">{guard.email}</strong>.
              Open it on this phone, then choose the stopped{" "}
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
        {sent ? null : (
          <Notice tone="attention" role="status">
            {summary}
          </Notice>
        )}
        {error ? <Notice tone="negative">{error}</Notice> : null}
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
              href="/login"
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
