"use client"

import * as React from "react"
import { ImageIcon, VideoCameraIcon } from "@phosphor-icons/react"

import { useSessionEndedCatch } from "@/components/nabalens/session-guard-host"
import {
  loadLabelCatalogue,
  loadLabelEditorContext,
} from "@/app/_labels/actions"
import type { CatalogueProp } from "@/components/nabalens"
import { FixLabelsDialog, LabelSummary } from "@/components/nabalens/labels"
import { Notice } from "@/components/nabalens/notice"
import { useAdd } from "@/components/nabalens/shell/add-context"
import { CountBadge, StatusChip } from "@/components/nabalens/status-chip"
import { LABELS_LOST } from "@/components/nabalens/upload-label-drafts"
import {
  OPEN_ADD,
  stoppedText,
  useUploadStopped,
} from "@/components/nabalens/upload-stopped"
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import type { WorkFocus } from "@/lib/config/work-roles"
import {
  EMPTY_LABEL_SUMMARY,
  type LabelEditorAsset,
  type MediaLabelSummary,
  type PendingLabelItem,
  type SaveLabelsInput,
} from "@/lib/menus/types"

import {
  discardPendingLabels,
  loadNeedsAttention,
  saveFixedLabels,
} from "./needs-attention-api"

/** The exact words of Me's "Needs attention" list. */
export const ATTENTION_COPY = {
  heading: "Needs attention",
  intro: "Labels we couldn't add to these photos. Fix them, or discard them.",
  list: "Photos that need attention",
  menuChanged: "The menu changed. Check the dish.",
  notSaved: "Labels not saved yet.",
  photoNotFinished:
    "The photo didn't finish saving. These labels are kept and go on it if you choose the same photo again from Add.",
  openAdd: OPEN_ADD,
  working: "Working…",
  discarded: "Labels discarded.",
  fixed: "Labels saved.",
  kept: "Labels kept.",
  conflict: "These labels were changed somewhere else. Check the dish.",
  otherFailure: "Labels couldn't be added.",
  unusableLabels: LABELS_LOST,
  /** The list doesn't say why an upload failed. */
  noReason: "no reason was given",
  alreadySaved: "These labels were already saved on the photo.",
  savedSince:
    "Labels were saved on this photo since. Yours are added to them; nothing is removed.",
  saved: "Saved",
  keep: "Keep labels",
  fix: "Fix labels",
  discard: "Discard labels",
  discardTitle: "Discard these labels?",
  discardMeaning: "The photo isn't changed; only these labels are discarded.",
  discardFailed: "Couldn't discard the labels. Try again.",
  openFailed: "Couldn't open the labels. Check your connection and try again.",
  loadFailed: "We couldn't check for photos that need attention.",
  tryAgain: "Try again",
} as const

/** "This file can't be used: {reason}." */
export function cannotUse(reason: string | null) {
  const why = (reason?.trim() || ATTENTION_COPY.noReason).replace(/[.\s]+$/, "")
  return `This file can't be used: ${why}.`
}

/**
 * A failed upload whose labels the server still keeps: the failure was
 * temporary, and a successful Retry of the photo applies them (a permanent
 * failure deletes them).
 */
export function isRetryable(item: PendingLabelItem): boolean {
  return item.uploadState === "failed" && item.retryable
}

/** An upload that will never give the stored labels a photo to go on. */
export function isUnusable(item: PendingLabelItem): boolean {
  return item.uploadState === "failed" && !isRetryable(item)
}

/**
 * Rows Me lists: labels the server could not apply, and labels whose upload
 * failed (for now or for good). Labels still waiting for their photo to
 * finish uploading are listed only once that upload has `stopped` (nothing
 * on this device is sending it); otherwise they are saving, and Add shows
 * them. Only `failed` is an upload end state, and a removed photo takes its
 * stored labels with it.
 */
export function attentionItems<T extends PendingLabelItem>(
  items: readonly T[],
  stopped?: (item: PendingLabelItem) => boolean
): T[] {
  return items.filter(
    (item) =>
      item.status === "needs_attention" ||
      item.uploadState === "failed" ||
      (item.uploadState === "uploading" && !!stopped?.(item))
  )
}

/** Why one row needs attention, in the flow's own words. */
export function attentionReason(item: PendingLabelItem): string {
  // The list carries no reason for the upload's failure.
  if (isUnusable(item)) return cannotUse(null)
  if (isRetryable(item)) return ATTENTION_COPY.notSaved
  // A stopped upload (only listed then). The list has no upload time, so it
  // can't say whether choosing the photo again continues where it stopped.
  if (item.status === "pending" && item.uploadState === "uploading")
    return stoppedText(item.mediaType, null)
  switch (item.code) {
    case "catalogue_changed":
    case "unavailable_items":
      return ATTENTION_COPY.menuChanged
    case "unavailable":
      return ATTENTION_COPY.notSaved
    case "conflict":
      return ATTENTION_COPY.conflict
    default:
      return item.message ?? ATTENTION_COPY.otherFailure
  }
}

/** The labels now on a photo, as the input that would save them unchanged. */
function inputFromLabels(
  assetId: string,
  labels: MediaLabelSummary
): SaveLabelsInput {
  return {
    assetId,
    expectedRevision: labels.revision,
    catalogueVersionId: null,
    contentTypes: labels.contentTypes,
    note: labels.note,
    items: labels.items.map((i) => ({
      itemId: i.itemId,
      variantId: i.variantId,
    })),
    missingItem: null,
  }
}

/**
 * A stored draft on top of labels saved on the photo since it was stored
 * (an admin, or another save): the photo's dishes, content types and note
 * stay, and the draft's are added. Opening the draft as it is would remove
 * whatever the photo gained, at the photo's current revision, so the save
 * would never conflict.
 */
export function draftOnCurrentLabels(
  labels: MediaLabelSummary,
  draft: SaveLabelsInput
): SaveLabelsInput {
  const current = inputFromLabels(draft.assetId, labels)
  const items = [...current.items]
  for (const ref of draft.items)
    if (
      !items.some(
        (i) => i.itemId === ref.itemId && i.variantId === ref.variantId
      )
    )
      items.push(ref)
  return {
    ...current,
    catalogueVersionId: draft.catalogueVersionId,
    contentTypes: [
      ...current.contentTypes,
      ...draft.contentTypes.filter((t) => !current.contentTypes.includes(t)),
    ],
    note: current.note?.trim() ? current.note : draft.note,
    items,
    missingItem: draft.missingItem,
  }
}

/**
 * Labels were saved on the photo after the draft was stored. Only the
 * revision says so: labels the photo already had when the draft was made are
 * the draft's base, and the draft may remove some of them on purpose.
 */
export function savedSince(labels: MediaLabelSummary, draft: SaveLabelsInput) {
  return labels.revision !== draft.expectedRevision
}

/**
 * One listed row. `applied`: a discard found the labels already on the
 * photo (its upload applied them first), so the row stays to say so.
 */
type Row = PendingLabelItem & {
  applied?: { labels: MediaLabelSummary | null }
}

type Fixing = {
  item: Row
  asset: LabelEditorAsset
  /** What the dialog opens with: the stored labels, or those on the photo. */
  draft: SaveLabelsInput
  /** Labels were saved on the photo after the draft was stored. */
  since: boolean
  catalogue: CatalogueProp
  focus: WorkFocus | null
}

export type NeedsAttentionApi = {
  load: typeof loadNeedsAttention
  discard: typeof discardPendingLabels
  save: typeof saveFixedLabels
  loadContext: typeof loadLabelEditorContext
  loadCatalogue: typeof loadLabelCatalogue
}

const API: NeedsAttentionApi = {
  load: loadNeedsAttention,
  discard: discardPendingLabels,
  save: saveFixedLabels,
  loadContext: loadLabelEditorContext,
  loadCatalogue: loadLabelCatalogue,
}

/**
 * Me's "Needs attention": the caller's own photos whose labels the server
 * kept but could not add (the menu changed, a save failed, the photo didn't
 * finish saving), each with its reason, "Fix labels" (the stored labels
 * against the current menu) and "Discard labels" (after a confirmation).
 * Reloads whenever `refreshSignal` changes (an upload finished). Renders
 * nothing while there is nothing to fix.
 */
export function NeedsAttention({
  refreshSignal = 0,
  onFixed,
  onDiscarded,
  api = API,
}: {
  refreshSignal?: number
  /** Labels are on these photos now: refresh the gallery. */
  onFixed?: (assetIds: string[]) => void
  /** These photos' stored labels were discarded: they have none from Add. */
  onDiscarded?: (assetIds: string[]) => void
  api?: NeedsAttentionApi
}) {
  const [items, setItems] = React.useState<Row[]>([])
  const [loadError, setLoadError] = React.useState<string | null>(null)
  const [reloads, setReloads] = React.useState(0)
  // Each row's own action in flight: one finishing never frees another.
  const [busy, setBusy] = React.useState<ReadonlySet<string>>(() => new Set())
  const [rowErrors, setRowErrors] = React.useState<ReadonlyMap<string, string>>(
    new Map()
  )
  const [fixing, setFixing] = React.useState<Fixing | null>(null)
  const [confirming, setConfirming] = React.useState<Row | null>(null)
  // What the last action did, said once in the section's one live region.
  const [outcome, setOutcome] = React.useState("")
  const sessionEnded = useSessionEndedCatch()
  const isStopped = useUploadStopped()
  const openAdd = useAdd()
  const headingRef = React.useRef<HTMLHeadingElement>(null)
  const listRef = React.useRef<HTMLUListElement>(null)
  // A row that left takes its focused button with it: focus goes to the next
  // row's first action, else the heading, once it has gone.
  const focusAfter = React.useRef<string | null>(null)
  const stopped = (item: PendingLabelItem) =>
    isStopped?.({ id: item.assetId, uploadState: item.uploadState }) ?? false
  // Rows kept from the server: stopped uploads are told apart as they render,
  // since this device's Add queue changes between reads.
  const shown = attentionItems(items, stopped)
  // Rows discarded or fixed here: a read that started before the server
  // changed must not bring them back.
  const handled = React.useRef(new Set<string>())
  // The rows the server listed last: an open that ends after its row left
  // the list (its photo's Retry applied the labels) opens nothing.
  const listed = React.useRef(new Set<string>())

  React.useEffect(() => {
    const controller = new AbortController()
    api.load(controller.signal).then(
      (result) => {
        if (controller.signal.aborted) return
        if (result.ok) {
          const next = attentionItems(result.items, () => true).filter(
            (i) => !handled.current.has(i.assetId)
          )
          listed.current = new Set(next.map((i) => i.assetId))
          // A row whose labels turned out to be on the photo stays until the
          // person is done with it; the server no longer lists it.
          setItems((current) => [...next, ...current.filter((i) => i.applied)])
          // A row that left the list takes its open Fix labels with it.
          setFixing((f) =>
            f &&
            (f.item.applied || next.some((i) => i.assetId === f.item.assetId))
              ? f
              : null
          )
          setLoadError(null)
        } else setLoadError(ATTENTION_COPY.loadFailed)
      },
      () => {
        if (!controller.signal.aborted) setLoadError(ATTENTION_COPY.loadFailed)
      }
    )
    return () => controller.abort()
  }, [api, refreshSignal, reloads])

  const setRowError = (assetId: string, message: string | null) =>
    setRowErrors((current) => {
      const next = new Map(current)
      if (message) next.set(assetId, message)
      else next.delete(assetId)
      return next
    })

  const drop = (assetId: string, said: string) => {
    const order = shown.map((i) => i.assetId)
    const at = order.indexOf(assetId)
    focusAfter.current = order[at + 1] ?? order[at - 1] ?? HEADING
    handled.current.add(assetId)
    setItems((current) => current.filter((i) => i.assetId !== assetId))
    setOutcome(said)
  }

  React.useEffect(() => {
    const target = focusAfter.current
    if (!target) return
    focusAfter.current = null
    const row = Array.from(
      listRef.current?.querySelectorAll<HTMLElement>("[data-asset-id]") ?? []
    ).find((el) => el.dataset.assetId === target)
    ;(row?.querySelector("button") ?? headingRef.current)?.focus()
  })

  const markBusy = (assetId: string, on: boolean) =>
    setBusy((current) => {
      const next = new Set(current)
      if (on) next.add(assetId)
      else next.delete(assetId)
      return next
    })

  async function discard(item: Row) {
    markBusy(item.assetId, true)
    setRowError(item.assetId, null)
    const result = await api.discard(item.assetId)
    markBusy(item.assetId, false)
    if (!result.ok) {
      setRowError(item.assetId, result.message ?? ATTENTION_COPY.discardFailed)
      return
    }
    if (result.state === "already_applied") {
      // Nothing was discarded: the photo's upload added these labels first.
      // Say so and show them, with Fix labels to change them.
      handled.current.add(item.assetId)
      setItems((current) =>
        current.map((i) =>
          i.assetId === item.assetId
            ? { ...i, applied: { labels: result.labels } }
            : i
        )
      )
      onFixed?.([item.assetId])
      return
    }
    drop(item.assetId, ATTENTION_COPY.discarded)
    onDiscarded?.([item.assetId])
  }

  async function openFix(item: Row) {
    if (busy.has(item.assetId)) return
    markBusy(item.assetId, true)
    setRowError(item.assetId, null)
    try {
      const context = await api.loadContext([item.assetId])
      if (!context.ok) {
        setRowError(item.assetId, context.message)
        return
      }
      let asset = context.assets[0]
      let catalogue: CatalogueProp = context.catalogue
        ? { state: "ready", catalogue: context.catalogue }
        : {
            state: "error",
            message: context.catalogueError ?? ATTENTION_COPY.openFailed,
          }
      if (
        !asset &&
        (isRetryable(item) || item.uploadState === "uploading") &&
        !item.applied
      ) {
        // The photo didn't finish saving, so it has no labels yet: fix the
        // kept labels against the venue's current menu.
        const menu = await api.loadCatalogue(item.venueId)
        if (!menu.ok) {
          setRowError(item.assetId, menu.message)
          return
        }
        asset = {
          id: item.assetId,
          venueId: item.venueId,
          venueName: menu.catalogue.venueName,
          originalFilename: "",
          mediaType: item.mediaType,
          thumbnailUrl: item.thumbnailUrl,
          labels: EMPTY_LABEL_SUMMARY,
        }
        catalogue = { state: "ready", catalogue: menu.catalogue }
      }
      if (!asset) {
        setRowError(item.assetId, ATTENTION_COPY.openFailed)
        return
      }
      // Discarded, fixed or gone from the list while its labels were
      // loading: nothing to fix.
      if (
        !item.applied &&
        (handled.current.has(item.assetId) || !listed.current.has(item.assetId))
      )
        return
      const since = !item.applied && savedSince(asset.labels, item.input)
      setFixing({
        item,
        asset,
        // Labels already on the photo open as they are now; labels saved
        // since the draft was stored are kept, with the draft added.
        draft: item.applied
          ? inputFromLabels(item.assetId, asset.labels)
          : since
            ? draftOnCurrentLabels(asset.labels, item.input)
            : item.input,
        since,
        catalogue,
        focus: context.focus ?? null,
      })
    } catch (cause) {
      sessionEnded(cause)
      setRowError(item.assetId, ATTENTION_COPY.openFailed)
    } finally {
      markBusy(item.assetId, false)
    }
  }

  async function retryCatalogue() {
    if (!fixing) return
    const assetId = fixing.item.assetId
    const set = (catalogue: CatalogueProp) =>
      setFixing((f) =>
        f && f.item.assetId === assetId ? { ...f, catalogue } : f
      )
    set({ state: "loading" })
    try {
      const result = await api.loadCatalogue(fixing.item.venueId)
      set(
        result.ok
          ? { state: "ready", catalogue: result.catalogue }
          : { state: "error", message: result.message }
      )
    } catch (cause) {
      sessionEnded(cause)
      set({ state: "error", message: ATTENTION_COPY.openFailed })
    }
  }

  async function saveFix(item: Row, input: SaveLabelsInput) {
    const result = await api.save(item.venueId, input)
    // The answer was lost, so the save may have happened: the dialog says it
    // couldn't confirm the save rather than that nothing was saved.
    if (!result.ok) return result.unconfirmed ? null : result
    if (result.pending) {
      // Kept on the server for a photo that hasn't finished saving: the row
      // stays (not on the photo yet) with the new labels, so re-read.
      setReloads((n) => n + 1)
    } else {
      drop(item.assetId, ATTENTION_COPY.fixed)
      onFixed?.([item.assetId])
    }
    return result
  }

  // An outcome keeps the heading (and focus on it) after the last row left.
  if (shown.length === 0 && !loadError && !outcome) return null

  return (
    <section
      aria-labelledby="needs-attention-heading"
      className="grid gap-3 pt-2"
    >
      <div className="grid gap-1 px-1">
        <h2
          ref={headingRef}
          id="needs-attention-heading"
          tabIndex={-1}
          className="flex items-center gap-2 font-display text-section-title text-ink outline-none"
        >
          {ATTENTION_COPY.heading}
          {shown.length > 0 ? (
            <CountBadge
              count={shown.length}
              label={shown.length === 1 ? "photo" : "photos"}
            />
          ) : null}
        </h2>
        {shown.length > 0 ? (
          <p className="text-body text-ink-muted">{ATTENTION_COPY.intro}</p>
        ) : null}
        <p role="status" className="text-body text-ink empty:hidden">
          {outcome}
        </p>
      </div>
      {loadError ? (
        <Notice
          tone="attention"
          action={
            <Button
              type="button"
              variant="secondary"
              size="touch"
              onClick={() => setReloads((n) => n + 1)}
            >
              {ATTENTION_COPY.tryAgain}
            </Button>
          }
        >
          {loadError}
        </Notice>
      ) : null}
      {shown.length > 0 ? (
        <ul
          ref={listRef}
          aria-label={ATTENTION_COPY.list}
          className="grid divide-y divide-line overflow-hidden rounded-card bg-surface shadow-card"
        >
          {shown.map((item, index) => (
            <AttentionRow
              key={item.assetId}
              item={item}
              position={`${index + 1} of ${shown.length}`}
              busy={busy.has(item.assetId)}
              error={rowErrors.get(item.assetId) ?? null}
              notFinished={
                !item.applied && (isRetryable(item) || stopped(item))
              }
              onFix={() => void openFix(item)}
              onDiscard={() => setConfirming(item)}
              onKeep={() => drop(item.assetId, ATTENTION_COPY.kept)}
              onOpenAdd={openAdd ? () => openAdd() : null}
            />
          ))}
        </ul>
      ) : null}
      <AlertDialog
        open={confirming !== null}
        onOpenChange={(open) => {
          if (!open) setConfirming(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{ATTENTION_COPY.discardTitle}</AlertDialogTitle>
            <AlertDialogDescription className="text-ink">
              {ATTENTION_COPY.discardMeaning}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <Button
              variant="outline"
              size="touch"
              onClick={() => {
                const item = confirming
                setConfirming(null)
                if (item) void discard(item)
              }}
            >
              {ATTENTION_COPY.discard}
            </Button>
            <AlertDialogCancel variant="primary" size="touch">
              {ATTENTION_COPY.keep}
            </AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {fixing ? (
        <FixLabelsDialog
          open
          onOpenChange={(open) => {
            if (!open) setFixing(null)
          }}
          asset={fixing.asset}
          draft={fixing.draft}
          problem={
            fixing.since
              ? { code: "conflict", message: ATTENTION_COPY.savedSince }
              : fixing.item.code && !fixing.item.applied
                ? {
                    code: fixing.item.code,
                    message: attentionReason(fixing.item),
                  }
                : null
          }
          catalogue={fixing.catalogue}
          onRetryCatalogue={() => void retryCatalogue()}
          focus={fixing.focus}
          onSave={(input) => saveFix(fixing.item, input)}
        />
      ) : null}
    </section>
  )
}

const HEADING = "heading"

function AttentionRow({
  item,
  position,
  busy,
  error,
  notFinished,
  onFix,
  onDiscard,
  onKeep,
  onOpenAdd,
}: {
  item: Row
  /** "1 of 2": tells rows (and their same-named buttons) apart by ear. */
  position: string
  busy: boolean
  error: string | null
  /** Its upload didn't finish: the labels wait for the photo chosen again. */
  notFinished: boolean
  onFix: () => void
  onDiscard: () => void
  onKeep: () => void
  /** Null outside the staff layout. */
  onOpenAdd: (() => void) | null
}) {
  const id = React.useId()
  const applied = item.applied
  const unusable = !applied && isUnusable(item)
  const kind = item.mediaType === "video" ? "Video" : "Photo"
  // aria-disabled, not disabled: the pressed button keeps focus while busy.
  const guard = (action: () => void) => () => {
    if (!busy) action()
  }
  return (
    <li
      data-asset-id={item.assetId}
      aria-labelledby={`${id}-reason`}
      className="grid grid-cols-[3.5rem_minmax(0,1fr)] gap-x-3 gap-y-2 p-3"
    >
      <span className="relative grid aspect-square w-14 place-items-center overflow-hidden rounded-control bg-plate text-ink-muted">
        {item.thumbnailUrl ? (
          // Signed private URLs never go through next/image (see MediaTile).
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={item.thumbnailUrl}
            alt=""
            loading="lazy"
            decoding="async"
            className="absolute inset-0 size-full object-cover"
          />
        ) : item.mediaType === "video" ? (
          <VideoCameraIcon aria-hidden className="size-6" />
        ) : (
          <ImageIcon aria-hidden className="size-6" />
        )}
      </span>
      <div className="grid min-w-0 content-start gap-1">
        <StatusChip tone={applied ? "positive" : "attention"} className="w-fit">
          {applied ? ATTENTION_COPY.saved : ATTENTION_COPY.heading}
        </StatusChip>
        <p
          id={`${id}-reason`}
          className="text-body [overflow-wrap:anywhere] text-ink"
        >
          <span className="sr-only">
            {kind} {position}:{" "}
          </span>
          {applied ? ATTENTION_COPY.alreadySaved : attentionReason(item)}
        </p>
        {applied?.labels ? <LabelSummary labels={applied.labels} /> : null}
        {unusable ? (
          <p className="text-meta text-ink-muted">
            Labels: {ATTENTION_COPY.unusableLabels}
          </p>
        ) : null}
        {notFinished ? (
          <p className="text-meta text-ink-muted">
            {ATTENTION_COPY.photoNotFinished}
          </p>
        ) : null}
        {busy ? (
          <p className="text-meta text-ink-muted">{ATTENTION_COPY.working}</p>
        ) : null}
        {error ? (
          <p role="alert" className="text-meta text-warn-fg">
            {error}
          </p>
        ) : null}
      </div>
      <div className="col-span-2 flex flex-wrap gap-2">
        {notFinished && onOpenAdd ? (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            aria-describedby={`${id}-reason`}
            onClick={onOpenAdd}
          >
            {ATTENTION_COPY.openAdd}
          </Button>
        ) : null}
        {unusable ? null : (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            aria-disabled={busy || undefined}
            aria-describedby={`${id}-reason`}
            onClick={guard(onFix)}
          >
            {ATTENTION_COPY.fix}
          </Button>
        )}
        {applied ? (
          <Button
            type="button"
            variant="quiet"
            size="sm"
            aria-disabled={busy || undefined}
            aria-describedby={`${id}-reason`}
            onClick={guard(onKeep)}
          >
            {ATTENTION_COPY.keep}
          </Button>
        ) : (
          <Button
            type="button"
            variant="quiet"
            size="sm"
            aria-disabled={busy || undefined}
            aria-describedby={`${id}-reason`}
            onClick={guard(onDiscard)}
          >
            {ATTENTION_COPY.discard}
          </Button>
        )}
      </div>
    </li>
  )
}
