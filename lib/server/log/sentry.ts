import "server-only"

import * as Sentry from "@sentry/nextjs"
import { nodeProfilingIntegration } from "@sentry/profiling-node"
import type { Instrumentation } from "next"

import { sentryDataCollection } from "@/lib/observability/sentry-privacy"

import { validRequestId } from "./logger"

export function init() {
  const dsn = process.env.SENTRY_DSN?.trim()
  if (!dsn) return
  Sentry.init({
    dsn,
    dataCollection: sentryDataCollection,
    beforeSendLog: () => null,
    beforeSendMetric: () => null,
    traceLifecycle: "static",
    tracesSampleRate: 0.1,
    ...{ profileSessionSampleRate: 0.05, profileLifecycle: "trace" as const },
    integrations: (defaults) => [
      ...defaults.filter(
        ({ name }) =>
          !["Console", "RequestData", "Breadcrumbs", "LocalVariables"].includes(
            name
          )
      ),
      nodeProfilingIntegration(),
    ],
    beforeBreadcrumb: (breadcrumb) =>
      breadcrumb.category === "nabalens.request"
        ? { category: breadcrumb.category, level: breadcrumb.level }
        : null,
    beforeSend: (event) => ({
      type: event.type,
      event_id: event.event_id,
      timestamp: event.timestamp,
      platform: event.platform,
      release: event.release,
      environment: event.environment,
      debug_meta: event.debug_meta,
      exception: {
        values: event.exception?.values?.map(({ stacktrace }) => ({
          type: "Error",
          value: "Unhandled request failure",
          stacktrace: {
            frames: stacktrace?.frames?.map(
              ({ filename, function: name, lineno, colno, in_app }) => ({
                filename: filename?.split(/[?#]/, 1)[0],
                function: name,
                lineno,
                colno,
                in_app,
              })
            ),
          },
        })),
      },
      breadcrumbs: event.breadcrumbs,
      // Do not attach actual staff identities, even when a session is active.
      contexts: {
        caller: { category: "server_request" },
        request_correlation: {
          request_id:
            validRequestId(
              event.contexts?.request_correlation?.request_id as
                string | undefined
            ) ?? undefined,
          surface: event.contexts?.request_correlation?.surface,
        },
      },
    }),
    beforeSendTransaction: (event) => ({
      ...event,
      transaction: "nabalens.request",
      request: undefined,
      user: undefined,
      extra: undefined,
      breadcrumbs: undefined,
      spans: [],
      contexts: event.contexts?.trace
        ? {
            trace: {
              trace_id: event.contexts.trace.trace_id,
              span_id: event.contexts.trace.span_id,
              parent_span_id: event.contexts.trace.parent_span_id,
              status: event.contexts.trace.status,
            },
          }
        : undefined,
    }),
  })
}

export const capture: Instrumentation.onRequestError = (
  error,
  request,
  context
) => {
  const raw = request.headers["x-request-id"]
  const requestId = validRequestId(typeof raw === "string" ? raw : undefined)
  const failure = new Error("Unhandled request failure")
  if (error instanceof Error && error.stack) {
    // Keep application frames, not the exception message or paths with queries.
    const frames = error.stack
      .split("\n")
      .filter((line) => /^\s+at /.test(line) && !/[?#]/.test(line))
    failure.stack = `${failure.name}: ${failure.message}\n${frames.join("\n")}`
  }
  Sentry.withScope((scope) => {
    scope.setContext("request_correlation", {
      surface: context.routeType,
      request_id: requestId,
    })
    scope.addBreadcrumb({ category: "nabalens.request", level: "error" })
    Sentry.captureException(failure)
  })
}
