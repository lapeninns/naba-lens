"use client"

import * as React from "react"
import { ImageIcon, VideoCameraIcon } from "@phosphor-icons/react"

import {
  loadLabelCatalogue,
  loadLabelEditorContext,
} from "@/app/_labels/actions"
import type { CatalogueProp } from "@/components/nabalens"
import { Notice } from "@/components/nabalens/notice"
import { CountBadge, StatusChip } from "@/components/nabalens/status-chip"
import { Button } from "@/components/ui/button"
import type { WorkFocus } from "@/lib/config/work-roles"
import type { LabelEditorAsset, SaveLabelsInput } from "@/lib/menus/types"

// TODO(integration): import { FixLabelsDialog } from "@/components/nabalens/labels"
// and delete ./fix-labels-dialog-stub.tsx.
import { FixLabelsDialog } from "./fix-labels-dialog-stub"
import {
  discardPendingLabels,
  loadNeedsAttention,
  saveFixedLabels,
  type PendingLabelItem,
} from "./needs-attention-api"

/** The exact words of Me's "Needs attention" list. */
export const ATTENTION_COPY = {
  heading: "Needs attention",
  intro: "Labels we couldn't add to these photos. Fix them, or discard them.",
  list: "Photos that need attention",
  menuChanged: "The menu changed. Check the dish.",
  notSaved: "Labels not saved yet.",
  conflict: "These labels were changed somewhere else. Check the dish.",
  otherFailure: "Labels couldn't be added.",
  unusable: "This file can't be used.",
  unusableLabels: "Not saved (photo not saved)",
  fix: "Fix labels",
  discard: "Discard labels",
  discardFailed: "Couldn't discard the labels. Try again.",
  openFailed: "Couldn't open the labels. Check your connection and try again.",
  loadFailed: "We couldn't check for photos that need attention.",
  tryAgain: "Try again",
} as const

/** Upload states that will never give the stored labels a photo to go on. */
const UNUSABLE = new Set(["failed", "rejected", "deleted"])

/**
 * Rows Me lists: labels the server could not apply, and labels whose upload
 * can never finish. Labels still waiting for their photo are not listed:
 * they are saving, and Add shows them.
 */
export function attentionItems(
  items: readonly PendingLabelItem[]
): PendingLabelItem[] {
  return items.filter(
    (item) =>
      item.status === "needs_attention" || UNUSABLE.has(item.uploadState)
  )
}

/** Why one row needs attention, in the flow's own words. */
export function attentionReason(item: PendingLabelItem): string {
  if (UNUSABLE.has(item.uploadState)) return ATTENTION_COPY.unusable
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

type Fixing = {
  item: PendingLabelItem
  asset: LabelEditorAsset
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
 * kept but could not add (the menu changed, a save failed), each with its
 * reason, "Fix labels" (the stored labels against the current menu) and
 * "Discard labels". Reloads whenever `refreshSignal` changes (an upload
 * finished). Renders nothing while there is nothing to fix.
 */
export function NeedsAttention({
  refreshSignal = 0,
  onFixed,
  api = API,
}: {
  refreshSignal?: number
  /** Labels were saved on these photos: refresh the gallery. */
  onFixed?: (assetIds: string[]) => void
  api?: NeedsAttentionApi
}) {
  const [items, setItems] = React.useState<PendingLabelItem[]>([])
  const [loadError, setLoadError] = React.useState<string | null>(null)
  const [reloads, setReloads] = React.useState(0)
  // Each row's own action in flight: one finishing never frees another.
  const [busy, setBusy] = React.useState<ReadonlySet<string>>(() => new Set())
  const [rowErrors, setRowErrors] = React.useState<ReadonlyMap<string, string>>(
    new Map()
  )
  const [fixing, setFixing] = React.useState<Fixing | null>(null)
  // Rows discarded or fixed here: a read that started before the server
  // changed must not bring them back.
  const handled = React.useRef(new Set<string>())

  React.useEffect(() => {
    const controller = new AbortController()
    api.load(controller.signal).then(
      (result) => {
        if (controller.signal.aborted) return
        if (result.ok) {
          const next = attentionItems(result.items).filter(
            (i) => !handled.current.has(i.assetId)
          )
          setItems(next)
          // A row that left the list takes its open Fix labels with it.
          setFixing((f) =>
            f && next.some((i) => i.assetId === f.item.assetId) ? f : null
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

  const drop = (assetId: string) => {
    handled.current.add(assetId)
    setItems((current) => current.filter((i) => i.assetId !== assetId))
  }

  const markBusy = (assetId: string, on: boolean) =>
    setBusy((current) => {
      const next = new Set(current)
      if (on) next.add(assetId)
      else next.delete(assetId)
      return next
    })

  async function discard(item: PendingLabelItem) {
    markBusy(item.assetId, true)
    setRowError(item.assetId, null)
    const ok = await api.discard(item.assetId)
    markBusy(item.assetId, false)
    if (ok) drop(item.assetId)
    else setRowError(item.assetId, ATTENTION_COPY.discardFailed)
  }

  async function openFix(item: PendingLabelItem) {
    markBusy(item.assetId, true)
    setRowError(item.assetId, null)
    try {
      const context = await api.loadContext([item.assetId])
      const asset = context.ok ? context.assets[0] : undefined
      if (!context.ok || !asset) {
        setRowError(
          item.assetId,
          context.ok ? ATTENTION_COPY.openFailed : context.message
        )
        return
      }
      // Discarded (or fixed) while its labels were loading: nothing to fix.
      if (handled.current.has(item.assetId)) return
      setFixing({
        item,
        asset,
        catalogue: context.catalogue
          ? { state: "ready", catalogue: context.catalogue }
          : {
              state: "error",
              message: context.catalogueError ?? ATTENTION_COPY.openFailed,
            },
        focus: context.focus ?? null,
      })
    } catch {
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
    } catch {
      set({ state: "error", message: ATTENTION_COPY.openFailed })
    }
  }

  async function saveFix(item: PendingLabelItem, input: SaveLabelsInput) {
    const result = await api.save(item.venueId, input)
    if (!result.ok) return result
    if (result.pending) {
      // Still kept on the server for a photo that isn't ready: re-read.
      setReloads((n) => n + 1)
    } else {
      drop(item.assetId)
      onFixed?.([item.assetId])
    }
    return result
  }

  if (items.length === 0 && !loadError) return null

  return (
    <section
      aria-labelledby="needs-attention-heading"
      className="grid gap-3 pt-2"
    >
      <div className="grid gap-1 px-1">
        <h2
          id="needs-attention-heading"
          className="flex items-center gap-2 font-display text-section-title text-ink"
        >
          {ATTENTION_COPY.heading}
          {items.length > 0 ? (
            <CountBadge
              count={items.length}
              label={items.length === 1 ? "photo" : "photos"}
            />
          ) : null}
        </h2>
        {items.length > 0 ? (
          <p className="text-body text-ink-muted">{ATTENTION_COPY.intro}</p>
        ) : null}
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
      {items.length > 0 ? (
        <ul
          aria-label={ATTENTION_COPY.list}
          className="grid divide-y divide-line overflow-hidden rounded-card bg-surface shadow-card"
        >
          {items.map((item, index) => (
            <AttentionRow
              key={item.assetId}
              item={item}
              position={`${index + 1} of ${items.length}`}
              busy={busy.has(item.assetId)}
              error={rowErrors.get(item.assetId) ?? null}
              onFix={() => void openFix(item)}
              onDiscard={() => void discard(item)}
            />
          ))}
        </ul>
      ) : null}
      {fixing ? (
        <FixLabelsDialog
          open
          onOpenChange={(open) => {
            if (!open) setFixing(null)
          }}
          asset={fixing.asset}
          draft={fixing.item.input}
          problem={
            fixing.item.code
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

function AttentionRow({
  item,
  position,
  busy,
  error,
  onFix,
  onDiscard,
}: {
  item: PendingLabelItem
  /** "1 of 2": tells rows (and their same-named buttons) apart by ear. */
  position: string
  busy: boolean
  error: string | null
  onFix: () => void
  onDiscard: () => void
}) {
  const id = React.useId()
  const unusable = UNUSABLE.has(item.uploadState)
  const kind = item.mediaType === "video" ? "Video" : "Photo"
  return (
    <li
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
        <StatusChip tone="attention" className="w-fit">
          {ATTENTION_COPY.heading}
        </StatusChip>
        <p
          id={`${id}-reason`}
          className="text-body [overflow-wrap:anywhere] text-ink"
        >
          <span className="sr-only">
            {kind} {position}:{" "}
          </span>
          {attentionReason(item)}
        </p>
        {unusable ? (
          <p className="text-meta text-ink-muted">
            Labels: {ATTENTION_COPY.unusableLabels}
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="text-meta text-warn-fg">
            {error}
          </p>
        ) : null}
      </div>
      <div className="col-span-2 flex flex-wrap gap-2">
        {unusable ? null : (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={busy}
            aria-describedby={`${id}-reason`}
            onClick={onFix}
          >
            {ATTENTION_COPY.fix}
          </Button>
        )}
        <Button
          type="button"
          variant="quiet"
          size="sm"
          disabled={busy}
          aria-describedby={`${id}-reason`}
          onClick={onDiscard}
        >
          {ATTENTION_COPY.discard}
        </Button>
      </div>
    </li>
  )
}
