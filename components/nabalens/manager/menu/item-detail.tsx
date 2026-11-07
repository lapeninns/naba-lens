"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { ArrowLeftIcon } from "@phosphor-icons/react"

import { EvidencePreviewButton } from "@/components/nabalens/coverage/evidence-image"
import {
  CoverageNotice,
  type Notice,
} from "@/components/nabalens/coverage/coverage-notice"
import { failureText, needsRefresh } from "@/components/nabalens/coverage/copy"
import {
  ReasonDialog,
  type ReasonOutcome,
} from "@/components/nabalens/coverage/reason-dialog"
import { REPORTED } from "@/components/nabalens/coverage/use-coverage-action"
import { useRequestIds } from "@/components/nabalens/coverage/use-request-id"
import { formatDate } from "@/components/nabalens/format"
import { PageHeader } from "@/components/nabalens/page-header"
import { StatusChip } from "@/components/nabalens/status-chip"
import { Button, buttonVariants } from "@/components/ui/button"

import type {
  DecisionAction,
  DecisionOutcome,
  ItemEvent,
  ItemPhoto,
  ManagerItemDetail,
  MenuPhotoResult,
  Page,
} from "@/lib/server/menu-photos/types"

import { MANAGER_COPY } from "../copy"
import { ItemHistory, type LoadItemEvents } from "./item-history"
import { MenuItemChips, MenuStatusChip } from "./menu-item-row"

/** `decideMenuPhotoAction`. */
export type DecideMenuPhoto = (
  input: unknown,
  view: unknown
) => Promise<MenuPhotoResult<{ outcome: DecisionOutcome }>>

type Decide = (
  action: Extract<DecisionAction, "set_preferred" | "withdraw" | "reaccept">,
  photo: ItemPhoto,
  reason?: string
) => Promise<ReasonOutcome>

/** A section heading on the grey canvas (Common Room SectionHeader). */
const SECTION_TITLE = "px-1 font-display text-section-title text-ink"

/**
 * One active-menu item for a manager: its menu photo (or the fallback),
 * accepted alternatives, open requests for another photo, rechecks after a
 * menu or label change, the photos waiting for review and the history.
 * Decisions re-read the page; a stale revision shows the latest state.
 */
export function ItemDetail({
  detail,
  backHref,
  decide,
  history,
  loadEvents,
  waiting,
}: {
  detail: ManagerItemDetail
  backHref: string
  decide: DecideMenuPhoto
  /** The first page of history; null when it could not be read. */
  history: Page<ItemEvent> | null
  loadEvents: LoadItemEvents
  /** The "Waiting for review" body (the item's queue). */
  waiting: React.ReactNode
}) {
  const copy = MANAGER_COPY.item
  const router = useRouter()
  const { item } = detail
  const { requestIdFor, settle } = useRequestIds()
  const [notice, setNotice] = React.useState<Notice | null>(null)
  const [busy, setBusy] = React.useState<string | null>(null)
  const noticeRef = React.useRef<HTMLDivElement>(null)

  const run: Decide = async (action, photo, reason) => {
    const payload = {
      action,
      assetId: photo.asset.assetId,
      itemId: item.itemId,
      photoId: photo.photoId,
      variantId: photo.variantId,
      expectedRevision: item.itemRevision,
      ...(reason ? { reason } : {}),
      ...(action === "reaccept"
        ? {
            basis: photo.basis,
            ...(photo.correctsItemId
              ? {
                  correctsItemId: photo.correctsItemId,
                  correctsVariantId: photo.correctsVariantId,
                }
              : {}),
          }
        : {}),
    }
    const scope = `manager-photo:${action}:${photo.photoId}:${item.itemId}`
    const requestId = requestIdFor(scope, payload)
    setBusy(scope)
    setNotice(null)
    try {
      const result = await decide({ requestId, ...payload }, { status: "all" })
      settle(scope)
      if (result.ok) {
        setNotice({ tone: "success", text: successText(action, item.name) })
        router.refresh()
        return { ok: true }
      }
      if (result.code === "invalid_input" && result.fieldErrors?.reason) {
        return {
          ok: false,
          error: failureText(result),
          fieldError: result.fieldErrors.reason,
        }
      }
      const conflict = result.code === "revision_conflict"
      setNotice({
        tone: conflict || needsRefresh(result) ? "warning" : "error",
        text: conflict ? copy.conflict(item.name) : failureText(result),
      })
      if (conflict || needsRefresh(result) || result.needsRefresh)
        router.refresh()
      return REPORTED
    } catch {
      // The request id is kept: a retry replays rather than deciding twice.
      setNotice({ tone: "error", text: copy.network })
      return { ok: false, error: copy.network }
    } finally {
      setBusy(null)
    }
  }

  const photoCard = (
    photo: ItemPhoto,
    actions: React.ReactNode,
    extra?: React.ReactNode
  ) => (
    <PhotoCard
      photo={photo}
      actions={
        photo.isSelf ? (
          <OwnPhotoNote />
        ) : contributorLeft(photo) ? (
          <LeaverNote />
        ) : (
          actions
        )
      }
      extra={extra}
    />
  )

  const preferred = detail.preferred
  const variants = item.variants.map((v) => v.name).join(", ")

  return (
    <div className="grid gap-6">
      <Link
        href={backHref}
        className={buttonVariants({
          variant: "link",
          className: "justify-self-start",
        })}
      >
        <ArrowLeftIcon data-icon="inline-start" aria-hidden />
        {copy.back}
      </Link>
      <PageHeader
        scope={item.section.name}
        title={item.name}
        summary={
          <div className="grid gap-2">
            {variants ? <p>{variants}</p> : null}
            <p className="flex flex-wrap items-center gap-1.5">
              <MenuStatusChip status={item.status} />
              <MenuItemChips item={item} />
            </p>
          </div>
        }
        className="pb-0 md:pb-0"
      />
      <CoverageNotice
        ref={noticeRef}
        notice={notice}
        onDismiss={() => setNotice(null)}
      />

      <section aria-labelledby="item-menu-photo" className="grid gap-3">
        <h2 id="item-menu-photo" className={SECTION_TITLE}>
          {copy.menuPhoto}
        </h2>
        {preferred ? (
          <>
            {preferred.fallback ? (
              <p className="text-body text-ink-muted">{copy.fallback}</p>
            ) : null}
            {photoCard(
              preferred,
              <>
                {preferred.fallback ? (
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={busy !== null}
                    onClick={() => void run("set_preferred", preferred)}
                  >
                    {copy.setPreferred}
                  </Button>
                ) : null}
                <WithdrawButton
                  photo={preferred}
                  disabled={busy !== null}
                  note={
                    detail.alternatives.length > 0
                      ? copy.withdrawPromote
                      : copy.withdrawReopen(item.name)
                  }
                  onConfirm={(reason) => run("withdraw", preferred, reason)}
                  reportFocus={() => noticeRef.current}
                />
              </>,
              undefined
            )}
          </>
        ) : (
          <p className="text-body text-ink-muted">{copy.noMenuPhoto}</p>
        )}
      </section>

      {detail.alternatives.length > 0 ? (
        <PhotoSection id="item-alternatives" title={copy.alternatives}>
          {detail.alternatives.map((photo) => (
            <li key={photo.photoId}>
              {photoCard(
                photo,
                <>
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={busy !== null}
                    onClick={() => void run("set_preferred", photo)}
                  >
                    {copy.setPreferred}
                  </Button>
                  <WithdrawButton
                    photo={photo}
                    disabled={busy !== null}
                    onConfirm={(reason) => run("withdraw", photo, reason)}
                    reportFocus={() => noticeRef.current}
                  />
                </>
              )}
            </li>
          ))}
        </PhotoSection>
      ) : null}

      {detail.askedForAnother.length > 0 ? (
        <PhotoSection id="item-asked" title={copy.askedForAnother}>
          {detail.askedForAnother.map((photo) => (
            <li key={photo.photoId}>
              {photoCard(
                photo,
                <WithdrawButton
                  photo={photo}
                  label={copy.withdraw}
                  title={copy.withdrawRequestTitle}
                  reasonLabel={copy.withdrawRequestLabel}
                  disabled={busy !== null}
                  onConfirm={(reason) => run("withdraw", photo, reason)}
                  reportFocus={() => noticeRef.current}
                />
              )}
            </li>
          ))}
        </PhotoSection>
      ) : null}

      {detail.recheck.length > 0 ? (
        <PhotoSection id="item-recheck" title={copy.recheck}>
          {detail.recheck.map((photo) => {
            const removed = photo.recheckKind === "variant_removed"
            return (
              <li key={photo.photoId}>
                {photoCard(
                  photo,
                  <>
                    {removed ? null : (
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={busy !== null}
                        onClick={() => void run("reaccept", photo)}
                      >
                        {copy.acceptAgain}
                      </Button>
                    )}
                    <WithdrawButton
                      photo={photo}
                      label={removed ? copy.withdraw : undefined}
                      disabled={busy !== null}
                      onConfirm={(reason) => run("withdraw", photo, reason)}
                      reportFocus={() => noticeRef.current}
                    />
                  </>,
                  <>
                    {photo.recheckKind ? (
                      <StatusChip tone="attention">
                        {copy.recheckKind[photo.recheckKind]}
                      </StatusChip>
                    ) : null}
                    {removed ? (
                      <p className="text-meta text-ink-muted">
                        {copy.variantRemoved}
                      </p>
                    ) : null}
                  </>
                )}
              </li>
            )
          })}
        </PhotoSection>
      ) : null}

      <section aria-labelledby="item-waiting" className="grid gap-3">
        <h2 id="item-waiting" className={SECTION_TITLE}>
          {copy.waiting}
        </h2>
        {waiting}
      </section>

      <ItemHistory
        // A refresh brings a new first page: start again from it.
        key={historyKey(history, item.itemRevision)}
        itemId={item.itemId}
        initial={history}
        loadEvents={loadEvents}
      />
    </div>
  )
}

function successText(action: Parameters<Decide>[0], item: string): string {
  const done = MANAGER_COPY.item.done
  if (action === "set_preferred") return done.set_preferred(item)
  if (action === "reaccept") return done.reaccept(item)
  return done.withdraw
}

function PhotoSection({
  id,
  title,
  children,
}: {
  id: string
  title: string
  children: React.ReactNode
}) {
  return (
    <section aria-labelledby={id} className="grid gap-3">
      <h2 id={id} className={SECTION_TITLE}>
        {title}
      </h2>
      <ul className="grid gap-(--gutter)">{children}</ul>
    </section>
  )
}

/**
 * The history seed: changes when a refresh brings new events (or the read
 * recovers), so the list restarts from the newest page.
 */
function historyKey(history: Page<ItemEvent> | null, revision: number) {
  if (!history) return `failed:${revision}`
  return `${history.items[0]?.id ?? "none"}:${revision}`
}

/**
 * A leaver's photo: managers' decisions on it are refused (only an admin may
 * act), so none is offered. The photo itself still shows.
 */
const contributorLeft = (photo: ItemPhoto) => photo.author.status === "left"

function LeaverNote() {
  return (
    <p className="text-body text-ink-muted">
      {MANAGER_COPY.item.contributorLeft}
    </p>
  )
}

function OwnPhotoNote() {
  return (
    <p className="text-body text-ink-muted">{MANAGER_COPY.item.ownPhoto}</p>
  )
}

/** A decided photo: the preview, who took it, the decision and its actions. */
function PhotoCard({
  photo,
  actions,
  extra,
}: {
  photo: ItemPhoto
  actions: React.ReactNode
  extra?: React.ReactNode
}) {
  const copy = MANAGER_COPY.item
  const label = copy.photoBy(photo.author.name)
  return (
    <article
      aria-label={label}
      className="grid min-w-0 gap-3 rounded-card bg-surface p-3 shadow-card sm:grid-cols-[minmax(0,16rem)_minmax(0,1fr)] sm:p-4"
    >
      <EvidencePreviewButton
        thumbnailUrl={photo.asset.thumbnailUrl}
        previewUrl={photo.asset.previewUrl}
        label={label}
      />
      <div className="grid min-w-0 content-start gap-2">
        <p className="text-item-title break-words text-ink">{label}</p>
        <p className="text-meta text-ink-muted">
          {photo.state === "accepted"
            ? copy.acceptedBy(photo.decidedByName, formatDate(photo.decidedAt))
            : formatDate(photo.decidedAt)}
        </p>
        {photo.variantName ? (
          <p className="text-meta break-words text-ink-muted">
            {photo.variantName}
          </p>
        ) : null}
        {photo.basis === "reviewer" && photo.correctsItemName ? (
          <p className="text-meta break-words text-ink-muted">
            {copy.movedFrom(photo.correctsItemName)}
          </p>
        ) : null}
        {photo.reason ? (
          <p className="text-body break-words text-ink">{photo.reason}</p>
        ) : null}
        {extra ? (
          <div className="flex flex-wrap items-center gap-1.5">{extra}</div>
        ) : null}
        <div className="flex flex-wrap gap-2">{actions}</div>
      </div>
    </article>
  )
}

/** Withdraw with a required reason; the note says what happens to the menu photo. */
function WithdrawButton({
  photo,
  label = MANAGER_COPY.item.withdrawAcceptance,
  title = MANAGER_COPY.item.withdrawTitle,
  reasonLabel = MANAGER_COPY.item.withdrawLabel,
  note,
  disabled,
  onConfirm,
  reportFocus,
}: {
  photo: ItemPhoto
  label?: string
  title?: string
  reasonLabel?: string
  note?: string
  disabled?: boolean
  onConfirm: (reason: string) => Promise<ReasonOutcome>
  reportFocus: () => HTMLElement | null
}) {
  const copy = MANAGER_COPY.item
  const [open, setOpen] = React.useState(false)
  return (
    <>
      <Button
        variant="destructive"
        size="sm"
        disabled={disabled}
        onClick={() => setOpen(true)}
      >
        {label}
      </Button>
      <ReasonDialog
        open={open}
        onOpenChange={setOpen}
        title={title}
        description={copy.photoBy(photo.author.name)}
        label={reasonLabel}
        note={note}
        confirmLabel={label}
        pendingLabel={copy.withdrawPending}
        destructive
        onConfirm={onConfirm}
        reportFocus={reportFocus}
        reportFocusOnSuccess
      />
    </>
  )
}
