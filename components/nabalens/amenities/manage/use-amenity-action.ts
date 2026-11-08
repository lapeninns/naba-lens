"use client"

import * as React from "react"
import { useRouter } from "next/navigation"

import { useSessionEndedCatch } from "@/components/nabalens/session-guard-host"
import type { Notice } from "@/components/nabalens/coverage"
import type { AmenityFailure, AmenityResult } from "@/lib/amenities/contract"

/** After an amenity write whose reply was lost: the server may have applied it. */
export const NETWORK_ERROR =
  "We couldn't confirm your change was saved. Check your connection, then try again or refresh to see if it was."

export const CONFLICT_TEXT =
  "Someone else changed this check. The page now shows the latest version; check it and try again."

type NetworkFailure = {
  ok: false
  code: "network"
  message: string
  sessionEnded: boolean
}
export type AmenityOutcome<T> = AmenityResult<T> | NetworkFailure

/** Codes after which the page no longer matches the database: re-read it. */
const STALE: ReadonlySet<AmenityFailure["code"]> = new Set([
  "revision_conflict",
  "state_conflict",
  "not_found",
  "not_permitted",
  "wrong_venue",
  "needs_setup",
])

export function failureText(failure: AmenityFailure): string {
  return failure.code === "revision_conflict" ? CONFLICT_TEXT : failure.message
}

/**
 * Runs one amenity write with a pending flag, a notice and the server's field
 * errors. A stale revision or a refusal re-reads the page instead of retrying
 * over someone else's change; success re-reads it too, so counts and history
 * follow the write.
 */
export function useAmenityAction() {
  const router = useRouter()
  const [pending, setPending] = React.useState(false)
  const [notice, setNotice] = React.useState<Notice | null>(null)
  const sessionEnded = useSessionEndedCatch()
  const [fieldErrors, setFieldErrors] = React.useState<
    Partial<Record<string, string>>
  >({})

  const run = React.useCallback(
    async <T extends object>(
      call: () => Promise<AmenityResult<T>>,
      success: string | ((result: { ok: true } & T) => string)
    ): Promise<AmenityOutcome<T>> => {
      setPending(true)
      setNotice(null)
      setFieldErrors({})
      try {
        const result = await call()
        if (!result.ok) {
          const stale = STALE.has(result.code)
          setNotice({
            tone: stale ? "warning" : "error",
            text: failureText(result),
          })
          setFieldErrors(result.fieldErrors ?? {})
          if (stale) router.refresh()
          return result
        }
        setNotice({
          tone: "success",
          text: typeof success === "function" ? success(result) : success,
        })
        router.refresh()
        return result
      } catch (cause) {
        // Refused for the ended session (nothing was saved), or the reply
        // was lost.
        const ended = sessionEnded(cause)
        const message = ended ?? NETWORK_ERROR
        setNotice({ tone: "error", text: message })
        return { ok: false, code: "network", message, sessionEnded: !!ended }
      } finally {
        setPending(false)
      }
    },
    [router, sessionEnded]
  )

  return {
    run,
    pending,
    notice,
    fieldErrors,
    setFieldErrors,
    dismiss: () => setNotice(null),
  }
}
