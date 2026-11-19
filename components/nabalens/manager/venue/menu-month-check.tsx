"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { CheckIcon } from "@phosphor-icons/react/dist/ssr"

import { confirmMenuMonthAction } from "@/app/manager/venue/actions"
import { Button } from "@/components/ui/button"
import type { MenuMonthCheck } from "@/lib/manager/venue"

/*
 * S2-MGR: the lightweight monthly menu confirmation (spec §9.3). Shown on
 * Overview and on the Venue hub's Current menus. Saying "Still right" records
 * it for the month; a change goes through Request a menu change instead.
 * Feedback is written in place (DESIGN.md §6.7): no toasts.
 */

export const MENU_CHECK_COPY = {
  due: (month: string) => `${monthName(month)} check: is the menu still right?`,
  done: (month: string, by: string | null) =>
    by
      ? `Confirmed for ${monthName(month)} by ${by}.`
      : `Confirmed for ${monthName(month)}.`,
  confirm: "Still right",
  saving: "Saving",
  failed: "That didn't save. Try again.",
} as const

function monthName(month: string): string {
  const date = new Date(`${month}T12:00:00Z`)
  return Number.isNaN(date.getTime())
    ? month
    : date.toLocaleDateString("en-GB", { month: "long", timeZone: "UTC" })
}

export function MenuMonthCheckControl({
  check,
  onConfirm = confirmMenuMonthAction,
}: {
  /** Kept for callers that name the venue; the action uses the workspace's. */
  venueId?: string
  check: MenuMonthCheck
  onConfirm?: (
    input: unknown
  ) => Promise<
    { ok: true; check: MenuMonthCheck } | { ok: false; message: string }
  >
}) {
  const router = useRouter()
  const [current, setCurrent] = useState(check)
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()

  if (!current.due)
    return (
      <p
        data-slot="menu-check"
        data-state="done"
        className="flex items-start gap-2 text-body text-ink-muted"
      >
        <CheckIcon aria-hidden className="mt-1 size-5 shrink-0 text-ok-fg" />
        <span>{MENU_CHECK_COPY.done(current.month, current.confirmedBy)}</span>
      </p>
    )

  return (
    <div data-slot="menu-check" data-state="due" className="grid gap-2">
      <p className="text-body text-ink">{MENU_CHECK_COPY.due(current.month)}</p>
      <Button
        variant="secondary"
        className="justify-self-start max-md:w-full"
        loading={pending}
        loadingLabel={MENU_CHECK_COPY.saving}
        onClick={() =>
          start(async () => {
            setError(null)
            const result = await onConfirm({})
            if (result.ok) {
              setCurrent(result.check)
              router.refresh()
            } else setError(result.message || MENU_CHECK_COPY.failed)
          })
        }
      >
        <CheckIcon data-icon="inline-start" aria-hidden />
        {MENU_CHECK_COPY.confirm}
      </Button>
      {error ? (
        <p role="alert" className="text-body text-warn-fg">
          {error}
        </p>
      ) : null}
    </div>
  )
}
