"use client"

import * as React from "react"
import { useRouter } from "next/navigation"

import { decideBatchAction } from "@/app/manager/review/actions"
import { EvidenceThumb } from "@/components/nabalens/coverage/evidence-image"
import { Notice } from "@/components/nabalens/notice"
import { useSessionEndedCatch } from "@/components/nabalens/session-guard-host"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  batchable,
  batchItemOf,
  batchSummary,
  type BatchAction,
  type BatchOutcome,
} from "@/lib/review/inbox"
import type { QueueCard } from "@/lib/server/menu-photos/types"
import { dishName } from "@/lib/menus/dish-name"

import { INBOX_COPY } from "./inbox-copy"

const C = INBOX_COPY
const B = INBOX_COPY.batch

/** The most photos one batch takes (lib/server/review/inbox.ts BATCH_MAX). */
export const BATCH_LIMIT = 24

const ACTION_LABEL: Record<BatchAction, string> = {
  public: C.approve,
  reference: C.keepReference,
  not_used: C.notUsed,
}

function cardName(card: QueueCard): string | null {
  return card.item ? dishName(card.item) : null
}

/**
 * Batch decisions (spec §7 M2, AC37): choose waiting photos from the loaded
 * page, pick Approve for public use, Keep as reference or Not used, and
 * confirm in a dialog that shows exactly the chosen thumbnails. Each photo is
 * decided on its own by the server against the version the screen saw; the
 * result lists any that need another look, and the list reloads.
 */
export function InboxBatch({
  cards,
  venueId,
}: {
  cards: QueueCard[]
  /** Admins name the venue on every decision. */
  venueId?: string
}) {
  const router = useRouter()
  const sessionEnded = useSessionEndedCatch()
  const id = React.useId()
  const [choosing, setChoosing] = React.useState(false)
  const [chosen, setChosen] = React.useState<ReadonlySet<string>>(new Set())
  const [confirm, setConfirm] = React.useState<BatchAction | null>(null)
  const [reason, setReason] = React.useState("")
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [result, setResult] = React.useState<{
    outcomes: BatchOutcome[]
    names: Record<string, string>
  } | null>(null)

  const candidates = cards.filter((c) => batchable(c, "not_used"))
  if (candidates.length === 0 && !result) return null

  const selected = candidates.filter((c) => chosen.has(c.key))
  const eligible = (action: BatchAction) =>
    selected.filter((c) => batchable(c, action))
  const toConfirm = confirm ? eligible(confirm) : []

  const toggle = (key: string) =>
    setChosen((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else if (next.size < BATCH_LIMIT) next.add(key)
      return next
    })

  async function send() {
    if (!confirm) return
    if (confirm === "not_used" && !reason.trim()) {
      setError(C.notUsedLabel)
      return
    }
    setBusy(true)
    setError(null)
    try {
      const reply = await decideBatchAction({
        ...(venueId ? { venueId } : {}),
        action: confirm,
        items: toConfirm.map(batchItemOf),
        ...(confirm === "not_used" ? { reason: reason.trim() } : {}),
      })
      if (!reply.ok) {
        setError([reply.message, reply.nextAction].filter(Boolean).join(" "))
        return
      }
      setResult({
        outcomes: reply.outcomes,
        names: Object.fromEntries(
          toConfirm.map((c) => [
            c.key,
            B.choose(c.contributor.name, cardName(c)),
          ])
        ),
      })
      setConfirm(null)
      setChosen(new Set())
      setChoosing(false)
      setReason("")
      router.refresh()
    } catch (cause) {
      setError(sessionEnded(cause) ?? C.failed)
    } finally {
      setBusy(false)
    }
  }

  const summary = result ? batchSummary(result.outcomes) : null

  return (
    <section aria-labelledby={`${id}-h`} className="grid gap-3">
      <h2 id={`${id}-h`} className="sr-only">
        {B.heading}
      </h2>
      {result && summary ? (
        <Notice
          tone={summary.failed > 0 ? "attention" : "positive"}
          role="status"
          title={B.result(summary.done, summary.failed)}
        >
          {summary.failed > 0 ? (
            <ul className="grid gap-1" data-batch-failures>
              {result.outcomes
                .filter((o) => !o.ok)
                .map((o) => (
                  <li key={o.key}>
                    {result.names[o.key] ?? ""}: {o.error}
                  </li>
                ))}
            </ul>
          ) : null}
        </Notice>
      ) : null}
      {candidates.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant={choosing ? "quiet" : "secondary"}
            aria-expanded={choosing}
            aria-controls={`${id}-panel`}
            data-batch-toggle
            onClick={() => {
              setChoosing((open) => !open)
              setChosen(new Set())
            }}
          >
            {choosing ? B.cancel : B.start}
          </Button>
        </div>
      ) : null}
      {choosing ? (
        <div
          id={`${id}-panel`}
          className="grid gap-3 rounded-card border border-line p-3"
        >
          <p className="text-body text-ink">{B.help}</p>
          <ul
            aria-label={B.heading}
            className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6"
          >
            {candidates.map((c) => {
              const on = chosen.has(c.key)
              return (
                <li key={c.key}>
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={on}
                    aria-label={B.choose(c.contributor.name, cardName(c))}
                    data-batch-card={c.key}
                    onClick={() => toggle(c.key)}
                    className={
                      "grid w-full gap-1 rounded-control p-1 text-left focus-ring outline-none " +
                      (on
                        ? "bg-accent-soft ring-2 ring-accent"
                        : "bg-surface-2")
                    }
                  >
                    <EvidenceThumb
                      src={c.asset.thumbnailUrl}
                      className="aspect-square w-full rounded-control"
                    />
                    <span className="truncate text-meta text-ink">
                      {cardName(c) ?? C.needsLabel}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
          <p className="text-meta text-ink-muted" aria-live="polite">
            {B.selected(selected.length)}
            {chosen.size >= BATCH_LIMIT ? ` · ${B.tooMany(BATCH_LIMIT)}` : ""}
          </p>
          <div className="flex flex-wrap gap-2 @max-wide:*:flex-auto">
            {(["public", "reference", "not_used"] as const).map((action) => {
              const n = eligible(action).length
              return (
                <Button
                  key={action}
                  type="button"
                  variant={
                    action === "public"
                      ? "primary"
                      : action === "not_used"
                        ? "danger-quiet"
                        : "secondary"
                  }
                  disabled={n === 0}
                  data-batch-action={action}
                  onClick={() => {
                    setError(null)
                    setConfirm(action)
                  }}
                >
                  {`${ACTION_LABEL[action]} (${n})`}
                </Button>
              )
            })}
          </div>
        </div>
      ) : null}

      <Dialog
        open={confirm !== null}
        onOpenChange={(open) => {
          if (!open && !busy) setConfirm(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {confirm
                ? B.confirmTitle(ACTION_LABEL[confirm], toConfirm.length)
                : ""}
            </DialogTitle>
            <DialogDescription>{B.confirmBody}</DialogDescription>
          </DialogHeader>
          <ul
            aria-label={B.heading}
            data-batch-confirm
            className="grid max-h-72 grid-cols-3 gap-2 overflow-y-auto sm:grid-cols-4"
          >
            {toConfirm.map((c) => (
              <li key={c.key} className="grid gap-1">
                <EvidenceThumb
                  src={c.asset.thumbnailUrl}
                  className="aspect-square w-full rounded-control"
                />
                <span className="truncate text-meta text-ink">
                  {B.choose(c.contributor.name, cardName(c))}
                </span>
              </li>
            ))}
          </ul>
          {confirm === "not_used" ? (
            <div className="grid gap-1.5">
              <label htmlFor={`${id}-reason`} className="text-label text-ink">
                {B.reasonLabel}
              </label>
              <textarea
                id={`${id}-reason`}
                value={reason}
                maxLength={500}
                onChange={(e) => setReason(e.target.value)}
                className="min-h-20 rounded-control border border-line bg-surface p-3 text-body text-ink focus-ring outline-none"
              />
            </div>
          ) : null}
          {error ? (
            <p role="alert" className="text-body font-semibold text-warn-fg">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <Button
              type="button"
              variant="quiet"
              disabled={busy}
              onClick={() => setConfirm(null)}
            >
              {C.cancel}
            </Button>
            <Button
              type="button"
              variant={confirm === "not_used" ? "danger" : "primary"}
              disabled={busy || toConfirm.length === 0}
              aria-busy={busy || undefined}
              data-batch-confirm-button
              onClick={() => void send()}
            >
              {busy
                ? C.saving
                : confirm
                  ? `${ACTION_LABEL[confirm]} (${toConfirm.length})`
                  : C.confirm}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  )
}
