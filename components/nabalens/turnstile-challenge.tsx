"use client"

import * as React from "react"
import Script from "next/script"

import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"

type TurnstileOptions = {
  sitekey: string
  size: "compact"
  "response-field": false
  callback: (token: string) => void
  "expired-callback": () => void
  "error-callback": () => void
  "timeout-callback": () => void
}

type Turnstile = {
  render: (container: HTMLElement, options: TurnstileOptions) => string
  remove: (widgetId: string) => void
  reset: (widgetId: string) => void
}

function api(): Turnstile | undefined {
  return (window as unknown as { turnstile?: Turnstile }).turnstile
}

export function TurnstileChallenge({
  siteKey,
  onToken,
}: {
  siteKey: string
  onToken: (token: string | null) => void
}) {
  const container = React.useRef<HTMLDivElement>(null)
  const widgetId = React.useRef<string | null>(null)
  const [ready, setReady] = React.useState(false)
  const [status, setStatus] = React.useState<
    "loading" | "checking" | "verified" | "expired" | "failed" | "unavailable"
  >("loading")

  React.useEffect(() => {
    if (ready) return
    const timer = window.setTimeout(() => setStatus("unavailable"), 15_000)
    return () => window.clearTimeout(timer)
  }, [ready])

  React.useEffect(() => {
    if (status !== "checking") return
    const timer = window.setTimeout(() => {
      onToken(null)
      setStatus("failed")
    }, 60_000)
    return () => window.clearTimeout(timer)
  }, [onToken, status])

  React.useEffect(() => {
    const turnstile = api()
    if (!ready || !turnstile || !container.current) return
    let active = true
    const invalidate = (next: "expired" | "failed") => {
      if (!active) return
      onToken(null)
      setStatus(next)
    }
    try {
      // next/script's onReady is the load boundary. Turnstile.ready() must not
      // be used with async/defer scripts, including Next's script loader.
      widgetId.current = turnstile.render(container.current, {
        sitekey: siteKey,
        // Compact stays within the sign-in card on narrow phones.
        size: "compact",
        // Tokens are passed only to the Server Function, never a DOM form field.
        "response-field": false,
        callback: (token) => {
          if (!active) return
          onToken(token)
          setStatus("verified")
        },
        "expired-callback": () => invalidate("expired"),
        "error-callback": () => invalidate("failed"),
        "timeout-callback": () => invalidate("failed"),
      })
    } catch {
      // Deliver a failed third-party initialization after the effect finishes.
      queueMicrotask(() => {
        if (!active) return
        onToken(null)
        setStatus("unavailable")
      })
    }
    return () => {
      active = false
      if (widgetId.current !== null) {
        turnstile.remove(widgetId.current)
        widgetId.current = null
      }
    }
  }, [onToken, ready, siteKey])

  function retry() {
    const turnstile = api()
    if (status === "unavailable" || !turnstile || widgetId.current === null) {
      window.location.reload()
      return
    }
    onToken(null)
    setStatus("checking")
    try {
      turnstile.reset(widgetId.current)
    } catch {
      setStatus("unavailable")
    }
  }

  const failed =
    status === "expired" || status === "failed" || status === "unavailable"
  return (
    <div className="grid gap-2" aria-label="Sign-in verification">
      <Script
        src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
        strategy="afterInteractive"
        onReady={() => {
          if (api()) {
            setStatus("checking")
            setReady(true)
          } else setStatus("unavailable")
        }}
        onError={() => {
          onToken(null)
          setStatus("unavailable")
        }}
      />
      <div ref={container} />
      <p className="text-sm text-muted-foreground" role="status">
        {status === "loading" ? "Loading sign-in verification…" : null}
        {status === "checking"
          ? "Complete the verification to continue."
          : null}
        {status === "verified" ? "Verification complete." : null}
      </p>
      {failed ? (
        <Alert variant="warning">
          <AlertDescription>
            {status === "unavailable"
              ? "Verification could not load. Reload this page to try again."
              : "Verification expired or could not finish. Please try again."}
            <Button type="button" variant="outline" size="sm" onClick={retry}>
              {status === "unavailable"
                ? "Reload verification"
                : "Retry verification"}
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}
    </div>
  )
}
