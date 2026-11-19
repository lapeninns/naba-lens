"use client"

import { useState, useTransition } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { CheckIcon } from "@phosphor-icons/react/dist/ssr"

import { Button } from "@/components/ui/button"

/*
 * S2-MGR: "Still right" for facts and space photos that are unconfirmed or
 * due a check (spec §7 M5, §9.3; S1-FACTS reconfirm). Reconfirming keeps the
 * answer or photo as it is and restores it to current, without a new photo.
 * An item with no answer yet links to where it is answered instead. Each row
 * says what happened in place (DESIGN.md §6.7).
 *
 * S3-R2 (S3-E2E-2 F6): a confirmed item drops out of the server's list on
 * refresh, which used to take its "Confirmed as still right." status with
 * it. The list now stays mounted (it owns its empty text), keeps a confirmed
 * row where it was with its status, and shows the empty text under it once
 * nothing is left to confirm.
 */

export const STILL_RIGHT_COPY = {
  confirm: "Still right",
  saving: "Saving",
  done: "Confirmed as still right.",
  failed: "That didn't save. Reload the page and try again.",
  answer: "Answer it",
} as const

export type StillRightItem = {
  id: string
  title: string
  /** Short facts under the title: state, answer, last checked. */
  lines: string[]
  /** Sent to onConfirm; null when it needs an answer first (see href). */
  payload: Record<string, unknown> | null
  /** Where to answer or change it. */
  href: string | null
}

type Confirm = (
  input: unknown
) => Promise<{ ok: true } | { ok: false; message?: string }>

function Row({
  item,
  onConfirm,
  onDone,
}: {
  item: StillRightItem
  onConfirm: Confirm
  onDone: (item: StillRightItem) => void
}) {
  const router = useRouter()
  const [state, setState] = useState<"idle" | "done" | "error">("idle")
  const [message, setMessage] = useState<string | null>(null)
  const [pending, start] = useTransition()
  return (
    <li
      data-item={item.id}
      data-state={state}
      className="grid gap-3 rounded-card bg-surface p-4 edge sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
    >
      <div className="grid min-w-0 gap-1">
        <p className="text-label [overflow-wrap:anywhere] text-ink">
          {item.title}
        </p>
        {item.lines.map((line, i) => (
          <p key={i} className="text-body text-ink-muted">
            {line}
          </p>
        ))}
        {state === "done" ? (
          <p
            role="status"
            className="flex items-center gap-2 text-body text-ink"
          >
            <CheckIcon aria-hidden className="size-5 text-ok-fg" />
            {STILL_RIGHT_COPY.done}
          </p>
        ) : state === "error" ? (
          <p role="alert" className="text-body text-warn-fg">
            {message ?? STILL_RIGHT_COPY.failed}
          </p>
        ) : null}
      </div>
      {state === "done" ? null : item.payload ? (
        <Button
          variant="secondary"
          className="max-sm:w-full"
          loading={pending}
          loadingLabel={STILL_RIGHT_COPY.saving}
          aria-label={`${STILL_RIGHT_COPY.confirm}: ${item.title}`}
          onClick={() =>
            start(async () => {
              const result = await onConfirm(item.payload)
              if (result.ok) {
                setState("done")
                onDone(item)
                router.refresh()
              } else {
                setMessage(result.message ?? null)
                setState("error")
              }
            })
          }
        >
          <CheckIcon data-icon="inline-start" aria-hidden />
          {STILL_RIGHT_COPY.confirm}
        </Button>
      ) : item.href ? (
        <Link
          href={item.href}
          className="justify-self-start text-body font-semibold text-accent-text underline underline-offset-4 focus-ring"
        >
          {STILL_RIGHT_COPY.answer}
        </Link>
      ) : null}
    </li>
  )
}

export function StillRightList({
  items,
  onConfirm,
  label,
  empty,
}: {
  items: StillRightItem[]
  onConfirm: Confirm
  /** Accessible name of the list. */
  label: string
  /** Shown when nothing is left to confirm. */
  empty?: string
}) {
  // Confirmed rows, in the order they were confirmed, kept after the
  // refreshed list no longer has them (F6).
  const [confirmed, setConfirmed] = useState<StillRightItem[]>([])
  const onDone = (item: StillRightItem) =>
    setConfirmed((prev) =>
      prev.some((p) => p.id === item.id) ? prev : [...prev, item]
    )
  const ids = new Set(items.map((i) => i.id))
  const shown = [...items, ...confirmed.filter((c) => !ids.has(c.id))]
  const open = items.filter((i) => !confirmed.some((c) => c.id === i.id))
  return (
    <>
      {shown.length > 0 ? (
        <ul aria-label={label} className="grid gap-2">
          {shown.map((item) => (
            <Row
              key={item.id}
              item={item}
              onConfirm={onConfirm}
              onDone={onDone}
            />
          ))}
        </ul>
      ) : null}
      {open.length === 0 && empty ? (
        <p className="text-body text-ink-muted">{empty}</p>
      ) : null}
    </>
  )
}
