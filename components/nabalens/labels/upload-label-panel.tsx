"use client"

import * as React from "react"
import {
  ArrowClockwiseIcon,
  CaretDownIcon,
  FilmStripIcon,
  ImageIcon,
} from "@phosphor-icons/react"

import { Notice } from "@/components/nabalens/notice"
import { Button } from "@/components/ui/button"
import type { WorkFocus } from "@/lib/config/work-roles"
import {
  EMPTY_LABEL_SUMMARY,
  LABEL_LIMITS,
  type ContentType,
  type SaveLabelsInput,
} from "@/lib/menus/types"
import { cn } from "@/lib/utils"

import { buildCatalogueIndex } from "./catalogue-search"
import {
  EMPTY_COMMON,
  NO_ADJUST,
  addItem,
  adjustFromInput,
  buildSaveInput,
  draftItemsFromRefs,
  effectiveLabels,
  isPickable,
  isUnspecifiedVariant,
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
} from "./label-draft"
import { FIELD_HINT } from "./field-styles"
import { itemDisplayName, LabelFields } from "./label-fields"
import type { CatalogueProp, LabelPreset } from "./types"

/** The common field's visible label (C5). */
export const UPLOAD_ITEMS_LABEL = "What's in these photos?"

export type UploadLabelFile = {
  id: string
  name: string
  kind: "image" | "video"
  previewUrl?: string | null
}

export type UploadLabelPanelProps = {
  catalogue: CatalogueProp
  onRetryCatalogue: () => void
  focus?: WorkFocus | null
  /** The files in the upload sheet, in order (1..LABEL_LIMITS.maxBatchAssets). */
  files: ReadonlyArray<UploadLabelFile>
  /** Applied as a removable chip on the preset files (Our menu's dish, a task's dish). */
  preset?: LabelPreset | null
  /** The files the preset belongs to. Omitted: every file. */
  presetAssetIds?: readonly string[]
  /** Inputs emitted earlier (e.g. the sheet was reopened): restored per file. */
  initial?: readonly SaveLabelsInput[]
  /** Files that can no longer be labelled (failed). They emit empty labels. */
  disabledIds?: readonly string[]
  /**
   * Every change: one input per file in `files`, assetId = the file's id,
   * expectedRevision 0, catalogueVersionId = the shown catalogue version.
   */
  onChange: (inputs: SaveLabelsInput[]) => void
  /**
   * True while the labels are not ready to store: a menu choice is unfinished,
   * a file has too many labels, or the menu is still loading while a preset or
   * restored labels wait for it.
   */
  onPendingChange?: (pending: boolean) => void
}

function emptyInput(assetId: string, catalogueVersionId: string | null) {
  return buildSaveInput(
    assetId,
    EMPTY_LABEL_SUMMARY,
    effectiveLabels(EMPTY_LABEL_SUMMARY, EMPTY_COMMON, NO_ADJUST),
    catalogueVersionId
  )
}

function Thumb({ file }: { file: UploadLabelFile }) {
  const [failed, setFailed] = React.useState(false)
  const Icon = file.kind === "video" ? FilmStripIcon : ImageIcon
  return (
    <span className="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-control bg-surface-2 text-ink-muted">
      {file.previewUrl && !failed ? (
        // Local object URL or signed URL; not routed through next/image.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={file.previewUrl}
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

/**
 * Optional labels inside the upload sheet (no dialog, no Save button): one
 * common "What's in these photos?" field for every file, "More details" for
 * content types and a note, and "Adjust" per file for exceptions. The preset
 * is already applied as a removable chip. Every change is reported through
 * `onChange`; the host stores the inputs and saves each when its file is
 * ready. Staff never see original file names: files are "Photo 1", "Video 2".
 */
export function UploadLabelPanel({
  catalogue,
  onRetryCatalogue,
  focus = null,
  files,
  preset = null,
  presetAssetIds,
  initial,
  disabledIds = [],
  onChange,
  onPendingChange,
}: UploadLabelPanelProps) {
  const uid = React.useId()
  const [common, setCommon] = React.useState<CommonDraft>(EMPTY_COMMON)
  const [adjs, setAdjs] = React.useState<Record<string, FileAdjust>>({})
  const [expanded, setExpanded] = React.useState<string[]>([])
  const [detailsOpen, setDetailsOpen] = React.useState(false)
  const [pendingScopes, setPendingScopes] = React.useState<
    Record<string, boolean>
  >({})
  // Files whose restored labels and preset have been applied (needs the menu).
  const [seeded, setSeeded] = React.useState<ReadonlySet<string>>(new Set())
  const [presetRemoved, setPresetRemoved] = React.useState(false)
  const [presetItem, setPresetItem] = React.useState<DraftItem | null>(null)
  const [presetMissing, setPresetMissing] = React.useState(false)

  const ready = catalogue.state === "ready" ? catalogue.catalogue : null
  const catalogueVersionId = ready?.status === "active" ? ready.versionId : null
  const index = React.useMemo(
    () => buildCatalogueIndex(ready, focus),
    [ready, focus]
  )
  const venueName = ready?.venueName ?? "this venue"
  const disabled = new Set(disabledIds)
  const isPresetTarget = (id: string) =>
    !!preset && (!presetAssetIds || presetAssetIds.includes(id))
  const initialFor = (id: string) => initial?.find((i) => i.assetId === id)

  // Restored labels and the preset go in once the menu is loaded (they are
  // named from it): restored labels as they were, else the preset on its
  // files unless the person already removed it.
  const unseeded = files.filter((f) => !seeded.has(f.id))
  if (ready && unseeded.length > 0) {
    const draft = presetDraft(ready, preset)
    if (preset && !draft && !presetMissing) setPresetMissing(true)
    if (draft && !presetItem) setPresetItem(draft)
    const next = { ...adjs }
    for (const f of unseeded) {
      const restored = initialFor(f.id)
      if (restored) {
        next[f.id] = adjustFromInput(
          EMPTY_LABEL_SUMMARY,
          restored,
          draftItemsFromRefs(ready, restored.items)
        )
      } else if (draft && !presetRemoved && isPresetTarget(f.id)) {
        next[f.id] = addItem(next[f.id] ?? NO_ADJUST, draft)
      }
    }
    setAdjs(next)
    setSeeded(new Set([...seeded, ...unseeded.map((f) => f.id)]))
  }

  const effective: Record<string, EffectiveLabels> = {}
  for (const f of files)
    effective[f.id] = effectiveLabels(
      EMPTY_LABEL_SUMMARY,
      common,
      adjs[f.id] ?? NO_ADJUST
    )

  const inputs = files.map((f) => {
    if (disabled.has(f.id)) return emptyInput(f.id, catalogueVersionId)
    const restored = initialFor(f.id)
    // Not named yet (menu loading): keep what was stored, unchanged.
    if (!seeded.has(f.id) && restored) return restored
    return buildSaveInput(
      f.id,
      EMPTY_LABEL_SUMMARY,
      effective[f.id],
      catalogueVersionId
    )
  })
  const waitingForMenu =
    !ready &&
    files.some(
      (f) =>
        !disabled.has(f.id) &&
        ((initialFor(f.id)?.items.length ?? 0) > 0 ||
          (isPresetTarget(f.id) && !presetRemoved))
    )
  const problems = Object.fromEntries(
    files
      .filter((f) => !disabled.has(f.id))
      .map((f) => [f.id, limitProblem(effective[f.id])])
      .filter(([, p]) => p)
  ) as Record<string, string>
  const pending =
    waitingForMenu ||
    Object.values(pendingScopes).some(Boolean) ||
    Object.keys(problems).length > 0

  const inputsKey = JSON.stringify(inputs)
  const latest = React.useRef({ onChange, onPendingChange, inputs })
  React.useEffect(() => {
    latest.current = { onChange, onPendingChange, inputs }
  })
  React.useEffect(() => {
    latest.current.onChange(latest.current.inputs)
  }, [inputsKey])
  React.useEffect(() => {
    latest.current.onPendingChange?.(pending)
  }, [pending])

  function pendingFor(scope: string) {
    return (value: boolean) =>
      setPendingScopes((prev) =>
        !!prev[scope] === value ? prev : { ...prev, [scope]: value }
      )
  }

  // -------------------------------------------------------------------------
  // Edits
  // -------------------------------------------------------------------------

  function adjust(id: string, fn: (adj: FileAdjust) => FileAdjust) {
    setAdjs((prev) => ({ ...prev, [id]: fn(prev[id] ?? NO_ADJUST) }))
  }

  const presetKey = presetItem ? itemKey(presetItem) : null
  const presetTargets = files.filter(
    (f) => isPresetTarget(f.id) && !disabled.has(f.id)
  )
  const presetShown =
    presetKey !== null &&
    !common.items.some((i) => itemKey(i) === presetKey) &&
    presetTargets.some((f) =>
      effective[f.id].items.some((i) => i.key === presetKey)
    )

  /** The preset chip comes off every preset file, and later ones too. */
  function removePreset() {
    if (!presetKey) return
    setPresetRemoved(true)
    setAdjs((prev) => {
      const next = { ...prev }
      for (const f of presetTargets)
        next[f.id] = removeItem(next[f.id] ?? NO_ADJUST, presetKey, false)
      return next
    })
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

  function toggleFileType(id: string, type: ContentType) {
    const on = !effective[id].contentTypes.includes(type)
    if (on && effective[id].contentTypes.length >= LABEL_LIMITS.maxContentTypes)
      return
    adjust(id, (adj) => setContentType(adj, type, on))
  }

  function unavailableKeysFor(items: EffectiveItem[]) {
    return new Set(
      items.filter((i) => ready && !isPickable(ready, i)).map((i) => i.key)
    )
  }

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  const one = files.length === 1
  const fileLabel = (f: UploadLabelFile) => {
    const n = files.indexOf(f) + 1
    return `${f.kind === "video" ? "Video" : "Photo"} ${n}`
  }
  const fileRef = (f: UploadLabelFile) => fileLabel(f).toLowerCase()

  const commonItems: EffectiveItem[] = [
    ...common.items.map((i) => ({
      ...i,
      key: itemKey(i),
      saved: false,
      fromCommon: true,
    })),
    ...(presetShown && presetItem
      ? [{ ...presetItem, key: presetKey!, saved: false, fromCommon: false }]
      : []),
  ]

  function summaryText(f: UploadLabelFile) {
    if (disabled.has(f.id)) return "Not saved (photo not saved)"
    const eff = effective[f.id]
    const parts = []
    if (eff.items.length)
      parts.push(
        eff.items
          .map((i) => itemDisplayName(i, isUnspecifiedVariant(ready, i)))
          .join(", ")
      )
    if (eff.contentTypes.length)
      parts.push(
        `${eff.contentTypes.length} content ${eff.contentTypes.length === 1 ? "type" : "types"}`
      )
    if (eff.note.trim()) parts.push("note")
    if (eff.missingItem.trim())
      parts.push(`suggested: ${eff.missingItem.trim()}`)
    return parts.length ? parts.join(" · ") : "No labels"
  }

  return (
    <section
      aria-labelledby={`${uid}-heading`}
      className="grid min-w-0 gap-4"
      data-pending={pending || undefined}
    >
      <h3 id={`${uid}-heading`} className="sr-only">
        Labels
      </h3>

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
          <p>Your photos keep saving. Labels you choose so far are kept.</p>
        </Notice>
      ) : null}

      {presetMissing && preset ? (
        <Notice tone="plain" role="none">
          {`${itemDisplayName({ name: preset.itemName, variantName: preset.variantName })} isn't on the current menu, so it wasn't added.`}
        </Notice>
      ) : null}

      <LabelFields
        scope={one ? "single" : "common"}
        part="items"
        audience="staff"
        mediaNoun="photo"
        venueName={venueName}
        catalogue={catalogue}
        index={index}
        itemLabel={UPLOAD_ITEMS_LABEL}
        items={commonItems}
        unavailableKeys={unavailableKeysFor(commonItems)}
        onAddItem={(item) => {
          const key = itemKey(item)
          setCommon((c) => ({
            ...c,
            items: [...c.items.filter((i) => itemKey(i) !== key), item],
          }))
        }}
        onRemoveItem={(item) => {
          if (item.key === presetKey) removePreset()
          setCommon((c) => ({
            ...c,
            items: c.items.filter((i) => itemKey(i) !== item.key),
          }))
        }}
        onReplaceItem={(fromKey, item) =>
          setCommon((c) => ({
            ...c,
            items: [
              ...c.items.filter(
                (i) => itemKey(i) !== fromKey && itemKey(i) !== itemKey(item)
              ),
              item,
            ],
          }))
        }
        contentTypes={common.contentTypes}
        onToggleType={toggleCommonType}
        note={common.note}
        onNoteChange={(note) => setCommon((c) => ({ ...c, note }))}
        focusTypes={focus?.contentTypes}
        onPendingChange={pendingFor("common")}
      />

      <div className="grid gap-3">
        <Button
          type="button"
          variant="link"
          className="w-fit text-label"
          aria-expanded={detailsOpen}
          aria-controls={`${uid}-details`}
          onClick={() => setDetailsOpen((o) => !o)}
        >
          {one ? "More details" : "More details for all photos"}
          <CaretDownIcon
            data-icon="inline-end"
            aria-hidden
            className={cn(
              "transition-transform motion-reduce:transition-none",
              detailsOpen && "rotate-180"
            )}
          />
        </Button>
        <div id={`${uid}-details`} hidden={!detailsOpen}>
          {detailsOpen ? (
            <LabelFields
              scope={one ? "single" : "common"}
              part="details"
              audience="staff"
              mediaNoun="photo"
              venueName={venueName}
              catalogue={catalogue}
              index={index}
              items={[]}
              unavailableKeys={new Set()}
              onAddItem={() => {}}
              onRemoveItem={() => {}}
              onReplaceItem={() => {}}
              contentTypes={common.contentTypes}
              onToggleType={toggleCommonType}
              note={common.note}
              onNoteChange={(note) => setCommon((c) => ({ ...c, note }))}
              focusTypes={focus?.contentTypes}
            />
          ) : null}
        </div>
      </div>

      <div className="grid gap-2">
        {!one ? (
          <p className={FIELD_HINT}>
            These go on every photo. Use Adjust to change one photo only.
          </p>
        ) : null}
        <ul
          aria-label={one ? "Your photo" : "Your photos"}
          className="divide-y divide-line overflow-hidden rounded-card shadow-[inset_0_0_0_1px_var(--line)]"
        >
          {files.map((f) => {
            const isOpen = expanded.includes(f.id) && !disabled.has(f.id)
            const problem = problems[f.id] ?? null
            const off = disabled.has(f.id)
            // Restored labels are named from the menu, so wait for it.
            const locked = off || (!seeded.has(f.id) && !!initialFor(f.id))
            const eff = effective[f.id]
            return (
              <li key={f.id} className="grid min-w-0 gap-3 p-3">
                <div className="flex min-w-0 items-center gap-3">
                  <Thumb file={f} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-label text-ink">
                      {fileLabel(f)}
                    </p>
                    <p
                      id={`${uid}-summary-${f.id}`}
                      className={cn(
                        "text-meta break-words text-ink-muted",
                        (problem || off) && "font-bold text-warn-fg"
                      )}
                    >
                      {summaryText(f)}
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    className="shrink-0"
                    aria-expanded={isOpen}
                    aria-controls={`${uid}-panel-${f.id}`}
                    aria-label={`Adjust labels for ${fileRef(f)}`}
                    aria-describedby={`${uid}-summary-${f.id}`}
                    disabled={locked}
                    onClick={() =>
                      setExpanded((prev) =>
                        isOpen
                          ? prev.filter((id) => id !== f.id)
                          : [...prev, f.id]
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
                {problem ? (
                  <Notice
                    tone="negative"
                    title="Too many labels for this photo"
                  >
                    {problem}
                  </Notice>
                ) : null}
                <div
                  id={`${uid}-panel-${f.id}`}
                  hidden={!isOpen}
                  className="grid min-w-0 gap-4 border-t border-line pt-3"
                >
                  {isOpen ? (
                    <LabelFields
                      scope="file"
                      audience="staff"
                      fileName={fileRef(f)}
                      mediaNoun={f.kind === "video" ? "video" : "photo"}
                      venueName={venueName}
                      catalogue={catalogue}
                      index={index}
                      items={eff.items}
                      unavailableKeys={unavailableKeysFor(eff.items)}
                      removedCommon={eff.removedCommon}
                      onAddItem={(item) =>
                        adjust(f.id, (adj) => addItem(adj, item))
                      }
                      onRemoveItem={(item) =>
                        adjust(f.id, (adj) =>
                          removeItem(adj, item.key, item.fromCommon)
                        )
                      }
                      onReplaceItem={(fromKey, item) =>
                        adjust(f.id, (adj) =>
                          addItem(
                            removeItem(
                              adj,
                              fromKey,
                              common.items.some((i) => itemKey(i) === fromKey)
                            ),
                            item
                          )
                        )
                      }
                      onRestoreItem={(item) =>
                        adjust(f.id, (adj) => addItem(adj, item))
                      }
                      contentTypes={eff.contentTypes}
                      onToggleType={(type) => toggleFileType(f.id, type)}
                      note={eff.note}
                      noteSource={eff.noteSource}
                      onNoteChange={(note) =>
                        adjust(f.id, (adj) => ({ ...adj, note }))
                      }
                      onUseCommonNote={() =>
                        adjust(f.id, (adj) => ({ ...adj, note: undefined }))
                      }
                      missingItem={{
                        value: eff.missingItem,
                        saved: null,
                        onChange: (missingItem) =>
                          adjust(f.id, (adj) => ({ ...adj, missingItem })),
                      }}
                      focusTypes={focus?.contentTypes}
                      onPendingChange={pendingFor(f.id)}
                    />
                  ) : null}
                </div>
              </li>
            )
          })}
        </ul>
      </div>
    </section>
  )
}
