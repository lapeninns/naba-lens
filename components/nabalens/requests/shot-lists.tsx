"use client"

import * as React from "react"
import { useRouter } from "next/navigation"

import { Notice } from "@/components/nabalens/notice"
import { OptionSelect } from "@/components/nabalens/option-select"
import { useSessionEndedCatch } from "@/components/nabalens/session-guard-host"
import { StatusChip } from "@/components/nabalens/status-chip"
import { Button } from "@/components/ui/button"
import { FormField } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  REASON_MAX,
  REQUEST_WORDS,
  SHOT_LIST_NAME_MAX,
  SHOT_LIST_NOTE_MAX,
  SHOT_LIST_PURPOSES,
  shortDate,
  type ShotListPurpose,
  type ShotListView,
} from "@/lib/requests/model"

/*
 * Shot lists (spec §7 M4): a few requests grouped for a menu launch or a
 * quiet service period. Each shows "n of N" completed (FA-8) and may carry a
 * real due date (FA-5). Requests join a list from their form; cancelling a
 * list cancels its open requests with the same reason.
 */

type Result<T extends object = object> =
  ({ ok: true } & T) | { ok: false; error: string; field?: string }

export type ShotListActions = {
  create: (input: unknown) => Promise<Result<{ id: string }>>
  cancel: (input: {
    shotListId: string
    revision: number
    reason: string
  }) => Promise<Result<{ requestsCancelled: number }>>
}

function useRun() {
  const router = useRouter()
  const sessionEnded = useSessionEndedCatch()
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const run = async (call: () => Promise<Result>) => {
    if (busy) return false
    setBusy(true)
    setError(null)
    try {
      const result = await call()
      if (!result.ok) {
        setError(result.error)
        return false
      }
      router.refresh()
      return true
    } catch (cause) {
      setError(
        sessionEnded(cause) ??
          "That didn't go through. Check your connection and try again."
      )
      return false
    } finally {
      setBusy(false)
    }
  }
  return { busy, error, run }
}

export function ShotListCards({
  lists,
  actions,
}: {
  lists: ShotListView[]
  actions: ShotListActions
}) {
  if (lists.length === 0) return null
  return (
    <ul className="grid gap-2 md:grid-cols-2" data-slot="shot-lists">
      {lists.map((list) => (
        <li key={list.id}>
          <ShotListCard list={list} cancel={actions.cancel} />
        </li>
      ))}
    </ul>
  )
}

function ShotListCard({
  list,
  cancel,
}: {
  list: ShotListView
  cancel: ShotListActions["cancel"]
}) {
  const { busy, error, run } = useRun()
  const [open, setOpen] = React.useState(false)
  const [reason, setReason] = React.useState("")
  const date = list.date
    ? list.overdue
      ? `Overdue: ${shortDate(list.date)}`
      : `Due ${shortDate(list.date)}`
    : null
  return (
    <div
      className="grid gap-2 rounded-card bg-surface p-3 shadow-card"
      data-shot-list-id={list.id}
    >
      <div className="flex flex-wrap items-center gap-2">
        {list.state === "completed" ? (
          <StatusChip state="request_completed" />
        ) : list.state === "cancelled" ? (
          <StatusChip state="request_cancelled" />
        ) : null}
        {list.overdue ? <StatusChip state="overdue" /> : null}
      </div>
      <p className="text-label [overflow-wrap:anywhere] text-ink">
        {list.name}
      </p>
      <p className="font-mono text-mono font-semibold text-ink-muted tabular-nums">
        {list.completed} of {list.total} completed
      </p>
      <p className="text-meta [overflow-wrap:anywhere] text-ink-muted">
        {[REQUEST_WORDS.purpose[list.purpose], date, list.note]
          .filter(Boolean)
          .join(" · ")}
      </p>
      {list.cancelReason ? (
        <p className="text-meta text-ink-muted">
          Cancelled: {list.cancelReason}
        </p>
      ) : null}
      {list.state === "open" ? (
        open ? (
          <form
            noValidate
            className="grid gap-2"
            onSubmit={(event) => {
              event.preventDefault()
              if (!reason.trim()) return
              void run(() =>
                cancel({
                  shotListId: list.id,
                  revision: list.revision,
                  reason: reason.trim(),
                })
              )
            }}
          >
            {error ? <Notice tone="negative">{error}</Notice> : null}
            <FormField
              label="Reason"
              description="Its open requests are cancelled with this reason."
            >
              <Input
                value={reason}
                maxLength={REASON_MAX}
                onChange={(e) => setReason(e.target.value)}
              />
            </FormField>
            <div className="flex flex-wrap gap-2">
              <Button
                type="submit"
                variant="danger-quiet"
                loading={busy}
                disabled={busy || !reason.trim()}
              >
                Cancel the list
              </Button>
              <Button
                type="button"
                variant="quiet"
                onClick={() => setOpen(false)}
              >
                Keep it
              </Button>
            </div>
          </form>
        ) : (
          <Button
            type="button"
            variant="quiet"
            size="sm"
            className="justify-self-start"
            onClick={() => setOpen(true)}
          >
            Cancel…
          </Button>
        )
      ) : null}
    </div>
  )
}

export function NewShotListForm({
  today,
  create,
}: {
  today: string
  create: ShotListActions["create"]
}) {
  const { busy, error, run } = useRun()
  const [name, setName] = React.useState("")
  const [purpose, setPurpose] = React.useState<ShotListPurpose>("menu_launch")
  const [date, setDate] = React.useState("")
  const [note, setNote] = React.useState("")
  const [done, setDone] = React.useState(false)
  return (
    <form
      noValidate
      data-slot="new-shot-list"
      className="grid gap-3 rounded-card bg-surface p-3 shadow-card sm:p-4"
      onSubmit={(event) => {
        event.preventDefault()
        setDone(false)
        void run(() =>
          create({ name, purpose, date: date || null, note: note || null })
        ).then((ok) => {
          if (!ok) return
          setDone(true)
          setName("")
          setNote("")
          setDate("")
        })
      }}
    >
      <h3 className="text-heading text-ink">New shot list</h3>
      {error ? <Notice tone="negative">{error}</Notice> : null}
      {done ? (
        <Notice tone="positive">
          The shot list is made. Add requests to it from their form.
        </Notice>
      ) : null}
      <FormField label="Name">
        <Input
          value={name}
          maxLength={SHOT_LIST_NAME_MAX}
          onChange={(e) => setName(e.target.value)}
        />
      </FormField>
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label="For">
          <OptionSelect
            options={SHOT_LIST_PURPOSES.map((p) => ({
              id: p,
              name: REQUEST_WORDS.purpose[p],
            }))}
            value={purpose}
            onValueChange={(v) => v && setPurpose(v as ShotListPurpose)}
          />
        </FormField>
        <FormField label="Due" optional>
          <Input
            type="date"
            min={today}
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </FormField>
      </div>
      <FormField label="Note" optional>
        <Input
          value={note}
          maxLength={SHOT_LIST_NOTE_MAX}
          onChange={(e) => setNote(e.target.value)}
        />
      </FormField>
      <Button
        type="submit"
        variant="secondary"
        loading={busy}
        disabled={busy || !name.trim()}
      >
        Make the shot list
      </Button>
    </form>
  )
}
