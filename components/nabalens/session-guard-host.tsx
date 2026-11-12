"use client"

import * as React from "react"
import { useRouter } from "next/navigation"

import { CAPTCHA_RETRY_MESSAGE } from "@/lib/auth/captcha"
import { sendSignInLink, signInWithCode } from "@/lib/auth/magic-link"
import {
  isSessionEndedError,
  SESSION_ENDED_MESSAGE,
} from "@/lib/auth/session-ended"
import { createClient } from "@/lib/supabase/browser"
import { getSiteUrl } from "@/lib/supabase/env"

import {
  SessionGuardProvider,
  SignInAgainSheet,
  useSignedInAgain,
  type SessionGuard,
} from "./session-guard"

/** While the page is in view, an ended session is noticed within this. */
const CHECK_EVERY_MS = 30_000
/** A signed-out reading is confirmed once before the sheet opens. */
const CONFIRM_AFTER_MS = 1_000
/** The sheet's exit (--duration-sheet, 260 ms) with room to spare. */
const REFRESH_FALLBACK_MS = 1_000

/**
 * The browser side of a session guard: who is signed in (kept through expiry
 * so a sign-in link can still be offered), and the sign-in requests made from
 * the browser, because a Server Action posted while signed out never runs
 * (proxy.ts answers 401). `onSignedOut` hears the auth client's own sign-out.
 */
export function useBrowserSessionGuard({
  captchaRequired,
  captchaSiteKey,
  onSignedOut,
}: {
  captchaRequired: boolean
  captchaSiteKey: string | null
  onSignedOut?: () => void
}): SessionGuard {
  // Who is signed in lives in a ref, read through getters, so the guard
  // itself never changes when the auth client reports the session. A new
  // context value above a streamed Suspense boundary that is still waiting for
  // its content makes React render that boundary again in the browser and
  // leave the server's copy behind (the page shows twice). The state only
  // re-renders the owner, which then reads the new values.
  const identity = React.useRef<{
    email: string | null
    userId: string | null
  }>({ email: null, userId: null })
  const [, identityChanged] = React.useReducer((n: number) => n + 1, 0)
  const supabase = React.useMemo(() => createClient(), [])
  const signedOut = React.useRef(onSignedOut)
  React.useEffect(() => {
    signedOut.current = onSignedOut
  })

  React.useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_OUT") signedOut.current?.()
      if (!session) return
      identity.current = {
        email: session.user.email ?? null,
        // Keep the first identity: the page belongs to it, even if another
        // account signs in later in this browser.
        userId: identity.current.userId ?? session.user.id,
      }
      identityChanged()
    })
    return () => data.subscription.unsubscribe()
  }, [supabase])

  return React.useMemo<SessionGuard>(() => {
    const userId = () => identity.current.userId
    return {
      get email() {
        return identity.current.email
      },
      get userId() {
        return identity.current.userId
      },
      captchaRequired,
      captchaSiteKey,
      // The same request the login page makes (never creates an account).
      sendLink: async (to, captchaToken) => {
        const result = await sendSignInLink(
          supabase,
          to,
          `${getSiteUrl()}/auth/callback`,
          captchaToken
        )
        return result.status === "captcha_failed"
          ? { error: CAPTCHA_RETRY_MESSAGE }
          : {}
      },
      verifyCode: (to, code) => signInWithCode(supabase, to, code),
      // Reads the session from this browser's auth cookies (refreshing it if
      // needed); the server still re-authorises every request.
      isSignedIn: async () => {
        if (navigator.onLine === false) return true
        const { data, error } = await supabase.auth.getSession()
        const id = userId()
        if (data.session) return !id || data.session.user.id === id
        return error?.name === "AuthRetryableFetchError"
      },
      isSignedInAgain: async () => {
        const { data } = await supabase.auth.getSession()
        const id = userId()
        return !!data.session && (!id || data.session.user.id === id)
      },
    }
  }, [captchaRequired, captchaSiteKey, supabase])
}

const ReportSessionEnded = React.createContext<() => void>(() => {})
const ClaimSignIn = React.createContext<
  ((id: string, claimed: boolean) => void) | null
>(null)

/**
 * For a screen with its own Sign in again (the upload sheet, which resumes
 * its uploads once signed in): while `claimed` (its own Sign in again is
 * showing), the page's stays closed, so the two never show together. After a
 * claim ends, only an action refused for the session opens the page's. A
 * no-op outside the host.
 */
export function useClaimSignIn(claimed: boolean) {
  const claim = React.useContext(ClaimSignIn)
  const id = React.useId()
  React.useEffect(() => {
    if (!claim) return
    claim(id, claimed)
    return () => claim(id, false)
  }, [claim, id, claimed])
}

/**
 * For a screen whose action failed with `isSessionEndedError`: opens Sign in
 * again even after the person chose "Not now". A no-op outside the host.
 */
export function useReportSessionEnded() {
  return React.useContext(ReportSessionEnded)
}

/**
 * For an action's catch: when the action was refused for the ended session,
 * reports it (Sign in again opens, even after "Not now") and returns the copy
 * to show in place of a lost-connection message; otherwise null. A load can
 * ignore the copy and keep its own.
 */
export function useSessionEndedCatch() {
  const report = useReportSessionEnded()
  return React.useCallback(
    (error: unknown): string | null => {
      if (!isSessionEndedError(error)) return null
      report()
      return SESSION_ENDED_MESSAGE
    },
    [report]
  )
}

/**
 * Keeps an app area usable through an ended session. When the browser is
 * found signed out (the auth client says so, the tab comes back into view or
 * online, a tap or submit, every 30 s in view, or an action refused for it),
 * Sign in again opens over the page, so what was typed stays. Signing in with
 * the code, or with the link in another tab, closes it and refreshes the
 * page's data; the person then repeats what they tried. "Not now" keeps it
 * closed until an action is refused for the ended session.
 */
export function SessionGuardHost({
  captchaRequired,
  captchaSiteKey,
  children,
}: {
  captchaRequired: boolean
  captchaSiteKey: string | null
  children: React.ReactNode
}) {
  const router = useRouter()
  const [open, setOpen] = React.useState(false)
  const shown = React.useRef(false)
  const quiet = React.useRef(false)
  const checking = React.useRef(false)
  // An action refused for the ended session, seen by a check already running.
  const refused = React.useRef(false)
  const check = React.useRef<(refused: boolean) => Promise<void>>(
    async () => {}
  )
  const claims = React.useRef(new Set<string>())
  const claim = React.useCallback((id: string, claimed: boolean) => {
    if (!claimed) {
      // The screen's own Sign in again was dismissed (or signed in): like the
      // page's "Not now", only an action refused for the session reopens.
      if (claims.current.delete(id)) quiet.current = true
      return
    }
    claims.current.add(id)
    if (!shown.current) return
    shown.current = false
    setOpen(false)
  }, [])

  const guard = useBrowserSessionGuard({
    captchaRequired,
    captchaSiteKey,
    onSignedOut: () => void check.current(false),
  })

  React.useEffect(() => {
    check.current = async (wasRefused) => {
      if (wasRefused) refused.current = true
      if (shown.current || checking.current || claims.current.size > 0) return
      checking.current = true
      // Unsure (offline, auth server unreachable) counts as signed in: a lost
      // signal is never shown as a sign-out.
      const signedIn = () => guard.isSignedIn().catch(() => true)
      try {
        if (await signedIn()) {
          quiet.current = false
          refused.current = false
          return
        }
        if (quiet.current && !refused.current) return
        // A cookie being rewritten can read as signed out once.
        await new Promise((resolve) => setTimeout(resolve, CONFIRM_AFTER_MS))
        if ((await signedIn()) || claims.current.size > 0) return
        shown.current = true
        refused.current = false
        setOpen(true)
      } finally {
        checking.current = false
      }
    }
  }, [guard])

  React.useEffect(() => {
    const run = () => void check.current(false)
    // Every tap and submit: the check reads this browser's cookies, so it is
    // cheap, and the tap that saves is the one that must find the ended session.
    const onInteraction = run
    const onVisible = () => {
      if (document.visibilityState === "visible") run()
    }
    const onRejection = (event: PromiseRejectionEvent) => {
      if (isSessionEndedError(event.reason)) void check.current(true)
    }
    document.addEventListener("pointerdown", onInteraction, true)
    document.addEventListener("submit", onInteraction, true)
    document.addEventListener("visibilitychange", onVisible)
    window.addEventListener("focus", run)
    window.addEventListener("online", run)
    window.addEventListener("unhandledrejection", onRejection)
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") run()
    }, CHECK_EVERY_MS)
    return () => {
      document.removeEventListener("pointerdown", onInteraction, true)
      document.removeEventListener("submit", onInteraction, true)
      document.removeEventListener("visibilitychange", onVisible)
      window.removeEventListener("focus", run)
      window.removeEventListener("online", run)
      window.removeEventListener("unhandledrejection", onRejection)
      window.clearInterval(timer)
    }
  }, [])

  // Server data for the new session; client state (form input) is kept. The
  // refresh waits until the sheet has closed and handed focus back, so a
  // refreshed page cannot remove the element focus is returning to first.
  // A fallback runs it anyway if the close never completes (an exit
  // animation stalled in a hidden tab), and at once if no sheet was open.
  const refreshPending = React.useRef(false)
  const refreshFallback = React.useRef<number | null>(null)
  const openRef = React.useRef(open)
  React.useEffect(() => {
    openRef.current = open
  }, [open])
  const runPendingRefresh = React.useCallback(() => {
    if (refreshFallback.current !== null) {
      window.clearTimeout(refreshFallback.current)
      refreshFallback.current = null
    }
    if (!refreshPending.current) return
    refreshPending.current = false
    router.refresh()
  }, [router])
  React.useEffect(
    () => () => {
      if (refreshFallback.current !== null)
        window.clearTimeout(refreshFallback.current)
    },
    []
  )

  const signedInAgain = React.useCallback(() => {
    shown.current = false
    quiet.current = false
    refreshPending.current = true
    if (!openRef.current) {
      runPendingRefresh()
      return
    }
    setOpen(false)
    if (refreshFallback.current === null)
      refreshFallback.current = window.setTimeout(
        runPendingRefresh,
        REFRESH_FALLBACK_MS
      )
  }, [runPendingRefresh])
  useSignedInAgain(open, guard.isSignedInAgain, signedInAgain)

  const onOpenChange = React.useCallback((next: boolean) => {
    if (!next) {
      shown.current = false
      quiet.current = true
    }
    setOpen(next)
  }, [])

  const report = React.useCallback(() => void check.current(true), [])

  return (
    <SessionGuardProvider value={guard}>
      <ReportSessionEnded.Provider value={report}>
        <ClaimSignIn.Provider value={claim}>{children}</ClaimSignIn.Provider>
        <SignInAgainSheet
          open={open}
          onOpenChange={onOpenChange}
          guard={guard}
          variant="page"
          onSignedIn={signedInAgain}
          onClosed={() => {
            // Base UI reports the close complete while the popup is still
            // mounted; it unmounts and returns focus (commit + microtask)
            // right after. One task later, focus is back where it came from.
            window.setTimeout(runPendingRefresh, 0)
          }}
        />
      </ReportSessionEnded.Provider>
    </SessionGuardProvider>
  )
}
