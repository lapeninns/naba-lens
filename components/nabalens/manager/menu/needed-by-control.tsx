"use client"

import * as React from "react"
import { useRouter } from "next/navigation"

import {
  CoverageNotice,
  type Notice,
} from "@/components/nabalens/coverage/coverage-notice"
import { failureText } from "@/components/nabalens/coverage/copy"
import {
  NEEDED_BY_CONTROL_COPY,
  NEEDED_BY_COPY,
} from "@/components/nabalens/menu-photos/copy"
import { NeededByChip } from "@/components/nabalens/menu-photos/needed-by-chip"
import { useSessionEndedCatch } from "@/components/nabalens/session-guard-host"
import { Button } from "@/components/ui/button"
import { FormField } from "@/components/ui/field"
import { Input } from "@/components/ui/input"

import type { NeededBy } from "@/lib/server/coverage/types"
import type { MenuPhotoResult } from "@/lib/server/menu-photos/types"

// G-7: set or clear "needed by" on one still-needed dish, for the venue's
// manager (/manager/menu) and admins (the venue's Our menu page). The dish
// then leads Still needed for everyone at the venue, with its date; it
// clears itself when a photo of the dish is accepted. Never Overdue.

export type SetNeededBy = (
  input: unknown
) => Promise<MenuPhotoResult<{ neededBy: NeededBy }>>
export type ClearNeededBy = (
  input: unknown
) => Promise<MenuPhotoResult<{ cleared: boolean }>>

export { NEEDED_BY_CONTROL_COPY }

export function NeededByControl({
  item,
  venueId,
  today,
  maxDate,
  setAction,
  clearAction,
}: {
  item: {
    itemId: string
    name: string
    /** The dish has an accepted photo: no date can be set. */
    covered: boolean
    neededBy: NeededBy | null
  }
  /** Admins name the venue; a manager's venue comes from their scope. */
  venueId?: string
  /** London "YYYY-MM-DD" bounds for the date field. */
  today: string
  maxDate: string
  setAction: SetNeededBy
  clearAction: ClearNeededBy
}) {
  const copy = NEEDED_BY_CONTROL_COPY
  const router = useRouter()
  const sessionEnded = useSessionEndedCatch()
  const [date, setDate] = React.useState(item.neededBy?.date ?? "")
  const [busy, setBusy] = React.useState<"save" | "clear" | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [notice, setNotice] = React.useState<Notice | null>(null)
  const scope = venueId ? { venueId } : {}

  // The read never returns a date for a dish with an accepted photo.
  if (item.covered) return null

  async function save(event: React.FormEvent) {
    event.preventDefault()
    if (busy) return
    setBusy("save")
    setError(null)
    setNotice(null)
    try {
      const result = await setAction({
        ...scope,
        itemId: item.itemId,
        neededBy: date,
      })
      if (result.ok) {
        setNotice({
          tone: "success",
          text: copy.saved(item.name, NEEDED_BY_COPY.label(result.neededBy)),
        })
        router.refresh()
        return
      }
      if (result.code === "invalid_input" && result.fieldErrors?.neededBy) {
        setError(result.fieldErrors.neededBy)
        return
      }
      setNotice({ tone: "error", text: failureText(result) })
      if (result.needsRefresh) router.refresh()
    } catch (cause) {
      setNotice({ tone: "error", text: sessionEnded(cause) ?? copy.network })
    } finally {
      setBusy(null)
    }
  }

  async function clear() {
    if (busy) return
    setBusy("clear")
    setError(null)
    setNotice(null)
    try {
      const result = await clearAction({ ...scope, itemId: item.itemId })
      if (result.ok) {
        setDate("")
        setNotice({ tone: "success", text: copy.cleared(item.name) })
        router.refresh()
        return
      }
      setNotice({ tone: "error", text: failureText(result) })
    } catch (cause) {
      setNotice({ tone: "error", text: sessionEnded(cause) ?? copy.network })
    } finally {
      setBusy(null)
    }
  }

  return (
    <section aria-labelledby="item-needed-by" className="grid gap-3">
      <h2 id="item-needed-by" className="px-1 text-heading text-ink">
        {copy.title}
      </h2>
      <CoverageNotice notice={notice} onDismiss={() => setNotice(null)} />
      <div className="grid gap-3 rounded-card bg-surface p-3 shadow-card sm:p-4">
        {item.neededBy ? (
          <p>
            <NeededByChip neededBy={item.neededBy} />
          </p>
        ) : null}
        <p className="text-body text-ink-muted">{copy.intro}</p>
        <form
          onSubmit={(event) => void save(event)}
          className="grid gap-3"
          noValidate
        >
          <FormField label={copy.date} description={copy.hint} error={error}>
            <Input
              type="date"
              min={today}
              max={maxDate}
              value={date}
              onChange={(event) => setDate(event.currentTarget.value)}
              className="max-w-xs"
            />
          </FormField>
          <div className="flex flex-wrap gap-2">
            <Button
              type="submit"
              variant="primary"
              size="sm"
              loading={busy === "save"}
              loadingLabel={copy.saving}
              disabled={busy !== null && busy !== "save"}
            >
              {copy.save}
            </Button>
            {item.neededBy ? (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                loading={busy === "clear"}
                loadingLabel={copy.clearing}
                disabled={busy !== null && busy !== "clear"}
                onClick={() => void clear()}
              >
                {copy.clear}
              </Button>
            ) : null}
          </div>
        </form>
      </div>
    </section>
  )
}
