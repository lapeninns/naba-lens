"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { ArrowClockwiseIcon, ProhibitIcon } from "@phosphor-icons/react"

import { CoverageNotice, CoverageSection } from "@/components/nabalens/coverage"
import type { Notice as CoverageNoticeValue } from "@/components/nabalens/coverage"
import {
  ReasonDialog,
  type ReasonOutcome,
} from "@/components/nabalens/coverage/reason-dialog"
import { useRequestIds } from "@/components/nabalens/coverage/use-request-id"
import { Button } from "@/components/ui/button"
import type {
  KnowledgeResult,
  SlotEventView,
  SlotHistoryView,
} from "@/lib/knowledge-client/contract"

import { FieldMessage, LABEL, MUTED } from "../amenities/capture/field-parts"
import type { PolicyContext } from "./policy-detail"

import {
  AT_DATE_COPY,
  HISTORY_COPY,
  WITHDRAW_COPY,
  atDateLines,
  eventLine,
  eventWhen,
  londonInstant,
  whenWords,
} from "./corrections-copy"

const INPUT =
  "block min-h-12 w-full min-w-0 rounded-control border border-line-control bg-panel px-3 py-2 text-body-touch text-ink outline-none focus-visible:border-focus focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-1 focus-visible:outline-focus disabled:cursor-not-allowed disabled:bg-well aria-invalid:border-negative md:text-body"

type Withdraw = (input: {
  checkId: string
  slotRevision: number
  reason: string
  idempotencyKey: string
}) => Promise<
  KnowledgeResult<{
    decisionId: string
    slotRevision: number
    replayed: boolean
  }>
>

/**
 * Withdraw the answer (B03 UI design §8.2): a manager account or an admin.
 * Keyed, so a retry after a lost reply never withdraws twice; focus returns
 * to Where it stands.
 */
export function WithdrawControl({
  checkId,
  slotRevision,
  value,
  onWithdraw,
  focusId,
}: {
  checkId: string
  slotRevision: number
  /** The answer in use, in words. */
  value: string
  onWithdraw: Withdraw
  /** The heading that takes focus after it's withdrawn. */
  focusId: string
}) {
  const router = useRouter()
  const requests = useRequestIds()
  const [open, setOpen] = React.useState(false)
  const [notice, setNotice] = React.useState<CoverageNoticeValue | null>(null)
  // Refreshed once the dialog has closed and handed focus to `focusId` (a
  // microtask on close), so the re-render never races that focus move.
  const refreshOnClose = React.useRef(false)
  React.useEffect(() => {
    if (open || !refreshOnClose.current) return
    refreshOnClose.current = false
    const timer = setTimeout(() => router.refresh(), 0)
    return () => clearTimeout(timer)
  }, [open, router])
  const scope = `withdraw:${checkId}`
  return (
    <>
      <CoverageNotice notice={notice} onDismiss={() => setNotice(null)} />
      <Button
        type="button"
        variant="secondary"
        size="touch"
        onClick={() => setOpen(true)}
      >
        <ProhibitIcon aria-hidden />
        {WITHDRAW_COPY.open}
      </Button>
      <ReasonDialog
        open={open}
        onOpenChange={setOpen}
        title={WITHDRAW_COPY.title}
        description={WITHDRAW_COPY.body(value)}
        label={WITHDRAW_COPY.why}
        help={WITHDRAW_COPY.whyHelp}
        emptyError={WITHDRAW_COPY.whyEmpty}
        confirmLabel={WITHDRAW_COPY.confirm}
        pendingLabel={WITHDRAW_COPY.pending}
        destructive
        reportFocus={() => document.getElementById(focusId)}
        reportFocusOnSuccess
        onConfirm={async (reason): Promise<ReasonOutcome> => {
          const payload = { checkId, slotRevision, reason }
          let result
          try {
            result = await onWithdraw({
              ...payload,
              idempotencyKey: requests.requestIdFor(scope, payload),
            })
          } catch {
            // The same intent keeps its key: Try again replays.
            return { ok: false, error: WITHDRAW_COPY.lost }
          }
          requests.settle(scope)
          if (!result.ok)
            return {
              ok: false,
              error:
                result.code === "not_permitted"
                  ? WITHDRAW_COPY.notPermitted
                  : result.message,
            }
          setNotice({ tone: "success", text: WITHDRAW_COPY.done })
          refreshOnClose.current = true
          return { ok: true }
        }}
      />
    </>
  )
}

type LoadEvents = (input: {
  checkId: string
  cursor: string
}) => Promise<
  KnowledgeResult<{ items: SlotEventView[]; nextCursor: string | null }>
>

/**
 * History (§8.4): newest first, 20 a page with Show older; focus moves to
 * the first line it showed (B02 HM-06).
 */
export function HistorySection({
  checkId,
  first,
  loadOlder,
  checkDatesApply,
}: {
  checkId: string
  /** The first page; null when it couldn't be read. */
  first: { items: SlotEventView[]; nextCursor: string | null } | null
  loadOlder: LoadEvents
  checkDatesApply: boolean
}) {
  const router = useRouter()
  const [items, setItems] = React.useState(first?.items ?? [])
  const [cursor, setCursor] = React.useState(first?.nextCursor ?? null)
  const [pending, setPending] = React.useState(false)
  const [failed, setFailed] = React.useState(false)

  async function older() {
    if (!cursor) return
    setPending(true)
    setFailed(false)
    try {
      const result = await loadOlder({ checkId, cursor })
      if (!result.ok) {
        setFailed(true)
        return
      }
      const firstNew = result.items[0]
      setItems((current) => [...current, ...result.items])
      setCursor(result.nextCursor)
      if (firstNew)
        requestAnimationFrame(() =>
          document.getElementById(`history-${firstNew.eventId}`)?.focus()
        )
    } catch {
      setFailed(true)
    } finally {
      setPending(false)
    }
  }

  return (
    <CoverageSection id="amenity-history" title={HISTORY_COPY.title}>
      {checkDatesApply ? (
        <p className={MUTED}>{HISTORY_COPY.checkDatesNote}</p>
      ) : null}
      {first === null ? (
        <div className="grid gap-2">
          <p className="text-body-touch text-ink md:text-body">
            {HISTORY_COPY.failed}
          </p>
          <div>
            <Button
              type="button"
              variant="secondary"
              size="touch"
              onClick={() => router.refresh()}
            >
              <ArrowClockwiseIcon aria-hidden />
              {HISTORY_COPY.tryAgain}
            </Button>
          </div>
        </div>
      ) : items.length === 0 ? (
        <p className="text-body-touch text-ink md:text-body">
          {HISTORY_COPY.empty}
        </p>
      ) : (
        <ol className="grid gap-2">
          {items.map((e) => (
            <li
              key={e.eventId}
              id={`history-${e.eventId}`}
              tabIndex={-1}
              className="grid gap-0.5 rounded-control outline-none focus-visible:outline-2 focus-visible:outline-focus focus-visible:outline-solid"
            >
              <span className="text-body-touch [overflow-wrap:anywhere] text-ink md:text-body">
                {eventLine(e)}
              </span>
              <span className={MUTED}>{eventWhen(e)}</span>
            </li>
          ))}
        </ol>
      )}
      {failed ? (
        <p role="alert" className="text-body-touch text-ink md:text-body">
          {HISTORY_COPY.failed}
        </p>
      ) : null}
      {cursor ? (
        <div>
          <Button
            type="button"
            variant="secondary"
            size="touch"
            disabled={pending}
            aria-busy={pending || undefined}
            onClick={() => void older()}
          >
            {HISTORY_COPY.showOlder}
          </Button>
        </div>
      ) : null}
    </CoverageSection>
  )
}

type LoadAt = (input: {
  checkId: string
  at: string
}) => Promise<KnowledgeResult<{ history: SlotHistoryView }>>

/** See the answer on a date (§8.5): the server's snapshot, in words. */
export function AnswerOnDate({
  checkId,
  today,
  load,
  policy = null,
}: {
  checkId: string
  today: string
  load: LoadAt
  /** A policy question: read the snapshot's policy with these lists. */
  policy?: PolicyContext | null
}) {
  const id = React.useId()
  const [date, setDate] = React.useState("")
  const [time, setTime] = React.useState("")
  const [error, setError] = React.useState<string | null>(null)
  const [pending, setPending] = React.useState(false)
  const [result, setResult] = React.useState<
    | { kind: "shown"; lines: string[] }
    | { kind: "failed"; retry: boolean }
    | null
  >(null)

  async function show() {
    if (!date) return setError(AT_DATE_COPY.dateRequired)
    if (date > today) return setError(AT_DATE_COPY.dateFuture)
    setError(null)
    setPending(true)
    try {
      const read = await load({
        checkId,
        at: londonInstant(date, time || null),
      })
      setResult(
        read.ok
          ? {
              kind: "shown",
              lines: atDateLines(
                read.history,
                whenWords(date, time || null),
                policy
              ),
            }
          : { kind: "failed", retry: read.code === "unavailable" }
      )
    } catch {
      setResult({ kind: "failed", retry: true })
    } finally {
      setPending(false)
    }
  }

  return (
    <CoverageSection id="amenity-at-date" title={AT_DATE_COPY.title}>
      <form
        noValidate
        className="grid min-w-0 gap-3"
        onSubmit={(e) => {
          e.preventDefault()
          void show()
        }}
      >
        <div className="grid gap-3 min-[400px]:grid-cols-2">
          <div className="grid min-w-0 gap-1.5">
            <label htmlFor={`${id}-date`} className={LABEL}>
              {AT_DATE_COPY.date}
            </label>
            <input
              id={`${id}-date`}
              type="date"
              required
              aria-required
              max={today}
              value={date}
              className={INPUT}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? `${id}-date-error` : undefined}
              onChange={(e) => setDate(e.currentTarget.value)}
            />
            <FieldMessage id={`${id}-date-error`} error={error ?? undefined} />
          </div>
          <div className="grid min-w-0 gap-1.5">
            <label htmlFor={`${id}-time`} className={LABEL}>
              {AT_DATE_COPY.time}
            </label>
            <input
              id={`${id}-time`}
              type="time"
              value={time}
              className={INPUT}
              aria-describedby={`${id}-time-help`}
              onChange={(e) => setTime(e.currentTarget.value)}
            />
            <p id={`${id}-time-help`} className={MUTED}>
              {AT_DATE_COPY.timeHelp}
            </p>
          </div>
        </div>
        <div>
          <Button
            type="submit"
            variant="secondary"
            size="touch"
            disabled={pending}
            aria-busy={pending || undefined}
          >
            {AT_DATE_COPY.show}
          </Button>
        </div>
      </form>
      <div aria-live="polite" className="grid gap-1">
        {result?.kind === "shown"
          ? result.lines.map((line) => (
              <p key={line} className="text-body-touch text-ink md:text-body">
                {line}
              </p>
            ))
          : null}
        {result?.kind === "failed" ? (
          <div className="grid gap-2">
            <p className="text-body-touch text-ink md:text-body">
              {AT_DATE_COPY.failed}
            </p>
            {result.retry ? (
              <div>
                <Button
                  type="button"
                  variant="secondary"
                  size="touch"
                  onClick={() => void show()}
                >
                  {AT_DATE_COPY.tryAgain}
                </Button>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </CoverageSection>
  )
}
