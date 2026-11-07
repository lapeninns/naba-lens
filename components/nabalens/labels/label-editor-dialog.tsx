"use client"

import * as React from "react"
import { useObjectUrl } from "@/components/nabalens/use-upload-queue"
import {
  ArrowClockwiseIcon,
  CaretDownIcon,
  FilmStripIcon,
  ImageIcon,
} from "@phosphor-icons/react"

import { Notice } from "@/components/nabalens/notice"
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  LABEL_LIMITS,
  type ContentType,
  type LabelEditorAsset,
  type MediaLabelSummary,
  type SaveLabelsResult,
} from "@/lib/menus/types"
import { cn } from "@/lib/utils"

import { formatTime } from "../format"
import { buildCatalogueIndex } from "./catalogue-search"
import {
  EMPTY_COMMON,
  IDLE,
  NO_ADJUST,
  addItem,
  adoptCurrent,
  buildSaveInput,
  effectiveLabels,
  isDirty,
  isPickable,
  itemKey,
  limitProblem,
  presetDraft,
  removeItem,
  setContentType,
  type CommonDraft,
  type DraftItem,
  type EffectiveItem,
  type EffectiveLabels,
  type FileAdjust,
  type FileStatus,
} from "./label-draft"
import { FIELD_HINT } from "./field-styles"
import { itemDisplayName, LabelFields } from "./label-fields"
import { LabelSummary } from "./label-summary"
import type { LabelAudience, LabelEditorDialogProps } from "./types"

/** The merge rule, stated where the common selection is edited. */
export const BATCH_MERGE_RULE =
  "Each file keeps the labels it already has and gets everything chosen here. To leave something off one file, open that file below and remove it there. A note written for one file replaces the common note for that file."

type FileState = {
  base: MediaLabelSummary
  adj: FileAdjust
  status: FileStatus
}

/**
 * Optional labels for 1..10 files of one venue. Presentational: the host
 * loads the catalogue and saves through `onSave`. Mounted only while open, so
 * every opening starts from the assets' saved labels.
 */
export function LabelEditorDialog(props: LabelEditorDialogProps) {
  if (!props.open || props.assets.length === 0) return null
  return (
    <LabelEditor key={props.assets.map((a) => a.id).join(",")} {...props} />
  )
}

function Thumb({ asset, file }: { asset: LabelEditorAsset; file?: File }) {
  const [failed, setFailed] = React.useState(false)
  const localUrl = useObjectUrl(asset.mediaType === "image" ? file : null)
  const thumbnail = localUrl ?? asset.thumbnailUrl
  const Icon = asset.mediaType === "video" ? FilmStripIcon : ImageIcon
  return (
    <span className="flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-control bg-surface-2 text-ink-muted">
      {thumbnail && !failed ? (
        // Signed private URL; not routed through next/image (see MediaTile).
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={thumbnail}
          alt=""
          className="size-full object-cover"
          onError={() => setFailed(true)}
        />
      ) : (
        <Icon className="size-5" aria-hidden />
      )}
    </span>
  )
}

/** "photo", "video" or "file" for what the assets are. */
function nounFor(assets: LabelEditorAsset[]) {
  if (assets.every((a) => a.mediaType === "image")) return "photo"
  if (assets.every((a) => a.mediaType === "video")) return "video"
  return "file"
}

function countText(eff: EffectiveLabels) {
  const parts = []
  if (eff.items.length)
    parts.push(
      `${eff.items.length} menu ${eff.items.length === 1 ? "item" : "items"}`
    )
  if (eff.contentTypes.length)
    parts.push(
      `${eff.contentTypes.length} content ${eff.contentTypes.length === 1 ? "type" : "types"}`
    )
  if (eff.note.trim()) parts.push("note")
  return parts.length ? parts.join(" · ") : "No labels"
}

function conflictText(audience: LabelAudience, current?: MediaLabelSummary) {
  if (audience === "staff")
    return "An admin changed these labels a moment ago. Their labels are shown; check them, then save."
  const at = current?.updatedAt ? new Date(current.updatedAt) : null
  const when =
    at && !Number.isNaN(at.getTime()) ? `at ${formatTime(at)}` : "a moment ago"
  return `Someone else changed these labels ${when}. The latest labels are shown; check them and save again if you still need to.`
}

function FileProblem({
  id,
  audience,
  status,
  problem,
  unavailableCount,
  pending,
  onAdopt,
  onReapply,
  onRemoveUnavailable,
  onReloadMenu,
}: {
  id: string
  audience: LabelAudience
  status: FileStatus
  problem: string | null
  unavailableCount: number
  pending: boolean
  onAdopt: () => void
  onReapply: () => void
  onRemoveUnavailable: () => void
  onReloadMenu: () => void
}) {
  // Focus moves to these notices and the editor's status line announces the
  // outcome, so they are not live regions themselves (no double announcement).
  if (status.kind === "adopted") {
    return (
      <Notice id={id} tabIndex={-1} tone="positive" role="none">
        Using the labels that are saved now. Nothing to save for this file
        unless you change it again.
      </Notice>
    )
  }
  if (status.kind !== "error" && !problem) return null

  if (!problem && status.kind === "error" && status.code === "conflict") {
    return (
      <Notice id={id} tabIndex={-1} tone="attention" role="none">
        <div className="grid gap-3">
          <p>{conflictText(audience, status.current)}</p>
          {status.current ? (
            <>
              <div className="rounded-card bg-surface p-3 shadow-card">
                <p className="mb-1 text-meta-strong text-ink-muted">
                  Saved now
                </p>
                <LabelSummary labels={status.current} />
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={onAdopt}
                  disabled={pending}
                >
                  Use the saved labels
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={onReapply}
                  disabled={pending}
                >
                  Keep my changes on top
                </Button>
              </div>
            </>
          ) : null}
        </div>
      </Notice>
    )
  }

  let title = "Labels not saved"
  let body: React.ReactNode = null
  let action: React.ReactNode = null
  if (problem) {
    title = "Too many labels for this file"
    body = problem
  } else if (status.kind === "error") {
    body = status.message
    if (status.code === "unavailable_items") {
      title = "Some menu items are no longer available"
      body = (
        <>
          <p>{status.message}</p>
          <p>Remove the highlighted menu items, then save again.</p>
        </>
      )
      action =
        unavailableCount > 0 ? (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={onRemoveUnavailable}
            disabled={pending}
          >
            Remove unavailable items
          </Button>
        ) : null
    } else if (status.code === "catalogue_changed") {
      title = "The menu for this venue was updated while you were editing"
      body =
        "Your changes are kept. Check the menu items you picked against the updated menu, then save again."
      action = (
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={onReloadMenu}
          disabled={pending}
        >
          <ArrowClockwiseIcon data-icon="inline-start" aria-hidden />
          Reload the menu
        </Button>
      )
    }
  }

  return (
    <Notice id={id} tabIndex={-1} tone="negative" title={title} action={action}>
      <div className="grid gap-1">{body}</div>
    </Notice>
  )
}

function LabelEditor({
  audience = "staff",
  onOpenChange,
  assets,
  catalogue,
  onRetryCatalogue,
  onSave,
  uploadDraft,
  onSaved,
  title,
  cancelLabel,
  focus = null,
  preset = null,
  presetAssetIds,
}: LabelEditorDialogProps) {
  const uid = React.useId()
  const batch = assets.length > 1
  const venueName = assets[0].venueName
  const [common, setCommon] = React.useState<CommonDraft>(EMPTY_COMMON)
  const [files, setFiles] = React.useState<Record<string, FileState>>(() =>
    Object.fromEntries(
      assets.map((a) => [
        a.id,
        { base: a.labels, adj: NO_ADJUST, status: IDLE },
      ])
    )
  )
  const [expanded, setExpanded] = React.useState<string[]>([])
  const [problems, setProblems] = React.useState<Record<string, string>>({})
  const [pending, setPending] = React.useState(false)
  const [networkError, setNetworkError] = React.useState(false)
  const [announcement, setAnnouncement] = React.useState("")
  const [confirmOpen, setConfirmOpen] = React.useState(false)
  const [focusTarget, setFocusTarget] = React.useState<{ id: string } | null>(
    null
  )

  const ids = {
    problem: (assetId: string) => `${uid}-problem-${assetId}`,
    panel: (assetId: string) => `${uid}-panel-${assetId}`,
    network: `${uid}-network`,
    status: `${uid}-status`,
  }

  React.useEffect(() => {
    if (focusTarget) document.getElementById(focusTarget.id)?.focus()
  }, [focusTarget])

  const ready = catalogue.state === "ready" ? catalogue.catalogue : null
  const catalogueVersionId = ready?.status === "active" ? ready.versionId : null
  const index = React.useMemo(
    () => buildCatalogueIndex(ready, focus),
    [ready, focus]
  )

  // A suggested item (Our menu's photo request) goes in once, as an unsaved
  // draft, as soon as the menu is loaded, on the files it came with only: a
  // common item when that is every file of a batch, else on each of those
  // files. Earlier files in the same batch stay as they were. Saving stays the
  // person's choice.
  const presetTargets = assets
    .filter((a) => !presetAssetIds || presetAssetIds.includes(a.id))
    .map((a) => a.id)
  const [presetPending, setPresetPending] = React.useState(
    preset !== null && presetTargets.length > 0
  )
  const [suggested, setSuggested] = React.useState<DraftItem | null>(null)
  if (presetPending && ready) {
    setPresetPending(false)
    const draft = presetDraft(ready, preset)
    if (draft) {
      setSuggested(draft)
      if (presetTargets.length < assets.length) {
        setFiles((prev) => {
          const next = { ...prev }
          for (const id of presetTargets)
            next[id] = { ...prev[id], adj: addItem(prev[id].adj, draft) }
          return next
        })
      } else if (batch) {
        const key = itemKey(draft)
        setCommon((c) => ({
          ...c,
          items: [...c.items.filter((i) => itemKey(i) !== key), draft],
        }))
      } else {
        const id = assets[0].id
        setFiles((prev) => ({
          ...prev,
          [id]: { ...prev[id], adj: addItem(prev[id].adj, draft) },
        }))
      }
    }
  }

  const effective = React.useMemo(
    () =>
      Object.fromEntries(
        assets.map((a) => [
          a.id,
          effectiveLabels(files[a.id].base, common, files[a.id].adj),
        ])
      ) as Record<string, EffectiveLabels>,
    [assets, files, common]
  )
  const dirtyIds = assets
    .filter((a) => isDirty(files[a.id].base, effective[a.id]))
    .map((a) => a.id)

  /** Newly picked items the loaded catalogue no longer offers, + server ones. */
  function unavailableKeysFor(items: EffectiveItem[], status?: FileStatus) {
    const keys = new Set<string>()
    const serverIds =
      status?.kind === "error" ? (status.unavailableItemIds ?? []) : []
    for (const item of items) {
      if (serverIds.includes(item.itemId)) keys.add(item.key)
      else if (ready && !item.saved && !isPickable(ready, item))
        keys.add(item.key)
    }
    return keys
  }

  // -------------------------------------------------------------------------
  // Edits
  // -------------------------------------------------------------------------

  function updateFile(assetId: string, fn: (f: FileState) => FileState) {
    setFiles((prev) => ({ ...prev, [assetId]: fn(prev[assetId]) }))
  }
  function adjust(assetId: string, fn: (adj: FileAdjust) => FileAdjust) {
    updateFile(assetId, (f) => ({ ...f, adj: fn(f.adj) }))
  }

  function toggleFileType(assetId: string, type: ContentType) {
    const on = !effective[assetId].contentTypes.includes(type)
    if (
      on &&
      effective[assetId].contentTypes.length >= LABEL_LIMITS.maxContentTypes
    )
      return
    adjust(assetId, (adj) => setContentType(adj, type, on))
  }

  function toggleCommonType(type: ContentType) {
    setCommon((c) =>
      c.contentTypes.includes(type)
        ? { ...c, contentTypes: c.contentTypes.filter((t) => t !== type) }
        : c.contentTypes.length >= LABEL_LIMITS.maxContentTypes
          ? c
          : { ...c, contentTypes: [...c.contentTypes, type] }
    )
  }

  function addCommonItem(item: DraftItem) {
    const key = itemKey(item)
    setCommon((c) => ({
      ...c,
      items: [...c.items.filter((i) => itemKey(i) !== key), item],
    }))
  }

  function removeCommonItem(item: EffectiveItem) {
    setCommon((c) => ({
      ...c,
      items: c.items.filter((i) => itemKey(i) !== item.key),
    }))
  }

  // -------------------------------------------------------------------------
  // Recovery
  // -------------------------------------------------------------------------

  function adopt(assetId: string) {
    updateFile(assetId, (f) =>
      f.status.kind === "error" && f.status.current
        ? {
            base: f.status.current,
            adj: adoptCurrent(f.status.current, common),
            status: { kind: "adopted" },
          }
        : f
    )
    setAnnouncement("Kept the labels that are saved now.")
    setFocusTarget({ id: ids.problem(assetId) })
  }

  function reapply(assetId: string) {
    updateFile(assetId, (f) =>
      f.status.kind === "error" && f.status.current
        ? { ...f, base: f.status.current, status: IDLE }
        : f
    )
    setAnnouncement(
      "Your changes are now on top of the saved labels. Save to keep them."
    )
    setFocusTarget({ id: `${uid}-save` })
  }

  function removeUnavailable(assetId: string) {
    const status = files[assetId].status
    const keys = unavailableKeysFor(effective[assetId].items, status)
    adjust(assetId, (adj) =>
      effective[assetId].items
        .filter((i) => keys.has(i.key))
        .reduce((a, i) => removeItem(a, i.key, i.saved || i.fromCommon), adj)
    )
    updateFile(assetId, (f) => ({ ...f, status: IDLE }))
    setAnnouncement(
      `Removed ${keys.size} unavailable menu ${keys.size === 1 ? "item" : "items"}. Save again to finish.`
    )
    setFocusTarget({ id: `${uid}-save` })
  }

  // -------------------------------------------------------------------------
  // Save
  // -------------------------------------------------------------------------

  async function save() {
    if (pending) return
    setNetworkError(false)

    const nextProblems: Record<string, string> = {}
    for (const id of dirtyIds) {
      const problem = limitProblem(effective[id])
      if (problem) nextProblems[id] = problem
    }
    setProblems(nextProblems)
    const problemIds = assets.map((a) => a.id).filter((id) => nextProblems[id])
    if (problemIds.length > 0) {
      setExpanded((prev) => [...new Set([...prev, ...problemIds])])
      setAnnouncement("Some files have too many labels. Nothing was saved.")
      setFocusTarget({ id: ids.problem(problemIds[0]) })
      return
    }

    const targets = assets.filter((a) => dirtyIds.includes(a.id))
    if (targets.length === 0) {
      onOpenChange(false)
      return
    }
    const inputs = targets.map((a) =>
      buildSaveInput(
        a.id,
        files[a.id].base,
        effective[a.id],
        catalogueVersionId
      )
    )

    if (uploadDraft) {
      uploadDraft.onQueue(inputs)
      onOpenChange(false)
      return
    }
    if (!onSave) return
    setPending(true)
    setAnnouncement("Saving labels…")
    let results: SaveLabelsResult[]
    try {
      results = await onSave(inputs)
      if (!Array.isArray(results)) throw new Error("No results")
    } catch {
      setPending(false)
      setNetworkError(true)
      setAnnouncement("")
      setFocusTarget({ id: ids.network })
      return
    }

    const outcomes = targets.map((a) => results.find((r) => r.assetId === a.id))
    setFiles((prev) => {
      const next = { ...prev }
      targets.forEach((a, i) => {
        const r = outcomes[i]
        const f = prev[a.id]
        if (!r) {
          next[a.id] = {
            ...f,
            status: {
              kind: "error",
              code: "no_result",
              message:
                "Saving this file was not confirmed. Try again; your changes are kept.",
            },
          }
        } else if (r.ok) {
          next[a.id] = {
            base: r.labels,
            adj: adoptCurrent(r.labels, common),
            status: { kind: "saved" },
          }
        } else {
          next[a.id] = {
            ...f,
            status: {
              kind: "error",
              code: r.code,
              message: r.message,
              current: r.current,
              unavailableItemIds: r.unavailableItemIds,
            },
          }
        }
      })
      return next
    })
    setPending(false)

    const saved = outcomes.filter(
      (r): r is Extract<SaveLabelsResult, { ok: true }> => !!r?.ok
    )
    const failed = targets.filter((_, i) => !outcomes[i]?.ok)
    if (outcomes.some((r) => r && !r.ok && r.code === "catalogue_changed"))
      onRetryCatalogue()
    if (saved.length > 0) onSaved?.(saved)

    if (failed.length === 0) {
      onOpenChange(false)
      return
    }
    if (batch)
      setExpanded((prev) => [...new Set([...prev, ...failed.map((a) => a.id)])])
    setAnnouncement(
      batch
        ? `${saved.length} of ${targets.length} files saved. ${failed.length} ${failed.length === 1 ? "needs" : "need"} attention.`
        : "Labels not saved."
    )
    setFocusTarget({ id: ids.problem(failed[0].id) })
  }

  // -------------------------------------------------------------------------
  // Close / skip
  // -------------------------------------------------------------------------

  function requestClose() {
    if (pending) return
    if (dirtyIds.length > 0) setConfirmOpen(true)
    else onOpenChange(false)
  }

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  const noun = nounFor(assets)
  const nouns = `${noun}s`
  const suggestedKey = suggested ? itemKey(suggested) : null
  const suggestedShown =
    suggestedKey !== null &&
    assets.some((a) =>
      effective[a.id].items.some((i) => i.key === suggestedKey && !i.saved)
    )
  const heading = title ?? (audience === "admin" ? "Edit labels" : "Labels")
  const dismissText = cancelLabel ?? "Cancel"

  /** How a file is named on screen: staff never see original file names. */
  function fileLabel(asset: LabelEditorAsset) {
    if (audience === "admin" || uploadDraft) return asset.originalFilename
    const n = assets.indexOf(asset) + 1
    return `${asset.mediaType === "video" ? "Video" : "Photo"} ${n}`
  }
  /** The same name inside a sentence ("for photo 2", "for IMG_2041.HEIC"). */
  function fileRef(asset: LabelEditorAsset) {
    return audience === "admin"
      ? asset.originalFilename
      : fileLabel(asset).toLowerCase()
  }

  const menusHref =
    audience === "admin"
      ? `/admin/menus/${encodeURIComponent(assets[0].venueId)}`
      : undefined

  function fileFields(asset: LabelEditorAsset, scope: "single" | "file") {
    const f = files[asset.id]
    const eff = effective[asset.id]
    return (
      <LabelFields
        scope={scope}
        audience={audience}
        fileName={fileRef(asset)}
        mediaNoun={asset.mediaType === "video" ? "video" : "photo"}
        venueName={venueName}
        menusHref={menusHref}
        catalogue={catalogue}
        index={index}
        items={eff.items}
        unavailableKeys={unavailableKeysFor(eff.items, f.status)}
        removedCommon={eff.removedCommon}
        onAddItem={(item) => adjust(asset.id, (adj) => addItem(adj, item))}
        onRemoveItem={(item) =>
          adjust(asset.id, (adj) =>
            removeItem(adj, item.key, item.saved || item.fromCommon)
          )
        }
        onRestoreItem={(item) => adjust(asset.id, (adj) => addItem(adj, item))}
        contentTypes={eff.contentTypes}
        onToggleType={(type) => toggleFileType(asset.id, type)}
        note={eff.note}
        noteSource={eff.noteSource}
        onNoteChange={(note) => adjust(asset.id, (adj) => ({ ...adj, note }))}
        onUseCommonNote={() =>
          adjust(asset.id, (adj) => ({ ...adj, note: undefined }))
        }
        missingItem={{
          value: eff.missingItem,
          saved: f.base.missingItem,
          onChange: (missingItem) =>
            adjust(asset.id, (adj) => ({ ...adj, missingItem })),
        }}
        disabled={pending}
        focusTypes={focus?.contentTypes}
      />
    )
  }

  function problemBlock(asset: LabelEditorAsset) {
    const f = files[asset.id]
    const eff = effective[asset.id]
    return (
      <FileProblem
        id={ids.problem(asset.id)}
        audience={audience}
        status={f.status}
        problem={
          problems[asset.id] && limitProblem(eff) ? problems[asset.id] : null
        }
        unavailableCount={unavailableKeysFor(eff.items, f.status).size}
        pending={pending}
        onAdopt={() => adopt(asset.id)}
        onReapply={() => reapply(asset.id)}
        onRemoveUnavailable={() => removeUnavailable(asset.id)}
        onReloadMenu={onRetryCatalogue}
      />
    )
  }

  const commonEff: EffectiveLabels = {
    items: common.items.map((i) => ({
      ...i,
      key: itemKey(i),
      saved: false,
      fromCommon: true,
    })),
    contentTypes: common.contentTypes,
    note: common.note,
    noteSource: "common",
    missingItem: "",
    removedCommon: [],
  }

  const single = assets[0]
  const singleTitle =
    audience === "admin"
      ? single.mediaType === "video"
        ? "Video"
        : "Photo"
      : single.mediaType === "video"
        ? "Your video"
        : "Your photo"
  const singleMeta =
    audience === "admin"
      ? `${venueName} · ${single.originalFilename}`
      : venueName

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) requestClose()
      }}
    >
      <DialogContent
        className={cn(
          "gap-0 p-0 pt-3 pb-0 md:p-0",
          audience === "admin" && "md:max-w-(--size-dialog-wide)"
        )}
      >
        <form
          noValidate
          onSubmit={(e) => {
            e.preventDefault()
            // Wait for a (re)loading menu: saving now would only be refused
            // again as a stale-menu conflict (QA observation).
            if (catalogue.state === "loading") return
            void save()
          }}
          className="grid min-w-0 grid-cols-[minmax(0,1fr)]"
        >
          <div className="grid min-w-0 gap-4 px-4 pt-1 pb-4 md:px-5 md:pt-5 md:pb-5">
            <DialogHeader>
              <DialogTitle>{heading}</DialogTitle>
              <DialogDescription>
                {uploadDraft
                  ? "Uploads continue while you label. Each file gets its labels once it finishes processing."
                  : audience === "staff"
                    ? "Your uploads stay in your portfolio. Saved dish and content type labels also group them in the admin library."
                    : "Saved dish and content type labels determine which folders show these files in the library."}
              </DialogDescription>
            </DialogHeader>

            {networkError ? (
              <Notice
                tone="negative"
                id={ids.network}
                tabIndex={-1}
                title="The labels couldn't be saved"
              >
                Your choices are still here. Check your connection and try
                again.
              </Notice>
            ) : null}

            {catalogue.state === "error" ? (
              <Notice
                tone="negative"
                title="The menu couldn't be loaded"
                action={
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={onRetryCatalogue}
                  >
                    <ArrowClockwiseIcon data-icon="inline-start" aria-hidden />
                    Retry loading the menu
                  </Button>
                }
              >
                <p>{catalogue.message}</p>
                <p>Your choices so far are kept.</p>
              </Notice>
            ) : null}

            {suggested && suggestedShown ? (
              <Notice tone="plain" title="Suggested from Our menu">
                {presetTargets.length < assets.length
                  ? `${itemDisplayName(suggested)} is added as a label for the ${presetTargets.length === 1 ? `${noun} picked` : `${presetTargets.length} ${nouns} picked`} for it, not the others. It's saved only when you choose Save labels; remove it if it isn't in the ${presetTargets.length === 1 ? noun : nouns}.`
                  : `${itemDisplayName(suggested)} is added as a label for ${batch ? `these ${nouns}` : `this ${noun}`}. It's saved only when you choose Save labels; remove it if it isn't in the ${batch ? nouns : noun}.`}
              </Notice>
            ) : null}

            {batch ? (
              <>
                <section
                  aria-labelledby={`${uid}-common`}
                  className="grid gap-4"
                >
                  <h3 id={`${uid}-common`} className="sr-only">
                    {`Common to all ${assets.length} ${nouns}`}
                  </h3>
                  <ul aria-hidden="true" className="flex flex-wrap gap-2">
                    {assets.map((asset) => (
                      <li key={asset.id}>
                        <Thumb
                          asset={asset}
                          file={uploadDraft?.files.get(asset.id)}
                        />
                      </li>
                    ))}
                  </ul>
                  <div className="grid gap-1">
                    <p className="text-body text-ink-muted">
                      {`These labels go on all ${assets.length} ${nouns}. You can change one ${noun}'s labels later from the ${noun} itself.`}
                    </p>
                    <p className={FIELD_HINT}>{BATCH_MERGE_RULE}</p>
                  </div>
                  <LabelFields
                    scope="common"
                    audience={audience}
                    mediaNoun={noun}
                    venueName={venueName}
                    menusHref={menusHref}
                    catalogue={catalogue}
                    index={index}
                    items={commonEff.items}
                    unavailableKeys={unavailableKeysFor(commonEff.items)}
                    onAddItem={addCommonItem}
                    onRemoveItem={removeCommonItem}
                    contentTypes={common.contentTypes}
                    onToggleType={toggleCommonType}
                    note={common.note}
                    onNoteChange={(note) => setCommon((c) => ({ ...c, note }))}
                    disabled={pending}
                    focusTypes={focus?.contentTypes}
                  />
                </section>

                <section
                  aria-labelledby={`${uid}-files`}
                  className="grid gap-2"
                >
                  <div className="grid gap-1">
                    <h3
                      id={`${uid}-files`}
                      className="font-display text-item-title text-ink"
                    >
                      {`Each ${noun}`}
                    </h3>
                    <p className={FIELD_HINT}>
                      {`Open a ${noun} to add or remove labels for that ${noun} only.`}
                    </p>
                  </div>
                  <ul
                    aria-label={`${noun[0].toUpperCase()}${nouns.slice(1)}`}
                    className="divide-y divide-line overflow-hidden rounded-card shadow-[inset_0_0_0_1px_var(--line)]"
                  >
                    {assets.map((asset) => {
                      const f = files[asset.id]
                      const eff = effective[asset.id]
                      const isOpen = expanded.includes(asset.id)
                      const dirty = dirtyIds.includes(asset.id)
                      const hasProblem =
                        f.status.kind === "error" ||
                        (!!problems[asset.id] && !!limitProblem(eff))
                      return (
                        <li key={asset.id} className="grid gap-3 p-3">
                          <div className="flex min-w-0 items-center gap-3">
                            <Thumb
                              asset={asset}
                              file={uploadDraft?.files.get(asset.id)}
                            />
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-label text-ink">
                                {fileLabel(asset)}
                              </p>
                              <p
                                className={cn(
                                  "text-meta text-ink-muted",
                                  hasProblem && "font-bold text-warn-fg",
                                  f.status.kind === "saved" &&
                                    !dirty &&
                                    "font-bold text-ok-fg"
                                )}
                              >
                                {countText(eff)}
                                {hasProblem
                                  ? " · Not saved"
                                  : f.status.kind === "saved" && !dirty
                                    ? " · Saved"
                                    : null}
                              </p>
                            </div>
                            <Button
                              type="button"
                              variant="secondary"
                              size="sm"
                              aria-expanded={isOpen}
                              aria-controls={ids.panel(asset.id)}
                              aria-label={`Adjust labels for ${fileRef(asset)}`}
                              aria-describedby={
                                hasProblem ? ids.problem(asset.id) : undefined
                              }
                              onClick={() =>
                                setExpanded((prev) =>
                                  isOpen
                                    ? prev.filter((id) => id !== asset.id)
                                    : [...prev, asset.id]
                                )
                              }
                            >
                              Adjust
                              <CaretDownIcon
                                data-icon="inline-end"
                                aria-hidden
                                className={cn(
                                  "transition-transform motion-reduce:transition-none",
                                  isOpen && "rotate-180"
                                )}
                              />
                            </Button>
                          </div>
                          {problemBlock(asset)}
                          <div
                            id={ids.panel(asset.id)}
                            hidden={!isOpen}
                            className="grid gap-4 border-t border-line pt-3"
                          >
                            {isOpen ? fileFields(asset, "file") : null}
                          </div>
                        </li>
                      )
                    })}
                  </ul>
                </section>
              </>
            ) : (
              <>
                {problemBlock(single)}
                <div className="flex min-w-0 items-center gap-3">
                  <Thumb
                    asset={single}
                    file={uploadDraft?.files.get(single.id)}
                  />
                  <p className="min-w-0 text-body">
                    <span className="block font-bold text-ink">
                      {singleTitle}
                    </span>
                    <span className="block truncate text-ink-muted">
                      {singleMeta}
                    </span>
                  </p>
                </div>
                {fileFields(single, "single")}
              </>
            )}

            <p
              id={ids.status}
              role="status"
              aria-live="polite"
              className="text-body font-bold text-ink empty:hidden"
            >
              {announcement}
            </p>
          </div>

          <DialogFooter className="sticky bottom-0 mx-0 mb-0 pb-[calc(1rem+env(safe-area-inset-bottom,0px))] md:mx-0 md:mb-0 md:pb-4">
            <Button
              type="button"
              variant="secondary"
              size="touch"
              onClick={requestClose}
              disabled={pending}
            >
              {dismissText}
            </Button>
            <Button
              id={`${uid}-save`}
              type="submit"
              size="touch"
              disabled={pending || catalogue.state === "loading"}
              aria-busy={pending || catalogue.state === "loading"}
            >
              {pending
                ? "Saving…"
                : uploadDraft
                  ? "Save labels when ready"
                  : "Save labels"}
            </Button>
          </DialogFooter>
        </form>

        <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Discard label changes?</AlertDialogTitle>
              <AlertDialogDescription>
                {dirtyIds.length > 1
                  ? `Labels for ${dirtyIds.length} ${nouns} have not been saved.`
                  : "Your label changes have not been saved."}{" "}
                {`The ${batch ? nouns : noun} ${batch ? "stay" : "stays"} uploaded either way.`}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel size="touch">Keep editing</AlertDialogCancel>
              <Button
                type="button"
                variant="danger"
                size="touch"
                onClick={() => {
                  setConfirmOpen(false)
                  onOpenChange(false)
                }}
              >
                Discard changes
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </DialogContent>
    </Dialog>
  )
}
