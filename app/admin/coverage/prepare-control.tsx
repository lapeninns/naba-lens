"use client"

import * as React from "react"
import {
  ArrowClockwiseIcon,
  CalendarCheckIcon,
  SpinnerGapIcon,
} from "@phosphor-icons/react"
import { useRouter } from "next/navigation"

import { prepareMonthAction } from "@/app/_coverage/actions"
import {
  CoverageNotice,
  type Notice as Outcome,
} from "@/components/nabalens/coverage/coverage-notice"
import { preparationSummary } from "@/components/nabalens/coverage/prepare-month-button"
import { useCoverageAction } from "@/components/nabalens/coverage/use-coverage-action"
import { Notice } from "@/components/nabalens/notice"
import { Button } from "@/components/ui/button"

import { PREPARATION_COPY, failureWords } from "./coverage-copy"

type PrepareContext = {
  pending: boolean
  prepare: () => void
  notice: Outcome | null
  dismiss: () => void
  month: string
  venues: string[]
}

const Context = React.createContext<PrepareContext | null>(null)

function usePrepare(): PrepareContext {
  const value = React.useContext(Context)
  if (!value) throw new Error("Prepare controls need a PrepareProvider")
  return value
}

/**
 * One "prepare every venue" action shared by the header button, the failure
 * notice's Try again and the status notices, so a run started anywhere shows
 * the same Preparing state everywhere.
 */
export function PrepareProvider({
  month,
  venues,
  children,
}: {
  month: string
  /** Venues the run is expected to prepare, for the progress notice. */
  venues: string[]
  children: React.ReactNode
}) {
  const router = useRouter()
  const refresh = React.useCallback(() => router.refresh(), [router])
  const action = useCoverageAction(refresh)
  const { run, setNotice } = action

  const prepare = React.useCallback(() => {
    void (async () => {
      const result = await run(
        () => prepareMonthAction({}),
        (r) => preparationSummary(r.runs)
      )
      const failed = result.ok
        ? result.runs.find((r) => r.status === "failed")
        : undefined
      if (failed) {
        setNotice({
          tone: "error",
          text: `${PREPARATION_COPY.allVenuesScope}: ${failureWords(failed.errorCode)} ${PREPARATION_COPY.safeToRepeat}`,
        })
      }
    })()
  }, [run, setNotice])
  const dismiss = React.useCallback(() => setNotice(null), [setNotice])

  const value = React.useMemo(
    () => ({
      pending: action.pending,
      prepare,
      notice: action.notice,
      dismiss,
      month,
      venues,
    }),
    [action.pending, prepare, action.notice, dismiss, month, venues]
  )

  return <Context.Provider value={value}>{children}</Context.Provider>
}

/** Progress while a run is going, then its outcome until dismissed. */
export function PrepareStatus() {
  const { pending, notice, dismiss, month, venues } = usePrepare()
  return (
    <>
      {pending ? (
        <Notice role="status" title={PREPARATION_COPY.preparingTitle}>
          <p>{PREPARATION_COPY.preparingBody(month, venues)}</p>
        </Notice>
      ) : null}
      <CoverageNotice notice={notice} onDismiss={dismiss} />
    </>
  )
}

/** Primary while a venue is missing or didn't finish; otherwise Prepare again. */
export function PrepareButton({ primary }: { primary: boolean }) {
  const { pending, prepare } = usePrepare()
  return (
    <Button
      type="button"
      variant={primary ? "primary" : "secondary"}
      size="touch"
      onClick={prepare}
      aria-disabled={pending || undefined}
      aria-busy={pending || undefined}
      disabled={pending}
    >
      {pending ? (
        <SpinnerGapIcon aria-hidden className="animate-spin" />
      ) : (
        <CalendarCheckIcon aria-hidden />
      )}
      {pending
        ? PREPARATION_COPY.preparing
        : primary
          ? PREPARATION_COPY.prepareThisMonth
          : PREPARATION_COPY.prepareAgain}
    </Button>
  )
}

export function PrepareRetryButton() {
  const { pending, prepare } = usePrepare()
  return (
    <Button
      type="button"
      variant="secondary"
      size="sm"
      onClick={prepare}
      disabled={pending}
    >
      <ArrowClockwiseIcon aria-hidden />
      {PREPARATION_COPY.tryAgain}
    </Button>
  )
}
