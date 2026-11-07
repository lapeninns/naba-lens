"use client"

import * as React from "react"
import {
  ArrowCounterClockwiseIcon,
  ArrowsLeftRightIcon,
  CameraRotateIcon,
  CaretDownIcon,
  CheckIcon,
  StarIcon,
} from "@phosphor-icons/react"

import { Button } from "@/components/ui/button"

import {
  availableActions,
  MORE_ACTIONS,
  type CardAction,
  type ListCard,
  type ReviewScopeKind,
} from "./card-model"
import { REVIEW_COPY } from "./review-copy"

const LABEL: Record<CardAction, string> = {
  accept: REVIEW_COPY.accept,
  accept_preferred: REVIEW_COPY.acceptPreferred,
  set_preferred: REVIEW_COPY.setPreferred,
  reaccept: REVIEW_COPY.reaccept,
  relink: REVIEW_COPY.relink,
  assign_stale: REVIEW_COPY.chooseItem,
  assign_unlabelled: REVIEW_COPY.chooseItem,
  also_assign: REVIEW_COPY.alsoUse,
  ask_another: REVIEW_COPY.askAnother,
  withdraw: REVIEW_COPY.withdraw,
}

const ICON: Partial<Record<CardAction, React.ReactNode>> = {
  accept: <CheckIcon data-icon="inline-start" aria-hidden />,
  reaccept: <CheckIcon data-icon="inline-start" aria-hidden />,
  accept_preferred: <StarIcon data-icon="inline-start" aria-hidden />,
  set_preferred: <StarIcon data-icon="inline-start" aria-hidden />,
  relink: <ArrowsLeftRightIcon data-icon="inline-start" aria-hidden />,
  assign_stale: <ArrowsLeftRightIcon data-icon="inline-start" aria-hidden />,
  assign_unlabelled: (
    <ArrowsLeftRightIcon data-icon="inline-start" aria-hidden />
  ),
  ask_another: <CameraRotateIcon data-icon="inline-start" aria-hidden />,
  withdraw: <ArrowCounterClockwiseIcon data-icon="inline-start" aria-hidden />,
}

/** The first action is the card's main one (Accept for this item, when offered). */
const PRIMARY: readonly CardAction[] = [
  "accept",
  "reaccept",
  "assign_stale",
  "assign_unlabelled",
]

/**
 * The decision buttons of one card: only the ones its state allows (the
 * §4.5 table). Withdraw and "Also use for another item" sit behind "More
 * actions" unless nothing else is offered. Every button waits while any
 * decision is in flight, so one click never decides twice.
 */
export function ReviewActions({
  card,
  busy,
  pending,
  onAction,
  scopeKind = "manager",
}: {
  card: ListCard
  busy: boolean
  /** The action in flight on this card. */
  pending: CardAction | null
  onAction: (action: CardAction, trigger: HTMLElement) => void
  /** Admins may review their own photos; managers may not. */
  scopeKind?: ReviewScopeKind
}) {
  const id = React.useId()
  const [more, setMore] = React.useState(false)
  const actions = availableActions(card, scopeKind)
  if (actions.length === 0) return null
  const main = actions.filter((a) => !MORE_ACTIONS.includes(a))
  const extra = actions.filter((a) => MORE_ACTIONS.includes(a))
  const direct = main.length > 0 ? main : extra
  const hidden = main.length > 0 ? extra : []

  const button = (action: CardAction, index: number) => (
    <Button
      key={action}
      type="button"
      size="touch"
      variant={
        index === 0 && PRIMARY.includes(action)
          ? "primary"
          : action === "withdraw"
            ? "destructive"
            : "secondary"
      }
      disabled={busy}
      aria-busy={pending === action || undefined}
      data-card-action={action}
      onClick={(event) => onAction(action, event.currentTarget)}
    >
      {ICON[action]}
      {pending === action ? REVIEW_COPY.saving : LABEL[action]}
    </Button>
  )

  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap gap-2 @max-[40rem]:*:flex-auto">
        {direct.map(button)}
        {hidden.length > 0 ? (
          <Button
            type="button"
            size="touch"
            variant="quiet"
            aria-expanded={more}
            aria-controls={`${id}-more`}
            data-card-action="more"
            onClick={() => setMore((open) => !open)}
          >
            {REVIEW_COPY.moreActions}
            <CaretDownIcon
              data-icon="inline-end"
              aria-hidden
              className={more ? "rotate-180" : undefined}
            />
          </Button>
        ) : null}
      </div>
      {hidden.length > 0 ? (
        <div
          id={`${id}-more`}
          hidden={!more}
          className="flex flex-wrap gap-2 @max-[40rem]:*:flex-auto"
        >
          {more ? hidden.map((a, i) => button(a, i + direct.length)) : null}
        </div>
      ) : null}
    </div>
  )
}

export { LABEL as ACTION_LABEL }
