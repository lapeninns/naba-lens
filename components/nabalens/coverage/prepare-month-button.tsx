"use client"

import * as React from "react"
import Link from "next/link"
import {
  ArrowClockwiseIcon,
  CalendarCheckIcon,
  SpinnerGapIcon,
} from "@phosphor-icons/react"

import { useSessionEndedCatch } from "@/components/nabalens/session-guard-host"
import { Notice } from "@/components/nabalens/notice"
import { OFFLINE_COPY, useOnline } from "@/components/nabalens/offline-notice"
import { Button, buttonVariants } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

import { failureText, needsRefresh, periodKeyLabel, plural } from "./copy"
import type { CoverageResult, PeriodKey, PreparationRunView } from "./types"

export type PrepareMonthHandler = () => Promise<
  CoverageResult<{ runs: PreparationRunView[] }>
>

export function preparationSummary(runs: PreparationRunView[]): string {
  const failed = runs.filter((r) => r.status === "failed")
  const copied = runs.reduce((n, r) => n + r.targetsCopied, 0)
  const placeholders = runs.reduce((n, r) => n + r.placeholdersCreated, 0)
  const present = runs.reduce((n, r) => n + r.alreadyPresent, 0)
  const parts = [
    `${plural(copied, "target")} copied from last month`,
    `${plural(placeholders, "person", "people")} need a target set`,
    `${present} already set up`,
  ]
  if (failed.length > 0) {
    return `Preparation failed for ${plural(failed.length, "run")} (code ${failed
      .map((r) => r.errorCode ?? "unknown")
      .join(", ")}). Nothing was half-done; try again. ${parts.join(", ")}.`
  }
  return `This month is prepared: ${parts.join(", ")}.`
}

/**
 * Prepare month's own offline outcome: about this request, never the age of
 * the page (no time is known for that here).
 */
export function prepareOfflineText(month: string, sent: boolean) {
  return sent
    ? `We couldn't confirm ${month} was prepared. Try again; nothing is sent twice.`
    : `You're offline, so ${month} wasn't prepared. Try again when you have a signal.`
}

type Outcome =
  | { kind: "done"; copied: number; placeholders: number }
  | { kind: "already" }
  | { kind: "failed"; copied: number; considered: number; placeholders: number }
  /** `sent`: the request went out but no answer came back. */
  | { kind: "offline"; sent: boolean }
  | { kind: "refused"; text: string }

function outcomeOf(runs: PreparationRunView[]): Outcome {
  const copied = runs.reduce((n, r) => n + r.targetsCopied, 0)
  const placeholders = runs.reduce((n, r) => n + r.placeholdersCreated, 0)
  if (runs.some((r) => r.status === "failed")) {
    const considered = runs.reduce((n, r) => n + r.staffConsidered, 0)
    return { kind: "failed", copied, considered, placeholders }
  }
  if (copied === 0 && placeholders === 0) return { kind: "already" }
  return { kind: "done", copied, placeholders }
}

function previousMonth(period: PeriodKey): string {
  const [year, month] = period.split("-").map(Number)
  const date = new Date(Date.UTC(year, month - 2, 1))
  return periodKeyLabel(
    `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`
  ).split(" ")[0]
}

/**
 * "Prepare this month": the same idempotent step the hourly schedule runs.
 * Copies each person's last target at this venue and flags missing setup;
 * running it again never duplicates anything. The dialog shows what it will
 * do, then what happened.
 */
export function PrepareMonthButton({
  label = "Prepare this month",
  period,
  venueName,
  teamHref,
  available = true,
  onPrepare,
  onStale,
}: {
  label?: string
  /** The month being prepared; names it in the dialog. */
  period?: PeriodKey
  /** Omit when preparing every active venue. */
  venueName?: string
  /** "Go to Team" after preparing; omit on Team itself. */
  teamHref?: string
  /**
   * False once the month is prepared. The control stays mounted so the
   * result is still shown after the page re-reads itself.
   */
  available?: boolean
  onPrepare: PrepareMonthHandler
  onStale?: () => void
}) {
  const online = useOnline()
  const [open, setOpen] = React.useState(false)
  const [pending, setPending] = React.useState(false)
  const [outcome, setOutcome] = React.useState<Outcome | null>(null)
  const sessionEnded = useSessionEndedCatch()
  const month = period ? periodKeyLabel(period).split(" ")[0] : "This month"
  const previous = period ? previousMonth(period) : "last month"
  const where = venueName ? ` at ${venueName}` : " at every venue"
  const title = period ? `Prepare ${month}${where}` : label

  async function prepare() {
    if (pending) return
    if (!online) {
      setOutcome({ kind: "offline", sent: false })
      return
    }
    setPending(true)
    setOutcome(null)
    try {
      const result = await onPrepare()
      if (!result.ok) {
        if (needsRefresh(result)) onStale?.()
        setOutcome({ kind: "refused", text: failureText(result) })
        return
      }
      setOutcome(outcomeOf(result.runs))
    } catch (cause) {
      const ended = sessionEnded(cause)
      setOutcome(
        ended
          ? { kind: "refused", text: ended }
          : { kind: "offline", sent: true }
      )
    } finally {
      setPending(false)
    }
  }

  function change(next: boolean) {
    if (pending) return
    setOpen(next)
    if (!next) setOutcome(null)
  }

  if (!available && !open) return null

  const finished = outcome?.kind === "done" || outcome?.kind === "already"
  const goToTeam = teamHref ? (
    <Link
      href={teamHref}
      onClick={() => setOpen(false)}
      className={buttonVariants({ variant: "primary", size: "touch" })}
    >
      Go to Team
    </Link>
  ) : (
    <Button size="touch" onClick={() => change(false)}>
      Close
    </Button>
  )

  return (
    <>
      <Button size="touch" onClick={() => setOpen(true)}>
        <CalendarCheckIcon aria-hidden />
        {label}
      </Button>
      <Dialog open={open} onOpenChange={change}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="[overflow-wrap:anywhere]">
              {title}
            </DialogTitle>
          </DialogHeader>
          {outcome?.kind === "done" ? (
            <Notice tone="positive" title={`${month} is prepared`}>
              Targets copied for {plural(outcome.copied, "person", "people")}
              {outcome.placeholders > 0
                ? `; ${plural(outcome.placeholders, "person", "people")} need setup on Team.`
                : "."}
            </Notice>
          ) : outcome?.kind === "already" ? (
            <Notice tone="attention" title={`${month} is already prepared`}>
              {month} was already prepared. Nothing was copied twice.
            </Notice>
          ) : outcome?.kind === "failed" ? (
            <Notice tone="negative" title={`Preparing ${month} didn't finish`}>
              {outcome.considered > 0
                ? `Targets were copied for ${outcome.copied} of ${outcome.considered} people. ${outcome.placeholders} need you to set them on Team. Nothing was copied twice.`
                : "Nothing was copied, and nothing was copied twice. Try again."}
            </Notice>
          ) : outcome?.kind === "offline" ? (
            <Notice
              tone="negative"
              title={OFFLINE_COPY.title}
              action={
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => void prepare()}
                >
                  <ArrowClockwiseIcon aria-hidden />
                  {OFFLINE_COPY.action}
                </Button>
              }
            >
              {prepareOfflineText(month, outcome.sent)}
            </Notice>
          ) : outcome?.kind === "refused" ? (
            <Notice tone="negative" title={`Preparing ${month} didn't finish`}>
              {outcome.text}
            </Notice>
          ) : (
            <div className="grid gap-4">
              <dl className="grid gap-3">
                <div className="grid gap-0.5">
                  <dt className="text-meta text-ink-muted">Targets</dt>
                  <dd className="text-body">
                    Copies {previous}&apos;s targets{where}.
                  </dd>
                </div>
                <div className="grid gap-0.5">
                  <dt className="text-meta text-ink-muted">New starters</dt>
                  <dd className="text-body">
                    Anyone with no {previous} target shows Needs setup until you
                    set one.
                  </dd>
                </div>
              </dl>
              <p className="text-body text-ink-muted">
                You can change any target afterwards; changing a set target
                needs a reason. This also runs by itself every hour.
              </p>
            </div>
          )}
          <DialogFooter>
            {finished ? (
              goToTeam
            ) : outcome?.kind === "failed" || outcome?.kind === "refused" ? (
              <>
                <Button
                  variant="secondary"
                  size="touch"
                  onClick={() => change(false)}
                >
                  Close
                </Button>
                <Button size="touch" onClick={() => void prepare()}>
                  <ArrowClockwiseIcon aria-hidden />
                  Try again
                </Button>
              </>
            ) : (
              <>
                <Button
                  variant="secondary"
                  size="touch"
                  onClick={() => change(false)}
                  disabled={pending}
                >
                  Cancel
                </Button>
                <Button
                  size="touch"
                  onClick={() => void prepare()}
                  aria-disabled={pending || undefined}
                  aria-busy={pending || undefined}
                >
                  {pending ? (
                    <SpinnerGapIcon aria-hidden className="animate-spin" />
                  ) : (
                    <CalendarCheckIcon aria-hidden />
                  )}
                  {pending ? "Preparing…" : label}
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
