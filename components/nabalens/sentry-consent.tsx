"use client"

import { useEffect } from "react"

import { sentryDataCollection } from "@/lib/observability/sentry-privacy"

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN

/** A future/owner consent UI may dispatch this event after explicit opt-in.
 * No consent source is supplied by default, so nobody is opted in. */
export function SentryConsent() {
  useEffect(() => {
    if (!dsn) return
    let consent = false
    let generation = 0
    let stop = () => {}
    const onConsent = (event: Event) => {
      const granted = event instanceof CustomEvent && event.detail === true
      if (granted === consent) return
      consent = granted
      const ticket = ++generation
      if (!consent) {
        stop()
        return
      }
      void import("@sentry/nextjs")
        .then((sdk) => {
          if (ticket !== generation || !consent) return
          sdk.init({
            dsn,
            defaultIntegrations: false,
            dataCollection: sentryDataCollection,
            beforeSendLog: () => null,
            beforeSendMetric: () => null,
            sendClientReports: false,
            beforeSend: (event) => ({
              type: event.type,
              event_id: event.event_id,
              timestamp: event.timestamp,
              platform: event.platform,
              release: event.release,
              debug_meta: event.debug_meta,
              exception: event.exception,
              contexts: { caller: { category: "consented_browser" } },
            }),
          })
          const recordError = () =>
            sdk.captureException(new Error("Browser runtime failure"))
          window.addEventListener("error", recordError)
          window.addEventListener("unhandledrejection", recordError)
          stop = () => {
            window.removeEventListener("error", recordError)
            window.removeEventListener("unhandledrejection", recordError)
            const client = sdk.getClient()
            if (client) client.getOptions().enabled = false
          }
        })
        .catch(() => {
          /* Telemetry must not interrupt application behavior. */
        })
    }
    window.addEventListener("nabalens:diagnostics-consent", onConsent)
    return () => {
      generation++
      window.removeEventListener("nabalens:diagnostics-consent", onConsent)
      stop()
    }
  }, [])
  return null
}
