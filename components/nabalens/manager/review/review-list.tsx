"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import {
  ArrowCounterClockwiseIcon,
  CameraRotateIcon,
} from "@phosphor-icons/react"

import { loadReviewPageAction } from "@/app/manager/actions"
import { failureText } from "@/components/nabalens/coverage/copy"
import { EvidenceThumb } from "@/components/nabalens/coverage/evidence-image"
import {
  ReasonDialog,
  type ReasonOutcome,
} from "@/components/nabalens/coverage/reason-dialog"
import { REPORTED } from "@/components/nabalens/coverage/use-coverage-action"
import { EmptyState } from "@/components/nabalens/empty-state"
import { LoadMoreButton } from "@/components/nabalens/load-more-button"
import { Notice } from "@/components/nabalens/notice"
import { buttonVariants } from "@/components/ui/button"
import type {
  DecisionOutcome,
  Page,
  QueueCard,
} from "@/lib/server/menu-photos/types"

import { managerHrefs } from "../hrefs"
import { useReviewCount } from "../review-count"
import { Announcer, type Announcement } from "./announcer"
import {
  announcement,
  applyCurrent,
  availableActions,
  decisionFor,
  mergeOutcome,
  ownPhotoBlocked,
  pendingDelta,
  PICKER_ACTIONS,
  staleLabelOf,
  type CardAction,
  type ListCard,
} from "./card-model"
import { ItemPickerDialog, type PickedItem } from "./item-picker-dialog"
import {
  reviewHref,
  venueIdOf,
  type ReviewScope,
  type ReviewView,
} from "./links"
import { PreviewDialog } from "./preview-dialog"
import { ReviewActions } from "./review-actions"
import { ReviewCard, type CardError } from "./review-card"
import { REVIEW_COPY } from "./review-copy"
import { useDecision, type DecisionPayload } from "./use-decision"

type DialogState =
  | { kind: "ask" | "withdraw"; card: ListCard }
  | { kind: "picker"; card: ListCard; action: CardAction }

type Group = { itemId: string | null; name: string | null; cards: ListCard[] }

/** Consecutive cards of the same item share a heading; itemless cards stand alone. */
function groupCards(cards: ListCard[]): Group[] {
  const groups: Group[] = []
  for (const card of cards) {
    const last = groups[groups.length - 1]
    const itemId = card.item?.itemId ?? null
    if (last && itemId && last.itemId === itemId) last.cards.push(card)
    else groups.push({ itemId, name: card.item?.name ?? null, cards: [card] })
  }
  return groups
}

/** The empty state for a status (the item and contributor views say "No photos here yet"). */
function EmptyFor({
  view,
  venueName,
  scope,
}: {
  view: ReviewView
  venueName: string
  scope: ReviewScope
}) {
  const e = REVIEW_COPY.empty
  const narrowed = view.itemId || view.contributorId || view.sectionId
  if (view.status === "pending" && !narrowed) {
    return (
      <EmptyState
        variant="done"
        title={e.pending}
        description={
          scope.kind === "manager" ? (
            <Link
              href={managerHrefs.menu({ status: "needs_photo" })}
              className={buttonVariants({ variant: "link" })}
            >
              {e.pendingGap}
            </Link>
          ) : undefined
        }
      />
    )
  }
  const title = narrowed
    ? e.other
    : view.status === "recheck"
      ? e.recheck
      : view.status === "stale_label"
        ? e.stale_label
        : view.status === "unlabelled"
          ? e.unlabelled(venueName)
          : view.status === "mine"
            ? e.mine
            : e.other
  return <EmptyState variant="done" title={title} />
}

/**
 * The photos of one Review view, grouped by item when consecutive. Each
 * decision updates the item's cards in place (no page refresh), so the
 * filter, the loaded pages and the scroll position stay; the live region says
 * what happened and focus moves to the next card's first action. A stale
 * revision applies the latest cards and warns; a decision that no longer
 * applies says so on the card with a Refresh link.
 */
export function ReviewList({
  initial,
  view,
  scope,
  venueName,
  now,
  showItemLinks = true,
  onDecided,
}: {
  initial: Page<QueueCard>
  view: ReviewView
  scope: ReviewScope
  venueName: string
  /** Render time (ISO), so waiting ages match between server and browser. */
  now: string
  /** Link item names to the item page (off on the item page itself). */
  showItemLinks?: boolean
  /** After a decision lands (e.g. the item page refreshes its detail). */
  onDecided?: (outcome: DecisionOutcome) => void
}) {
  const router = useRouter()
  const reviewCount = useReviewCount()
  const venueId = venueIdOf(scope)
  const decide = useDecision(view.status, venueId)

  const [seed, setSeed] = React.useState(initial)
  const [cards, setCards] = React.useState<ListCard[]>(initial.items)
  const [cursor, setCursor] = React.useState(initial.nextCursor)
  if (seed !== initial) {
    // A new filter (or a refresh): start over from the server's page.
    setSeed(initial)
    setCards(initial.items)
    setCursor(initial.nextCursor)
  }
  const [loading, setLoading] = React.useState(false)
  const [loadError, setLoadError] = React.useState<string | null>(null)
  const [notice, setNotice] = React.useState<Announcement | null>(null)
  const [errors, setErrors] = React.useState<Record<string, CardError>>({})
  const [pending, setPending] = React.useState<{
    key: string
    action: CardAction
  } | null>(null)
  const [dialog, setDialog] = React.useState<DialogState | null>(null)
  const [preview, setPreview] = React.useState<number | null>(null)

  const cardsRef = React.useRef(cards)
  React.useEffect(() => {
    cardsRef.current = cards
  }, [cards])
  const noticeRef = React.useRef<HTMLDivElement>(null)
  const listRef = React.useRef<HTMLDivElement>(null)
  const previewTriggerRef = React.useRef<HTMLElement | null>(null)
  /** Card key (or "notice") that takes focus after a decision. */
  const focusTargetRef = React.useRef<string | null>(null)
  /** Set for buttons without a dialog: focus moves once the list re-renders. */
  const focusPendingRef = React.useRef(false)

  // Keep only the fresh cards that belong in this view.
  const keep = React.useCallback(
    (card: QueueCard) =>
      (!view.contributorId || card.contributor.id === view.contributorId) &&
      (!view.sectionId ||
        !card.item ||
        card.item.sectionId === view.sectionId) &&
      // An item view shows that item only: a relink's target stays out.
      (!view.itemId || card.item?.itemId === view.itemId),
    [view.contributorId, view.sectionId, view.itemId]
  )

  const focusTarget = React.useCallback((): HTMLElement | null => {
    const key = focusTargetRef.current
    const root = listRef.current
    if (key && key !== "notice" && root) {
      const card = root.querySelector<HTMLElement>(
        `[data-card-key="${CSS.escape(key)}"]`
      )
      const button = card?.querySelector<HTMLElement>("[data-card-action]")
      if (button) return button
    }
    return noticeRef.current ?? listRef.current
  }, [])

  React.useEffect(() => {
    if (!focusPendingRef.current) return
    focusPendingRef.current = false
    focusTarget()?.focus()
  }, [cards, notice, focusTarget])

  /** The next card after `key` that still offers a decision. */
  function nextActionable(list: ListCard[], key: string): string | null {
    const at = list.findIndex((c) => c.key === key)
    for (let i = at + 1; i < list.length; i++)
      if (availableActions(list[i], scope.kind).length > 0) return list[i].key
    return null
  }

  function setCardError(key: string, error: CardError | null) {
    setErrors((current) => {
      const next = { ...current }
      if (error) next[key] = error
      else delete next[key]
      return next
    })
  }

  /** One decision on `card`; `target` is the picked item for picker actions. */
  async function run(
    card: ListCard,
    action: CardAction,
    extra: { reason?: string; target?: PickedItem } = {}
  ): Promise<ReasonOutcome> {
    const act = decisionFor(action)
    const target = extra.target
    const item = card.item
    const itemId = target?.itemId ?? item?.itemId
    const revision = target?.itemRevision ?? card.itemRevision
    if (!itemId) return { ok: false, error: REVIEW_COPY.pickerChoose }
    const payload: DecisionPayload = {
      action: act,
      assetId: card.asset.assetId,
      itemId,
      variantId: target ? target.variantId : (item?.variantId ?? null),
      expectedRevision: revision,
      ...(card.photoId && (act === "set_preferred" || act === "withdraw")
        ? { photoId: card.photoId }
        : {}),
      ...(extra.reason ? { reason: extra.reason } : {}),
    }
    if (act === "reaccept") {
      payload.basis = card.basis
      if (card.basis === "reviewer" && card.correctsItemId) {
        payload.correctsItemId = card.correctsItemId
        payload.correctsVariantId = card.correctsVariantId
      }
    } else if (act === "relink" && item) {
      payload.correctsItemId = item.itemId
      payload.correctsVariantId = item.variantId
    } else if (act === "assign_stale") {
      const stale = staleLabelOf(card)
      if (stale) {
        payload.correctsItemId = stale.itemId
        payload.correctsVariantId = stale.variantId
      }
    }
    const targetName = target?.name ?? item?.name ?? ""

    setPending({ key: card.key, action })
    setCardError(card.key, null)
    try {
      const result = await decide(payload)
      if (!result.ok) {
        if (result.code === "network") {
          setCardError(card.key, { text: REVIEW_COPY.network })
          return { ok: false, error: REVIEW_COPY.network }
        }
        if (result.code === "revision_conflict") {
          setCards((list) =>
            applyCurrent(
              list,
              itemId,
              result.current ?? [],
              keep,
              result.currentComplete === true
            )
          )
          focusTargetRef.current = "notice"
          setNotice({
            tone: "warning",
            text: REVIEW_COPY.conflict(targetName),
          })
          return REPORTED
        }
        if (
          scope.kind === "manager" &&
          result.code === "not_permitted" &&
          result.message === REVIEW_COPY.ownPhoto
        ) {
          setCards((list) =>
            list.map((c) => (c.key === card.key ? { ...c, isSelf: true } : c))
          )
          return REPORTED
        }
        const text = failureText(result)
        if (result.fieldErrors?.reason)
          return {
            ok: false,
            error: text,
            fieldError: result.fieldErrors.reason,
          }
        if (result.code === "state_conflict" || result.needsRefresh) {
          setCardError(card.key, { text, refresh: true })
          return REPORTED
        }
        setCardError(card.key, { text })
        return { ok: false, error: text }
      }
      const outcome = result.outcome
      // One decision runs at a time (every button waits), so the latest
      // rendered list is the one to merge into.
      const next = mergeOutcome(
        cardsRef.current,
        card,
        act,
        outcome,
        keep,
        targetName
      )
      cardsRef.current = next
      setCards(next)
      focusTargetRef.current = nextActionable(next, card.key) ?? "notice"
      reviewCount.settle(pendingDelta(card, act))
      setNotice({
        tone: "success",
        text: announcement(act, card, targetName, outcome),
      })
      onDecided?.(outcome)
      return { ok: true }
    } finally {
      setPending(null)
    }
  }

  function onAction(card: ListCard, action: CardAction) {
    setPreview(null)
    if (action === "ask_another") setDialog({ kind: "ask", card })
    else if (action === "withdraw") setDialog({ kind: "withdraw", card })
    else if (PICKER_ACTIONS.includes(action))
      setDialog({ kind: "picker", card, action })
    else {
      focusPendingRef.current = true
      void run(card, action).then((outcome) => {
        // Nothing moved (an error on the card): keep focus where it was.
        if (!outcome.ok && !("reported" in outcome))
          focusPendingRef.current = false
      })
    }
  }

  async function loadMore() {
    if (!cursor) return
    setLoading(true)
    setLoadError(null)
    try {
      const result = await loadReviewPageAction({
        status: view.status,
        sectionId: view.sectionId ?? undefined,
        contributorId: view.contributorId ?? undefined,
        itemId: view.itemId ?? undefined,
        cursor,
        ...(venueId ? { venueId } : {}),
      })
      if (!result.ok) {
        setLoadError(failureText(result))
        return
      }
      setCards((current) => {
        const seen = new Set(current.map((c) => c.key))
        return [...current, ...result.items.filter((c) => !seen.has(c.key))]
      })
      setCursor(result.nextCursor)
      setNotice({
        tone: "success",
        text: REVIEW_COPY.moreLoaded(result.items.length),
      })
    } catch {
      setLoadError(REVIEW_COPY.loadMoreFailed)
    } finally {
      setLoading(false)
    }
  }

  const busy = pending !== null
  const actionsFor = (card: ListCard) => (
    <ReviewActions
      card={card}
      busy={busy}
      pending={pending?.key === card.key ? pending.action : null}
      onAction={(action) => onAction(card, action)}
      scopeKind={scope.kind}
    />
  )

  const subject = dialog?.card ?? null
  const askDialog = dialog?.kind === "ask"
  const followUp =
    askDialog && subject && subject.contributor.status !== "here"
      ? REVIEW_COPY.followUp[subject.contributor.status](
          subject.contributor.name
        )
      : null
  const pickerAction = dialog?.kind === "picker" ? dialog.action : null

  return (
    <div className="grid gap-4">
      <Announcer
        ref={noticeRef}
        announcement={notice}
        onDismiss={() => setNotice(null)}
      />
      {cards.length === 0 ? (
        <EmptyFor view={view} venueName={venueName} scope={scope} />
      ) : (
        <div
          ref={listRef}
          tabIndex={-1}
          className="@container grid gap-4 outline-none"
        >
          <ul aria-label={REVIEW_COPY.listLabel} className="grid gap-6">
            {groupCards(cards).map((group, index) => {
              const first = group.cards[0]
              if (!group.itemId) {
                return (
                  <li key={first.key}>
                    <ReviewCard
                      card={first}
                      scope={scope}
                      now={now}
                      error={errors[first.key]}
                      actions={actionsFor(first)}
                      onOpenPreview={(trigger) => {
                        previewTriggerRef.current = trigger
                        setPreview(cards.indexOf(first))
                      }}
                      onRefresh={() => router.refresh()}
                      showItemLink={showItemLinks}
                    />
                  </li>
                )
              }
              const total = first.groupCount + 1
              const shown = group.cards.length
              const headingId = `review-group-${index}-${group.itemId}`
              return (
                <li key={`${group.itemId}-${first.key}`}>
                  <section aria-labelledby={headingId} className="grid gap-3">
                    <h2
                      id={headingId}
                      className="text-section-title-touch break-words text-ink md:text-section-title"
                    >
                      {REVIEW_COPY.groupHeading(group.name ?? "", total)}
                    </h2>
                    <ul
                      aria-label={`Photos of ${group.name ?? ""}`}
                      className="grid gap-4"
                    >
                      {group.cards.map((card) => (
                        <li key={card.key}>
                          <ReviewCard
                            card={card}
                            scope={scope}
                            now={now}
                            error={errors[card.key]}
                            actions={actionsFor(card)}
                            onOpenPreview={(trigger) => {
                              previewTriggerRef.current = trigger
                              setPreview(cards.indexOf(card))
                            }}
                            onRefresh={() => router.refresh()}
                            showItemLink={showItemLinks}
                          />
                        </li>
                      ))}
                    </ul>
                    {!view.itemId && total > shown ? (
                      <Link
                        href={reviewHref(scope, {
                          ...view,
                          itemId: group.itemId,
                        })}
                        scroll={false}
                        className={buttonVariants({
                          variant: "link",
                          className: "justify-self-start",
                        })}
                      >
                        {REVIEW_COPY.moreOfItem(
                          total - shown,
                          group.name ?? ""
                        )}
                      </Link>
                    ) : null}
                  </section>
                </li>
              )
            })}
          </ul>
          <LoadMoreButton
            hasMore={!!cursor}
            loading={loading}
            error={loadError}
            onLoadMore={() => void loadMore()}
          />
        </div>
      )}

      <PreviewDialog
        cards={cards}
        index={preview}
        onIndexChange={setPreview}
        onClose={() => setPreview(null)}
        returnFocus={() => previewTriggerRef.current}
        renderActions={(card) =>
          ownPhotoBlocked(card, scope.kind) ? (
            <Notice tone="plain">{REVIEW_COPY.ownPhoto}</Notice>
          ) : (
            actionsFor(card)
          )
        }
      />

      <ReasonDialog
        open={dialog?.kind === "ask" || dialog?.kind === "withdraw"}
        onOpenChange={(open) => {
          if (!open) setDialog(null)
        }}
        title={
          subject?.item
            ? askDialog
              ? REVIEW_COPY.askTitle(subject.item.name)
              : REVIEW_COPY.withdrawTitle(subject.item.name)
            : ""
        }
        label={askDialog ? REVIEW_COPY.askLabel : REVIEW_COPY.withdrawLabel}
        emptyError={
          askDialog ? REVIEW_COPY.askEmpty : REVIEW_COPY.withdrawEmpty
        }
        help={
          askDialog && subject && !followUp
            ? REVIEW_COPY.askNote(subject.contributor.name)
            : undefined
        }
        note={
          askDialog
            ? (followUp ?? undefined)
            : subject?.isEffectivePrimary && subject.item
              ? REVIEW_COPY.withdrawPrimary(subject.item.name)
              : REVIEW_COPY.withdrawNote
        }
        confirmLabel={askDialog ? REVIEW_COPY.askAnother : REVIEW_COPY.withdraw}
        confirmIcon={
          askDialog ? (
            <CameraRotateIcon data-icon="inline-start" aria-hidden />
          ) : (
            <ArrowCounterClockwiseIcon data-icon="inline-start" aria-hidden />
          )
        }
        destructive={!askDialog}
        pendingLabel={REVIEW_COPY.saving}
        onConfirm={async (reason) => {
          if (!dialog) return { ok: false, error: REVIEW_COPY.pickerChoose }
          return run(
            dialog.card,
            dialog.kind === "ask" ? "ask_another" : "withdraw",
            { reason }
          )
        }}
        reportFocus={focusTarget}
        reportFocusOnSuccess
      >
        {subject ? (
          <div className="flex items-center gap-3">
            <EvidenceThumb
              src={subject.asset.thumbnailUrl}
              className="aspect-square w-16 shrink-0"
            />
            <p className="min-w-0 text-body-touch break-words md:text-body-sm">
              {REVIEW_COPY.photoBy(subject.contributor.name)}
            </p>
          </div>
        ) : null}
      </ReasonDialog>

      <ItemPickerDialog
        open={dialog?.kind === "picker"}
        onOpenChange={(open) => {
          if (!open) setDialog(null)
        }}
        card={subject}
        title={
          pickerAction === "relink"
            ? REVIEW_COPY.relink
            : REVIEW_COPY.pickerTitle
        }
        reasonLabel={
          pickerAction === "relink"
            ? REVIEW_COPY.relinkLabel
            : REVIEW_COPY.noteLabel
        }
        reasonRequired={pickerAction === "relink"}
        emptyReason={REVIEW_COPY.relinkEmpty}
        excluded={
          pickerAction === "relink" && subject?.item
            ? {
                itemId: subject.item.itemId,
                variantId: subject.item.variantId,
              }
            : null
        }
        venueId={venueId}
        onConfirm={async (target, reason) => {
          if (dialog?.kind !== "picker")
            return { ok: false, error: REVIEW_COPY.pickerChoose }
          return run(dialog.card, dialog.action, {
            target,
            reason: reason || undefined,
          })
        }}
        reportFocus={focusTarget}
      />
    </div>
  )
}
