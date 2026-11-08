"use client"

import * as React from "react"

import { failureText, needsRefresh } from "./copy"
import type { Notice } from "./coverage-notice"
import type { CoverageFailure, CoverageResult } from "./types"

/**
 * After a write whose reply was lost (offline, or the response never came).
 * The server may have applied it, so this never says nothing changed. Every
 * `run` call is a write; reads report their own failures.
 */
export const NETWORK_ERROR =
  "We couldn't confirm your change was saved. Check your connection, then try again or refresh to see if it was."

/**
 * Dialog outcome for a stale or refused change. The page notice already says
 * what happened and the page is re-reading itself, so the dialog closes
 * instead of repeating the message over a row that may have gone.
 */
export const REPORTED = { ok: false, reported: true } as const
export type Reported = typeof REPORTED

type Outcome<T> =
  | ({ ok: true } & T)
  | CoverageFailure
  | { ok: false; code: "network"; message: string }

/**
 * Runs one coverage mutation with a pending flag and a notice. A successful
 * write re-renders the page in the Server Action response; a stale revision
 * or refused write re-reads it (`onStale`) instead of retrying over someone
 * else's change.
 */
export function useCoverageAction(onStale?: () => void) {
  const [pending, setPending] = React.useState(false)
  const [notice, setNotice] = React.useState<Notice | null>(null)

  const run = React.useCallback(
    async <T extends object>(
      call: () => Promise<CoverageResult<T>>,
      success: string | ((result: { ok: true } & T) => string)
    ): Promise<Outcome<T>> => {
      setPending(true)
      setNotice(null)
      try {
        const result = await call()
        if (!result.ok) {
          const refresh = needsRefresh(result)
          setNotice({
            tone: refresh ? "warning" : "error",
            text: failureText(result),
          })
          if (refresh) onStale?.()
          return result
        }
        setNotice({
          tone: "success",
          text: typeof success === "function" ? success(result) : success,
        })
        return result
      } catch {
        setNotice({ tone: "error", text: NETWORK_ERROR })
        return { ok: false, code: "network", message: NETWORK_ERROR }
      } finally {
        setPending(false)
      }
    },
    [onStale]
  )

  /** True when `run` showed a refresh notice and re-read the page. */
  const reportedOnPage = (result: Outcome<object>) =>
    !result.ok && result.code !== "network" && needsRefresh(result)

  return {
    run,
    pending,
    notice,
    reportedOnPage,
    setNotice,
    dismiss: () => setNotice(null),
  }
}
