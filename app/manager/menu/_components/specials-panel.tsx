"use client"

import * as React from "react"
import { useRouter } from "next/navigation"

import { Notice } from "@/components/nabalens/notice"
import { OptionSelect } from "@/components/nabalens/option-select"
import { useSessionEndedCatch } from "@/components/nabalens/session-guard-host"
import { Button } from "@/components/ui/button"
import { FormField } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import type { MenuSpecial, SpecialState } from "@/lib/server/menus/local"

import type { LocalAction } from "../local-actions"

// Spec §4.3, §7 M5 (S1-MENUS): dated local specials. A manager creates one
// running; staff suggestions wait here for Accept or Decline. On its end
// date a special asks for review: End it, or Extend it to a new date.

export const SPECIAL_STATE_WORD: Record<SpecialState, string> = {
  suggested: "Suggested by staff",
  upcoming: "Starts soon",
  running: "Running",
  review_due: "Ended: review",
  declined: "Declined",
  ended: "Ended",
}

type Run = (input: unknown) => Promise<LocalAction<object>>

const KINDS = [
  { id: "food", name: "Food" },
  { id: "drinks", name: "Drinks" },
]

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
}: {
  today: string
  create: Run
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
      className="grid gap-3 rounded-card bg-surface p-3 shadow-card sm:p-4"
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
  const base = { specialId: special.specialId, revision: special.revision }
  return (
    <li className="grid gap-2 py-3">
      <p className="text-body text-ink">
        <span className="font-semibold">{special.name}</span> ·{" "}
        {SPECIAL_STATE_WORD[special.state]} · {special.startsOn} to{" "}
        {special.endsOn}
      </p>
      {special.description ? (
        <p className="text-body text-ink-muted">{special.description}</p>
      ) : null}
      {special.decisionReason ? (
        <p className="text-body text-ink-muted">{special.decisionReason}</p>
      ) : null}
      {error ? <Notice tone="negative">{error}</Notice> : null}
      {special.state === "suggested" ? (
        <div className="grid gap-2">
          <FormField label="Reason (needed to decline)">
            <Input
              value={reason}
              maxLength={300}
              onChange={(e) => setReason(e.target.value)}
            />
          </FormField>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="primary"
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
              onClick={() =>
                void run(decide, { ...base, accept: false, reason })
              }
            >
              Decline
            </Button>
          </div>
        </div>
      ) : null}
      {special.state === "running" ||
      special.state === "review_due" ||
      special.state === "upcoming" ? (
        <div className="grid gap-2">
          <FormField label="New end date">
            <Input
              type="date"
              min={today}
              value={until}
              onChange={(e) => setUntil(e.target.value)}
            />
          </FormField>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="secondary"
              disabled={busy}
              onClick={() =>
                void run(review, { ...base, action: "extend", endsOn: until })
              }
            >
              Extend
            </Button>
            <Button
              size="sm"
              variant={special.state === "review_due" ? "primary" : "quiet"}
              disabled={busy}
              onClick={() => void run(review, { ...base, action: "end" })}
            >
              End it
            </Button>
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
    return <Notice>No specials yet. Add one above.</Notice>
  return (
    <ul className="divide-y divide-line rounded-card bg-surface px-3 shadow-card sm:px-4">
      {specials.map((s) => (
        <SpecialRow
          key={s.specialId}
          special={s}
          today={today}
          decide={decide}
          review={review}
        />
      ))}
    </ul>
  )
}
