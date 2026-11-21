"use client"

import * as React from "react"
import { useRouter } from "next/navigation"

import { Notice } from "@/components/nabalens/notice"
import { OptionSelect } from "@/components/nabalens/option-select"
import { useSessionEndedCatch } from "@/components/nabalens/session-guard-host"
import { StatusChip, type ChipTone } from "@/components/nabalens/status-chip"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { FormField } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import type { MenuSpecial, SpecialState } from "@/lib/server/menus/local"
import { cn } from "@/lib/utils"

import type { LocalAction } from "../local-actions"

// Spec §4.3, §7 M5 (S1-MENUS): dated local specials. A manager creates one
// running; staff suggestions wait here for Accept or Decline. On its end
// date a special asks for review: End it, or Extend it to a new date.
// Second handoff: the add form opens in a Dialog from the title row, and the
// list leads with what needs a decision.

export const SPECIAL_STATE_WORD: Record<SpecialState, string> = {
  suggested: "Suggested by staff",
  upcoming: "Starts soon",
  running: "Running",
  review_due: "Ended: review",
  declined: "Declined",
  ended: "Ended",
}

const SPECIAL_STATE_TONE: Record<SpecialState, ChipTone> = {
  suggested: "pending",
  upcoming: "pending",
  running: "positive",
  review_due: "attention",
  declined: "closed",
  ended: "closed",
}

/** The list's groups, in order (second handoff). */
const GROUPS: ReadonlyArray<{ title: string; states: SpecialState[] }> = [
  { title: "Needs a decision", states: ["suggested", "review_due"] },
  { title: "On now and coming", states: ["running", "upcoming"] },
  { title: "Ended and declined", states: ["ended", "declined"] },
]

type Run = (input: unknown) => Promise<LocalAction<object>>

const KINDS = [
  { id: "food", name: "Food" },
  { id: "drinks", name: "Drinks" },
]
const KIND_WORD: Record<string, string> = Object.fromEntries(
  KINDS.map((k) => [k.id, k.name])
)

function useRun() {
  const router = useRouter()
  const sessionEnded = useSessionEndedCatch()
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const run = async (action: Run, input: unknown) => {
    if (busy) return false
    setBusy(true)
    setError(null)
    try {
      const result = await action(input)
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

export function CreateSpecialForm({
  today,
  create,
  onDone,
}: {
  today: string
  create: Run
  /** Called once the special is added (the Dialog closes). */
  onDone?: () => void
}) {
  const { busy, error, run } = useRun()
  const [name, setName] = React.useState("")
  const [kind, setKind] = React.useState<string | null>("food")
  const [startsOn, setStartsOn] = React.useState(today)
  const [endsOn, setEndsOn] = React.useState("")
  const [description, setDescription] = React.useState("")
  const [done, setDone] = React.useState(false)
  return (
    <form
      className={cn(
        "grid gap-3",
        !onDone && "rounded-card bg-surface p-3 shadow-card sm:p-4"
      )}
      noValidate
      onSubmit={(event) => {
        event.preventDefault()
        setDone(false)
        void run(create, {
          name,
          kind,
          startsOn,
          endsOn,
          description: description || null,
        }).then((ok) => {
          if (!ok) return
          setDone(true)
          setName("")
          setDescription("")
          setEndsOn("")
          onDone?.()
        })
      }}
    >
      {error ? <Notice tone="negative">{error}</Notice> : null}
      {done ? <Notice tone="positive">The special is added.</Notice> : null}
      <FormField label="Name">
        <Input
          value={name}
          maxLength={120}
          onChange={(e) => setName(e.target.value)}
        />
      </FormField>
      <FormField label="Food or drink">
        <OptionSelect options={KINDS} value={kind} onValueChange={setKind} />
      </FormField>
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label="From">
          <Input
            type="date"
            value={startsOn}
            onChange={(e) => setStartsOn(e.target.value)}
          />
        </FormField>
        <FormField label="Until" description="It asks for review after this.">
          <Input
            type="date"
            min={today}
            value={endsOn}
            onChange={(e) => setEndsOn(e.target.value)}
          />
        </FormField>
      </div>
      <FormField label="Description (optional)">
        <Input
          value={description}
          maxLength={600}
          onChange={(e) => setDescription(e.target.value)}
        />
      </FormField>
      <Button type="submit" variant="primary" disabled={busy}>
        Add special
      </Button>
    </form>
  )
}

/** The title row's button and the Dialog it opens. */
export function AddSpecialDialog({
  today,
  create,
}: {
  today: string
  create: Run
}) {
  const [open, setOpen] = React.useState(false)
  return (
    <>
      <Button variant="primary" onClick={() => setOpen(true)}>
        Add a special
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add a special</DialogTitle>
            <DialogDescription>
              A dated dish or drink, on at this venue for a while.
            </DialogDescription>
          </DialogHeader>
          <CreateSpecialForm
            today={today}
            create={create}
            onDone={() => setOpen(false)}
          />
        </DialogContent>
      </Dialog>
    </>
  )
}

function SpecialRow({
  special,
  today,
  decide,
  review,
}: {
  special: MenuSpecial
  today: string
  decide: Run
  review: Run
}) {
  const { busy, error, run } = useRun()
  const [reason, setReason] = React.useState("")
  const [until, setUntil] = React.useState("")
  // Decline asks for its reason; Extend for the new date.
  const [asking, setAsking] = React.useState<"decline" | "extend" | null>(null)
  const base = { specialId: special.specialId, revision: special.revision }
  const dated =
    special.state === "running" ||
    special.state === "review_due" ||
    special.state === "upcoming"
  return (
    <li className="grid gap-3 px-4 py-3" data-special={special.state}>
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 gap-y-1">
        <div className="grid min-w-0 gap-0.5">
          <p className="text-label [overflow-wrap:anywhere] text-ink">
            {special.name}
          </p>
          <p className="text-meta text-ink-muted">
            {KIND_WORD[special.kind] ?? special.kind} · {special.startsOn} to{" "}
            {special.endsOn}
          </p>
        </div>
        <StatusChip tone={SPECIAL_STATE_TONE[special.state]}>
          {SPECIAL_STATE_WORD[special.state]}
        </StatusChip>
      </div>
      {special.description ? (
        <p className="text-body text-ink-muted">{special.description}</p>
      ) : null}
      {special.decisionReason ? (
        <p className="text-body text-ink-muted">{special.decisionReason}</p>
      ) : null}
      {error ? <Notice tone="negative">{error}</Notice> : null}
      {special.state === "suggested" ? (
        <div className="grid gap-2">
          {asking === "decline" ? (
            <FormField label="Reason (needed to decline)">
              <Input
                autoFocus
                value={reason}
                maxLength={300}
                onChange={(e) => setReason(e.target.value)}
              />
            </FormField>
          ) : null}
          <div className="flex flex-wrap gap-2">
            {asking === "decline" ? (
              <>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={busy}
                  onClick={() =>
                    void run(decide, { ...base, accept: false, reason })
                  }
                >
                  Decline
                </Button>
                <Button
                  size="sm"
                  variant="quiet"
                  disabled={busy}
                  onClick={() => setAsking(null)}
                >
                  Cancel
                </Button>
              </>
            ) : (
              <>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={busy}
                  onClick={() =>
                    void run(decide, { ...base, accept: true, reason: null })
                  }
                >
                  Accept
                </Button>
                <Button
                  size="sm"
                  variant="quiet"
                  disabled={busy}
                  onClick={() => setAsking("decline")}
                >
                  Decline
                </Button>
              </>
            )}
          </div>
        </div>
      ) : null}
      {dated ? (
        <div className="grid gap-2">
          {asking === "extend" ? (
            <FormField label="New end date">
              <Input
                type="date"
                min={today}
                value={until}
                onChange={(e) => setUntil(e.target.value)}
              />
            </FormField>
          ) : null}
          <div className="flex flex-wrap gap-2">
            {asking === "extend" ? (
              <>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={busy}
                  onClick={() =>
                    void run(review, {
                      ...base,
                      action: "extend",
                      endsOn: until,
                    })
                  }
                >
                  Extend
                </Button>
                <Button
                  size="sm"
                  variant="quiet"
                  disabled={busy}
                  onClick={() => setAsking(null)}
                >
                  Cancel
                </Button>
              </>
            ) : (
              <>
                <Button
                  size="sm"
                  variant={
                    special.state === "review_due" ? "secondary" : "quiet"
                  }
                  disabled={busy}
                  onClick={() => void run(review, { ...base, action: "end" })}
                >
                  End it
                </Button>
                <Button
                  size="sm"
                  variant="quiet"
                  disabled={busy}
                  onClick={() => setAsking("extend")}
                >
                  Extend
                </Button>
              </>
            )}
          </div>
        </div>
      ) : null}
    </li>
  )
}

export function SpecialsList({
  specials,
  today,
  decide,
  review,
}: {
  specials: MenuSpecial[]
  today: string
  decide: Run
  review: Run
}) {
  if (specials.length === 0)
    return <Notice>No specials yet. Add one with Add a special.</Notice>
  return (
    <div className="grid gap-8">
      {GROUPS.map((group, i) => {
        const rows = specials.filter((s) => group.states.includes(s.state))
        if (rows.length === 0) return null
        const id = `specials-group-${i}`
        return (
          <section
            key={group.title}
            aria-labelledby={id}
            className="grid gap-3"
          >
            <h2
              id={id}
              className="flex flex-wrap items-baseline gap-x-3 px-1 type-section-title text-ink"
            >
              {group.title}
              <span className="text-meta font-normal text-ink-muted tabular-nums">
                {rows.length}
              </span>
            </h2>
            <ul className="divide-y divide-line overflow-hidden rounded-card bg-surface edge">
              {rows.map((s) => (
                <SpecialRow
                  key={s.specialId}
                  special={s}
                  today={today}
                  decide={decide}
                  review={review}
                />
              ))}
            </ul>
          </section>
        )
      })}
    </div>
  )
}
