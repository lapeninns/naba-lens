"use client"

import * as React from "react"
import { useRouter } from "next/navigation"

import { Notice } from "@/components/nabalens/notice"
import { OptionSelect } from "@/components/nabalens/option-select"
import { useSessionEndedCatch } from "@/components/nabalens/session-guard-host"
import { Button } from "@/components/ui/button"
import { FormField } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"

import type { LocalAction } from "../local-actions"

// Spec §7 M5, §4.3 (S1-MENUS): what a manager changes about one dish at
// their venue without a new menu. Sold out keeps the dish's photo request
// and history (AC26); a local name is audited; a presentation change sends
// accepted photos back for a recheck; anything permanent is a request to an
// admin. Each card is its own small form with its own result.

export const OFFERING_COPY = {
  title: "At this venue",
  availability: {
    title: "Availability",
    available: "On the menu today.",
    unavailable: (until: string | null) =>
      until ? `Not on until ${until}.` : "Not on today.",
    keeps: "Its photo request and history stay as they are.",
    reason: "Why it is off",
    until: "Back on (optional)",
    markOff: "Mark not available",
    markOn: "Back on the menu",
  },
  name: {
    title: "Local name",
    intro: "The name staff see here, if it differs from the menu.",
    label: "Local name",
    reason: "Why it differs",
    save: "Save name",
    clear: "Use the menu name",
  },
  presentation: {
    title: "Presentation changed",
    intro:
      "The plating, portion, ingredients or sides changed. Accepted photos go back for a recheck.",
    note: "What changed",
    save: "Mark as changed",
    done: (n: number) =>
      n === 0
        ? "Recorded. No accepted photo needed a recheck."
        : `Recorded. ${n === 1 ? "1 photo goes" : `${n} photos go`} back for a recheck.`,
  },
  request: {
    title: "Ask for a permanent change",
    intro: "An admin decides. You see the answer on the Menus page.",
    kind: "Change",
    detail: "Details",
    send: "Send request",
    sent: "Request sent to an admin.",
  },
  network: "That didn't go through. Check your connection and try again.",
} as const

const KIND_OPTIONS = [
  { id: "rename", name: "Rename" },
  { id: "remove", name: "Remove from the menu" },
  { id: "presentation", name: "Presentation" },
  { id: "other", name: "Other" },
]

type Run = (input: unknown) => Promise<LocalAction<object>>

/** A card's submit: busy flag, result notice, refresh on success. */
function useSubmit() {
  const router = useRouter()
  const sessionEnded = useSessionEndedCatch()
  const [busy, setBusy] = React.useState(false)
  const [notice, setNotice] = React.useState<{
    tone: "positive" | "negative"
    text: string
  } | null>(null)
  const submit = async (
    run: Run,
    input: unknown,
    success: (result: Record<string, unknown>) => string
  ) => {
    if (busy) return false
    setBusy(true)
    setNotice(null)
    try {
      const result = await run(input)
      if (!result.ok) {
        setNotice({ tone: "negative", text: result.error })
        return false
      }
      setNotice({
        tone: "positive",
        text: success(result as Record<string, unknown>),
      })
      router.refresh()
      return true
    } catch (cause) {
      setNotice({
        tone: "negative",
        text: sessionEnded(cause) ?? OFFERING_COPY.network,
      })
      return false
    } finally {
      setBusy(false)
    }
  }
  return { busy, notice, submit }
}

function Card({
  title,
  children,
  notice,
}: {
  title: string
  children: React.ReactNode
  notice: { tone: "positive" | "negative"; text: string } | null
}) {
  const id = React.useId()
  return (
    <section
      aria-labelledby={id}
      className="grid gap-3 rounded-card bg-surface p-3 shadow-card sm:p-4"
    >
      <h3 id={id} className="text-heading text-ink">
        {title}
      </h3>
      {notice ? <Notice tone={notice.tone}>{notice.text}</Notice> : null}
      {children}
    </section>
  )
}

export type OfferingControlsProps = {
  itemId: string
  menuName: string
  /** Admins name the venue; a manager's comes from their scope. */
  venueId?: string
  state: {
    available: boolean
    unavailableUntil: string | null
    unavailableReason: string | null
    displayName: string | null
  }
  /** London "YYYY-MM-DD", the earliest Back on date. */
  today: string
  actions: {
    setAvailability: Run
    setDisplayName: Run
    presentationChanged: Run
    requestChange: Run
  }
}

export function OfferingControls(props: OfferingControlsProps) {
  const copy = OFFERING_COPY
  return (
    <section aria-labelledby="item-offering" className="grid gap-3">
      <h2 id="item-offering" className="px-1 text-heading text-ink">
        {copy.title}
      </h2>
      <AvailabilityCard {...props} />
      <DisplayNameCard {...props} />
      <PresentationCard {...props} />
      <RequestCard {...props} />
    </section>
  )
}

function AvailabilityCard({
  itemId,
  venueId,
  state,
  today,
  actions,
}: OfferingControlsProps) {
  const copy = OFFERING_COPY.availability
  const { busy, notice, submit } = useSubmit()
  const [reason, setReason] = React.useState("")
  const [until, setUntil] = React.useState("")
  const scope = venueId ? { venueId } : {}
  return (
    <Card title={copy.title} notice={notice}>
      <p className="text-body text-ink">
        {state.available
          ? copy.available
          : copy.unavailable(state.unavailableUntil)}{" "}
        {!state.available && state.unavailableReason
          ? `(${state.unavailableReason})`
          : null}
      </p>
      <p className="text-body text-ink-muted">{copy.keeps}</p>
      {state.available ? (
        <form
          className="grid gap-3"
          noValidate
          onSubmit={(event) => {
            event.preventDefault()
            void submit(
              actions.setAvailability,
              { ...scope, itemId, available: false, reason, until },
              () => copy.unavailable(until || null)
            ).then((ok) => {
              if (ok) {
                setReason("")
                setUntil("")
              }
            })
          }}
        >
          <FormField label={copy.reason}>
            <Input
              value={reason}
              maxLength={300}
              onChange={(e) => setReason(e.target.value)}
            />
          </FormField>
          <FormField label={copy.until}>
            <Input
              type="date"
              min={today}
              value={until}
              onChange={(e) => setUntil(e.target.value)}
            />
          </FormField>
          <Button type="submit" variant="secondary" disabled={busy}>
            {copy.markOff}
          </Button>
        </form>
      ) : (
        <Button
          variant="secondary"
          disabled={busy}
          onClick={() =>
            void submit(
              actions.setAvailability,
              { ...scope, itemId, available: true },
              () => copy.available
            )
          }
        >
          {copy.markOn}
        </Button>
      )}
    </Card>
  )
}

function DisplayNameCard({
  itemId,
  venueId,
  menuName,
  state,
  actions,
}: OfferingControlsProps) {
  const copy = OFFERING_COPY.name
  const { busy, notice, submit } = useSubmit()
  const [name, setName] = React.useState(state.displayName ?? "")
  const [reason, setReason] = React.useState("")
  const scope = venueId ? { venueId } : {}
  return (
    <Card title={copy.title} notice={notice}>
      <p className="text-body text-ink-muted">
        {copy.intro} Menu name: {menuName}.
      </p>
      <form
        className="grid gap-3"
        noValidate
        onSubmit={(event) => {
          event.preventDefault()
          void submit(
            actions.setDisplayName,
            { ...scope, itemId, name, reason },
            () => `Staff now see “${name.trim()}”.`
          )
        }}
      >
        <FormField label={copy.label}>
          <Input
            value={name}
            maxLength={120}
            onChange={(e) => setName(e.target.value)}
          />
        </FormField>
        <FormField label={copy.reason}>
          <Input
            value={reason}
            maxLength={300}
            onChange={(e) => setReason(e.target.value)}
          />
        </FormField>
        <div className="flex flex-wrap gap-2">
          <Button type="submit" variant="secondary" disabled={busy}>
            {copy.save}
          </Button>
          {state.displayName ? (
            <Button
              type="button"
              variant="quiet"
              disabled={busy}
              onClick={() =>
                void submit(
                  actions.setDisplayName,
                  { ...scope, itemId, name: null, reason: reason || null },
                  () => `Staff see the menu name, ${menuName}.`
                ).then((ok) => ok && setName(""))
              }
            >
              {copy.clear}
            </Button>
          ) : null}
        </div>
      </form>
    </Card>
  )
}

function PresentationCard({ itemId, venueId, actions }: OfferingControlsProps) {
  const copy = OFFERING_COPY.presentation
  const { busy, notice, submit } = useSubmit()
  const [note, setNote] = React.useState("")
  const scope = venueId ? { venueId } : {}
  return (
    <Card title={copy.title} notice={notice}>
      <p className="text-body text-ink-muted">{copy.intro}</p>
      <form
        className="grid gap-3"
        noValidate
        onSubmit={(event) => {
          event.preventDefault()
          void submit(
            actions.presentationChanged,
            { ...scope, itemId, note },
            (r) =>
              copy.done(
                typeof r.photosToRecheck === "number" ? r.photosToRecheck : 0
              )
          ).then((ok) => ok && setNote(""))
        }}
      >
        <FormField label={copy.note}>
          <Input
            value={note}
            maxLength={300}
            onChange={(e) => setNote(e.target.value)}
          />
        </FormField>
        <Button type="submit" variant="secondary" disabled={busy}>
          {copy.save}
        </Button>
      </form>
    </Card>
  )
}

function RequestCard({ itemId, venueId, actions }: OfferingControlsProps) {
  const copy = OFFERING_COPY.request
  const { busy, notice, submit } = useSubmit()
  const [kind, setKind] = React.useState<string | null>("rename")
  const [detail, setDetail] = React.useState("")
  const scope = venueId ? { venueId } : {}
  return (
    <Card title={copy.title} notice={notice}>
      <p className="text-body text-ink-muted">{copy.intro}</p>
      <form
        className="grid gap-3"
        noValidate
        onSubmit={(event) => {
          event.preventDefault()
          void submit(
            actions.requestChange,
            { ...scope, itemId, kind, detail },
            () => copy.sent
          ).then((ok) => ok && setDetail(""))
        }}
      >
        <FormField label={copy.kind}>
          <OptionSelect
            options={KIND_OPTIONS}
            value={kind}
            onValueChange={setKind}
          />
        </FormField>
        <FormField label={copy.detail}>
          <Textarea
            value={detail}
            rows={3}
            maxLength={1000}
            onChange={(e) => setDetail(e.target.value)}
          />
        </FormField>
        <Button type="submit" variant="secondary" disabled={busy}>
          {copy.send}
        </Button>
      </form>
    </Card>
  )
}
