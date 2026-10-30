"use client"

import * as React from "react"
import {
  ArrowClockwiseIcon,
  CaretDownIcon,
  CheckCircleIcon,
  FilmStripIcon,
  ImageIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
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
  removeItem,
  setContentType,
  type CommonDraft,
  type DraftItem,
  type EffectiveItem,
  type EffectiveLabels,
  type FileAdjust,
  type FileStatus,
} from "./label-draft"
import { LabelFields } from "./label-fields"
import { LabelSummary } from "./label-summary"
import type { LabelEditorDialogProps } from "./types"

/** The merge rule, stated where the common selection is edited. */
export const BATCH_MERGE_RULE =
  "Each file keeps the labels it already has and gets everything chosen here. To leave something off one file, open that file below and remove it there. A note written for one file replaces the common note for that file."

const NETWORK_ERROR =
  "Labels could not be saved. Check your connection and try again. Your changes are still here."

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

function Thumb({ asset }: { asset: LabelEditorAsset }) {
  const [failed, setFailed] = React.useState(false)
  const Icon = asset.mediaType === "video" ? FilmStripIcon : ImageIcon
  return (
    <span className="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-md bg-media-placeholder text-muted-foreground">
      {asset.thumbnailUrl && !failed ? (
        // Signed private URL; not routed through next/image (see MediaTile).
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={asset.thumbnailUrl}
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

function FileProblem({
  id,
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
  status: FileStatus
  problem: string | null
  unavailableCount: number
  pending: boolean
  onAdopt: () => void
  onReapply: () => void
  onRemoveUnavailable: () => void
  onReloadMenu: () => void
}) {
  if (status.kind === "adopted") {
    return (
      <p
        id={id}
        tabIndex={-1}
        className="flex items-start gap-2 rounded-md border border-positive/40 bg-positive-surface px-3 py-2 text-sm outline-none"
      >
        <CheckCircleIcon
          className="mt-0.5 size-4 shrink-0 text-positive"
          aria-hidden
        />
        Using the labels that are saved now. Nothing to save for this file
        unless you change it again.
      </p>
    )
  }
  if (status.kind !== "error" && !problem) return null

  let title = "Labels not saved"
  let body: React.ReactNode = null
  let actions: React.ReactNode = null
  if (problem) {
    title = "Too many labels for this file"
    body = problem
  } else if (status.kind === "error") {
    body = status.message
    if (status.code === "conflict") {
      title = "Someone else changed these labels"
      body = (
        <>
          <p>
            They were changed after you opened this. Choose which labels to
            keep.
          </p>
          {status.current ? (
            <div className="mt-2 rounded-md border bg-background p-2">
              <p className="mb-1 text-xs font-medium text-muted-foreground">
                Saved now
              </p>
              <LabelSummary labels={status.current} />
            </div>
          ) : null}
        </>
      )
      actions = status.current ? (
        <>
          <Button
            type="button"
            variant="outline"
            size="touch"
            onClick={onAdopt}
            disabled={pending}
          >
            Use the saved labels
          </Button>
          <Button
            type="button"
            variant="outline"
            size="touch"
            onClick={onReapply}
            disabled={pending}
          >
            Keep my changes on top
          </Button>
        </>
      ) : null
    } else if (status.code === "unavailable_items") {
      title = "Some menu items are no longer available"
      body = (
        <>
          <p>{status.message}</p>
          <p>Remove the highlighted menu items, then save again.</p>
        </>
      )
      actions =
        unavailableCount > 0 ? (
          <Button
            type="button"
            variant="outline"
            size="touch"
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
      actions = (
        <Button
          type="button"
          variant="outline"
          size="touch"
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
    <div
      id={id}
      tabIndex={-1}
      className="grid gap-2 rounded-md border border-negative/50 bg-negative-surface px-3 py-2 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      <p className="flex items-start gap-2 font-medium">
        <WarningCircleIcon
          className="mt-0.5 size-4 shrink-0 text-negative"
          aria-hidden
        />
        {title}
      </p>
      <div className="grid gap-1">{body}</div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  )
}

function LabelEditor({
  onOpenChange,
  assets,
  catalogue,
  onRetryCatalogue,
  onSave,
  onSaved,
  title,
  cancelLabel,
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
  const [networkError, setNetworkError] = React.useState<string | null>(null)
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
  const index = React.useMemo(() => buildCatalogueIndex(ready), [ready])

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
    setNetworkError(null)

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

    setPending(true)
    setAnnouncement("Saving labels…")
    let results: SaveLabelsResult[]
    try {
      results = await onSave(inputs)
      if (!Array.isArray(results)) throw new Error("No results")
    } catch {
      setPending(false)
      setNetworkError(NETWORK_ERROR)
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

  const allNew = assets.every(
    (a) => !a.labels.hasLabels && a.labels.revision === 0
  )
  const heading =
    title ??
    (batch
      ? "Label these files"
      : assets[0].labels.hasLabels
        ? "Edit labels"
        : "Add labels")
  const dismissText = cancelLabel ?? (allNew ? "Skip for now" : "Cancel")

  function fileFields(asset: LabelEditorAsset, scope: "single" | "file") {
    const f = files[asset.id]
    const eff = effective[asset.id]
    return (
      <LabelFields
        scope={scope}
        fileName={asset.originalFilename}
        venueName={venueName}
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
      />
    )
  }

  function problemBlock(asset: LabelEditorAsset) {
    const f = files[asset.id]
    const eff = effective[asset.id]
    return (
      <FileProblem
        id={ids.problem(asset.id)}
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

  const saveText = pending
    ? "Saving…"
    : batch && dirtyIds.length > 0
      ? `Save labels for ${dirtyIds.length} ${dirtyIds.length === 1 ? "file" : "files"}`
      : "Save labels"

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) requestClose()
      }}
    >
      <DialogContent className="max-h-[calc(100svh-1rem)] gap-0 overflow-y-auto p-0 sm:max-w-lg">
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
          <div className="grid min-w-0 gap-5 p-4">
            <DialogHeader className="pr-10">
              <DialogTitle>{heading}</DialogTitle>
              <DialogDescription>
                Optional. Labels help find {batch ? "these files" : "this file"}{" "}
                later. Menu items come from the menu of {venueName}.
              </DialogDescription>
            </DialogHeader>

            {!batch ? (
              <div className="flex min-w-0 items-center gap-3">
                <Thumb asset={assets[0]} />
                <p className="min-w-0 truncate text-sm font-medium">
                  {assets[0].originalFilename}
                </p>
              </div>
            ) : null}

            {catalogue.state === "error" ? (
              <Alert variant="destructive">
                <AlertTitle>The menu could not be loaded</AlertTitle>
                <AlertDescription>
                  <p>{catalogue.message}</p>
                  <p>Your choices so far are kept.</p>
                </AlertDescription>
                <Button
                  type="button"
                  variant="outline"
                  size="touch"
                  className="mt-2 w-fit"
                  onClick={onRetryCatalogue}
                >
                  <ArrowClockwiseIcon data-icon="inline-start" aria-hidden />
                  Retry loading the menu
                </Button>
              </Alert>
            ) : null}

            {networkError ? (
              <Alert
                variant="destructive"
                id={ids.network}
                tabIndex={-1}
                className="outline-none"
              >
                <WarningCircleIcon aria-hidden />
                <AlertDescription>{networkError}</AlertDescription>
              </Alert>
            ) : null}

            {batch ? (
              <>
                <section
                  aria-labelledby={`${uid}-common`}
                  className="grid gap-4 rounded-lg border p-3"
                >
                  <div className="grid gap-1">
                    <h3 id={`${uid}-common`} className="font-medium">
                      Common to all {assets.length} files
                    </h3>
                    <p className="text-sm text-muted-foreground">
                      {BATCH_MERGE_RULE}
                    </p>
                  </div>
                  <LabelFields
                    scope="common"
                    venueName={venueName}
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
                  />
                </section>

                <section
                  aria-labelledby={`${uid}-files`}
                  className="grid gap-2"
                >
                  <div className="grid gap-1">
                    <h3 id={`${uid}-files`} className="font-medium">
                      Each file
                    </h3>
                    <p className="text-sm text-muted-foreground">
                      Open a file to add or remove labels for that file only.
                    </p>
                  </div>
                  <ul aria-label="Files" className="divide-y rounded-lg border">
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
                            <Thumb asset={asset} />
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-sm font-medium">
                                {asset.originalFilename}
                              </p>
                              <p
                                className={cn(
                                  "text-xs text-muted-foreground",
                                  hasProblem && "text-negative",
                                  f.status.kind === "saved" &&
                                    !dirty &&
                                    "text-positive"
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
                              variant="outline"
                              size="touch"
                              aria-expanded={isOpen}
                              aria-controls={ids.panel(asset.id)}
                              aria-label={`Adjust labels for ${asset.originalFilename}`}
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
                            className="grid gap-4 border-t pt-3"
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
                {problemBlock(assets[0])}
                {fileFields(assets[0], "single")}
              </>
            )}

            <p
              id={ids.status}
              role="status"
              aria-live="polite"
              className="text-sm font-medium empty:hidden"
            >
              {announcement}
            </p>
          </div>

          <DialogFooter className="sticky bottom-0 mx-0 mb-0 bg-popover">
            <Button
              type="button"
              variant="outline"
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
              {saveText}
            </Button>
          </DialogFooter>
        </form>

        <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Discard label changes?</AlertDialogTitle>
              <AlertDialogDescription>
                {dirtyIds.length > 1
                  ? `Labels for ${dirtyIds.length} files have not been saved.`
                  : "Your label changes have not been saved."}{" "}
                The files themselves stay uploaded either way.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel size="touch">Keep editing</AlertDialogCancel>
              <Button
                type="button"
                variant="destructive"
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
