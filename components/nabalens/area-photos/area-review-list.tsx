"use client"

import * as React from "react"

import { decideAreaPhotoAction } from "@/app/manager/area-actions"
import {
  Card,
  CardFoot,
  CardHead,
} from "@/components/nabalens/common-room/card"
import { Notice } from "@/components/nabalens/notice"
import { StatusChip } from "@/components/nabalens/status-chip"
import { EvidenceThumb } from "@/components/nabalens/tasks/evidence-thumb"
import { Button } from "@/components/ui/button"
import { FormField } from "@/components/ui/field"
import { Heading } from "@/components/ui/heading"
import { Textarea } from "@/components/ui/textarea"
import type {
  AreaDecision,
  AreaPhotoCard,
  AreaPhotoState,
} from "@/lib/server/area-photos"

import { AREA_COPY } from "./copy"

const R = AREA_COPY.review

const monthName = (month: string) =>
  month
    ? new Intl.DateTimeFormat("en-GB", {
        month: "long",
        year: "numeric",
        timeZone: "UTC",
      }).format(new Date(`${month}T00:00:00Z`))
    : ""

const dayName = (at: string) =>
  at
    ? new Intl.DateTimeFormat("en-GB", {
        day: "numeric",
        month: "short",
        timeZone: "Europe/London",
      }).format(new Date(at))
    : ""

const chipOf = (state: AreaPhotoState) =>
  state === "pending" ? "submitted" : state === "withdrawn" ? "closed" : state

/**
 * G-9: venue-area photos on the Review screen. Each card shows the photo,
 * the area, who took it and the month it counts for, with Accept and "Ask
 * for another photo" (a reason is required). An accepted photo can be
 * withdrawn, with a reason. The reviewer's own photo has no actions.
 */
export function AreaReviewList({
  venueId,
  initial,
  decided = [],
}: {
  /** Named by the admin page; a manager acts on their workspace venue. */
  venueId?: string
  /** Photos waiting for review. */
  initial: AreaPhotoCard[]
  /**
   * Photos already decided, so an accepted photo can still be withdrawn and
   * a "needs another photo" one accepted after a reload.
   */
  decided?: AreaPhotoCard[]
}) {
  const [cards, setCards] = React.useState(initial)
  const [done, setDone] = React.useState(decided)
  const update =
    (set: React.Dispatch<React.SetStateAction<AreaPhotoCard[]>>) =>
    (labelId: string, state: AreaPhotoState, reason: string | null) =>
      set((prev) =>
        prev.map((c) =>
          c.labelId === labelId
            ? { ...c, state, reason, canDecide: state !== "withdrawn" }
            : c
        )
      )
  return (
    <section aria-labelledby="area-review-heading" className="grid gap-3">
      <div className="grid gap-1">
        <Heading level={2} id="area-review-heading">
          {R.heading}
        </Heading>
        <p className="text-meta text-ink-muted">{R.summary}</p>
      </div>
      {cards.length === 0 ? (
        <p className="text-body text-ink-muted">{R.empty}</p>
      ) : (
        <AreaCardList
          cards={cards}
          venueId={venueId}
          onDecided={update(setCards)}
        />
      )}
      {done.length > 0 ? (
        <section aria-labelledby="area-decided-heading" className="grid gap-3">
          <Heading level={3} id="area-decided-heading">
            {R.decidedHeading}
          </Heading>
          <AreaCardList
            cards={done}
            titleLevel={4}
            venueId={venueId}
            onDecided={update(setDone)}
          />
        </section>
      ) : null}
    </section>
  )
}

function AreaCardList({
  cards,
  venueId,
  titleLevel = 3,
  onDecided,
}: {
  cards: AreaPhotoCard[]
  venueId?: string
  titleLevel?: 3 | 4
  onDecided: (
    labelId: string,
    state: AreaPhotoState,
    reason: string | null
  ) => void
}) {
  return (
    <ul className="grid gap-3">
      {cards.map((card) => (
        <AreaReviewCard
          key={card.labelId}
          card={card}
          venueId={venueId}
          titleLevel={titleLevel}
          onDecided={(state, reason) => onDecided(card.labelId, state, reason)}
        />
      ))}
    </ul>
  )
}

function AreaReviewCard({
  card,
  venueId,
  titleLevel,
  onDecided,
}: {
  card: AreaPhotoCard
  venueId?: string
  titleLevel: 3 | 4
  onDecided: (state: AreaPhotoState, reason: string | null) => void
}) {
  const uid = React.useId()
  const [asking, setAsking] = React.useState<null | AreaDecision>(null)
  const [reason, setReason] = React.useState("")
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)

  async function send(decision: AreaDecision, why: string | null) {
    setBusy(true)
    setError(null)
    try {
      const result = await decideAreaPhotoAction({
        venueId,
        labelId: card.labelId,
        decision,
        reason: why,
      })
      if (!result.ok) {
        setError(result.fieldErrors?.reason ?? result.message)
        return
      }
      setAsking(null)
      setReason("")
      onDecided(result.state, why)
    } catch {
      setError("The decision wasn't saved. Try again.")
    } finally {
      setBusy(false)
    }
  }

  const askWithdraw = card.state === "accepted"
  return (
    <Card as="li" tight>
      <CardHead>
        <div className="flex min-w-0 items-center gap-3">
          <EvidenceThumb
            thumbnailUrl={card.thumbnailUrl}
            previewUrl={card.previewUrl}
            label={`${card.area}, ${R.by(card.authorName)}`}
            className="size-16"
          />
          <div className="grid min-w-0 gap-0.5">
            <Heading level={titleLevel} size="item-title">
              {card.area}
            </Heading>
            <p className="text-meta text-ink-muted">
              {`${R.by(card.authorName)} · ${dayName(card.uploadedAt)}`}
            </p>
            <p className="text-meta text-ink-muted">
              {R.countsFor(monthName(card.creditMonth))}
            </p>
          </div>
        </div>
        <StatusChip state={chipOf(card.state)}>
          {AREA_COPY.state[card.state]}
        </StatusChip>
      </CardHead>
      {card.reason && card.state !== "accepted" ? (
        <p className="text-body text-ink">{card.reason}</p>
      ) : null}
      {error ? (
        <Notice tone="negative" role="alert">
          {error}
        </Notice>
      ) : null}
      {asking ? (
        <form
          className="grid gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            void send(asking, reason.trim())
          }}
        >
          <FormField
            id={`${uid}-reason`}
            label={
              asking === "withdrawn" ? R.withdrawReasonLabel : R.reasonLabel
            }
          >
            <Textarea
              value={reason}
              maxLength={500}
              rows={2}
              onChange={(e) => setReason(e.currentTarget.value)}
            />
          </FormField>
          <div className="flex flex-wrap gap-2">
            <Button
              type="submit"
              variant="primary"
              disabled={busy || !reason.trim()}
            >
              {R.send}
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={busy}
              onClick={() => {
                setAsking(null)
                setReason("")
                setError(null)
              }}
            >
              {R.cancel}
            </Button>
          </div>
        </form>
      ) : card.canDecide ? (
        <CardFoot>
          {askWithdraw ? (
            <Button
              type="button"
              variant="secondary"
              disabled={busy}
              onClick={() => setAsking("withdrawn")}
            >
              {R.withdraw}
            </Button>
          ) : (
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="primary"
                disabled={busy}
                onClick={() => void send("accepted", null)}
              >
                {R.accept}
              </Button>
              {card.state === "pending" ? (
                <Button
                  type="button"
                  variant="secondary"
                  disabled={busy}
                  onClick={() => setAsking("needs_another_photo")}
                >
                  {R.askAnother}
                </Button>
              ) : null}
            </div>
          )}
        </CardFoot>
      ) : card.state !== "withdrawn" ? (
        <p className="text-meta text-ink-muted">{R.own}</p>
      ) : null}
    </Card>
  )
}
