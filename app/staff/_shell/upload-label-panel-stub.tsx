"use client"

// TODO(integration): DELETE THIS FILE. Stand-in for S2's UploadLabelPanel and
// FixLabelsDialog (contract C3) until they exist; add-host.tsx then imports
// both from "@/components/nabalens/labels". Only the props are the contract:
// this is a deliberately small, plain UI so the upload flow can be built and
// tested on its own branch.

import * as React from "react"

import type { CatalogueProp, LabelPreset } from "@/components/nabalens/labels"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import type { WorkFocus } from "@/lib/config/work-roles"
import type {
  LabelCatalogue,
  LabelEditorAsset,
  LabelItemRef,
  SaveLabelsErrorCode,
  SaveLabelsInput,
  SaveLabelsResult,
} from "@/lib/menus/types"

export type UploadLabelPanelProps = {
  catalogue: CatalogueProp
  onRetryCatalogue: () => void
  focus?: WorkFocus | null
  files: ReadonlyArray<{
    id: string
    name: string
    kind: "image" | "video"
    previewUrl?: string | null
  }>
  preset?: LabelPreset | null
  presetAssetIds?: readonly string[]
  initial?: readonly SaveLabelsInput[]
  disabledIds?: readonly string[]
  onChange: (inputs: SaveLabelsInput[]) => void
  onPendingChange?: (pending: boolean) => void
}

export type FixLabelsDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  asset: LabelEditorAsset
  draft: SaveLabelsInput
  problem?: { code: SaveLabelsErrorCode; message: string } | null
  catalogue: CatalogueProp
  onRetryCatalogue: () => void
  focus?: WorkFocus | null
  onSave: (input: SaveLabelsInput) => Promise<SaveLabelsResult>
}

type Entry = {
  itemId: string
  name: string
  variants: { id: string; name: string }[]
}

function entries(catalogue: LabelCatalogue | null): Entry[] {
  if (!catalogue || catalogue.status !== "active") return []
  return catalogue.sections.flatMap((s) =>
    s.items.map((i) => ({
      itemId: i.itemId,
      name: i.name,
      variants: i.variants.map((v) => ({ id: v.variantId, name: v.name })),
    }))
  )
}

const keyOf = (ref: LabelItemRef) => `${ref.itemId}:${ref.variantId ?? ""}`

function nameOf(list: Entry[], ref: LabelItemRef) {
  const entry = list.find((e) => e.itemId === ref.itemId)
  if (!entry) return null
  const variant = entry.variants.find((v) => v.id === ref.variantId)
  return variant ? `${entry.name} (${variant.name})` : entry.name
}

function input(
  assetId: string,
  versionId: string | null,
  items: LabelItemRef[]
): SaveLabelsInput {
  return {
    assetId,
    expectedRevision: 0,
    catalogueVersionId: versionId,
    contentTypes: [],
    note: null,
    items,
    missingItem: null,
  }
}

/** Picks one menu item; a dish with variants offers "Not specified" first. */
function ItemPicker({
  list,
  label,
  onPick,
}: {
  list: Entry[]
  label: string
  onPick: (ref: LabelItemRef) => void
}) {
  const [itemId, setItemId] = React.useState("")
  const entry = list.find((e) => e.itemId === itemId)
  const [variantId, setVariantId] = React.useState("")
  return (
    <div className="flex flex-wrap items-end gap-2">
      <label className="grid gap-1 text-body">
        {label}
        <select
          className="min-h-11 rounded-control border border-line-control px-2"
          value={itemId}
          onChange={(e) => {
            setItemId(e.currentTarget.value)
            setVariantId("")
          }}
        >
          <option value="">Choose a dish</option>
          {list.map((e) => (
            <option key={e.itemId} value={e.itemId}>
              {e.name}
            </option>
          ))}
        </select>
      </label>
      {entry && entry.variants.length > 0 ? (
        <label className="grid gap-1 text-body">
          {`Which ${entry.name}?`}
          <select
            className="min-h-11 rounded-control border border-line-control px-2"
            value={variantId}
            onChange={(e) => setVariantId(e.currentTarget.value)}
          >
            <option value="">Not specified</option>
            {entry.variants.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <Button
        variant="secondary"
        size="sm"
        disabled={!entry}
        onClick={() => {
          if (!entry) return
          onPick({ itemId: entry.itemId, variantId: variantId || null })
          setItemId("")
          setVariantId("")
        }}
      >
        Add
      </Button>
    </div>
  )
}

function Chips({
  refs,
  list,
  onRemove,
}: {
  refs: LabelItemRef[]
  list: Entry[]
  onRemove: (ref: LabelItemRef) => void
}) {
  return (
    <ul className="flex flex-wrap gap-2">
      {refs.map((ref) => {
        const name = nameOf(list, ref)
        return (
          <li
            key={keyOf(ref)}
            className="flex items-center gap-1 rounded-round bg-surface-2 ps-3 text-body"
          >
            {name ?? "No longer on the menu"}
            <Button
              variant="ghost"
              size="sm"
              aria-label={`Remove ${name ?? "item no longer on the menu"}`}
              onClick={() => onRemove(ref)}
            >
              ×
            </Button>
          </li>
        )
      })}
    </ul>
  )
}

const union = (a: LabelItemRef[], b: LabelItemRef[]) => {
  const seen = new Set(a.map(keyOf))
  return [...a, ...b.filter((r) => !seen.has(keyOf(r)))]
}

export function UploadLabelPanel({
  catalogue,
  onRetryCatalogue,
  files,
  preset,
  presetAssetIds,
  initial,
  disabledIds,
  onChange,
  onPendingChange,
}: UploadLabelPanelProps) {
  const ready = catalogue.state === "ready" ? catalogue.catalogue : null
  const list = entries(ready)
  const versionId = ready?.status === "active" ? ready.versionId : null
  // Each file's own items (from `initial`, else the preset); common items on
  // top; per-file removals ("Adjust").
  const [base] = React.useState(() => {
    const out: Record<string, LabelItemRef[]> = {}
    for (const file of files) {
      const own = initial?.find((i) => i.assetId === file.id)
      if (own) out[file.id] = own.items
      else if (preset && (presetAssetIds ?? []).includes(file.id))
        out[file.id] = [{ itemId: preset.itemId, variantId: preset.variantId }]
    }
    return out
  })
  const [common, setCommon] = React.useState<LabelItemRef[]>([])
  const [removed, setRemoved] = React.useState<Record<string, string[]>>({})
  const [adjusting, setAdjusting] = React.useState<string | null>(null)

  const effective = (id: string) =>
    union(base[id] ?? [], common).filter(
      (r) => !(removed[id] ?? []).includes(keyOf(r))
    )

  const fileIds = files.map((f) => f.id).join("|")
  const onChangeRef = React.useRef(onChange)
  React.useEffect(() => {
    onChangeRef.current = onChange
  })
  React.useEffect(() => {
    if (!ready) return
    onChangeRef.current(
      files.map((f) => input(f.id, versionId, effective(f.id)))
    )
    // effective() reads the state listed here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, versionId, fileIds, common, removed])
  React.useEffect(() => onPendingChange?.(false), [onPendingChange])

  // Items every file has: one chip for all of them.
  const shared =
    files.length > 0
      ? effective(files[0].id).filter((r) =>
          files.every((f) => effective(f.id).some((e) => keyOf(e) === keyOf(r)))
        )
      : []
  return (
    <section aria-label="Labels" className="grid gap-2">
      <h3 className="text-label text-ink">
        What&apos;s in these photos?{" "}
        <span className="text-ink-muted">(optional)</span>
      </h3>
      {catalogue.state === "loading" ? (
        <p role="status">Loading menu…</p>
      ) : catalogue.state === "error" ? (
        <div className="flex items-center gap-2">
          <p>{catalogue.message}</p>
          <Button variant="secondary" size="sm" onClick={onRetryCatalogue}>
            Try again
          </Button>
        </div>
      ) : (
        <>
          <Chips
            refs={shared}
            list={list}
            onRemove={(ref) => {
              setCommon((c) => c.filter((r) => keyOf(r) !== keyOf(ref)))
              setRemoved((current) => {
                const next = { ...current }
                for (const f of files)
                  next[f.id] = [...(next[f.id] ?? []), keyOf(ref)]
                return next
              })
            }}
          />
          <ItemPicker
            list={list}
            label="Dish"
            onPick={(ref) => {
              setCommon((c) => union(c, [ref]))
              setRemoved((current) => {
                const next: Record<string, string[]> = {}
                for (const [id, keys] of Object.entries(current))
                  next[id] = keys.filter((k) => k !== keyOf(ref))
                return next
              })
            }}
          />
          {files.length > 1 ? (
            <ul className="grid gap-1">
              {files.map((f) => (
                <li key={f.id} className="grid gap-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-body">{f.name}</span>
                    {(disabledIds ?? []).includes(f.id) ? null : (
                      <Button
                        variant="link"
                        size="sm"
                        aria-label={`Adjust ${f.name}`}
                        onClick={() =>
                          setAdjusting((a) => (a === f.id ? null : f.id))
                        }
                      >
                        Adjust
                      </Button>
                    )}
                  </div>
                  {adjusting === f.id ? (
                    <Chips
                      refs={effective(f.id)}
                      list={list}
                      onRemove={(ref) =>
                        setRemoved((current) => ({
                          ...current,
                          [f.id]: [...(current[f.id] ?? []), keyOf(ref)],
                        }))
                      }
                    />
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
        </>
      )}
    </section>
  )
}

export function FixLabelsDialog({
  open,
  onOpenChange,
  draft,
  problem,
  catalogue,
  onRetryCatalogue,
  onSave,
}: FixLabelsDialogProps) {
  const ready = catalogue.state === "ready" ? catalogue.catalogue : null
  const list = entries(ready)
  const [items, setItems] = React.useState(draft.items)
  const [error, setError] = React.useState<string | null>(null)
  const [saving, setSaving] = React.useState(false)
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Fix labels</DialogTitle>
        </DialogHeader>
        {problem ? <p>{problem.message}</p> : null}
        {catalogue.state === "loading" ? (
          <p role="status">Loading menu…</p>
        ) : catalogue.state === "error" ? (
          <Button variant="secondary" size="sm" onClick={onRetryCatalogue}>
            Try again
          </Button>
        ) : (
          <>
            <Chips
              refs={items}
              list={list}
              onRemove={(ref) =>
                setItems((c) => c.filter((r) => keyOf(r) !== keyOf(ref)))
              }
            />
            <ItemPicker
              list={list}
              label="Dish"
              onPick={(ref) => setItems((c) => union(c, [ref]))}
            />
          </>
        )}
        {error ? <p role="alert">{error}</p> : null}
        <DialogFooter>
          <Button
            variant="secondary"
            size="touch"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            size="touch"
            disabled={!ready || saving}
            onClick={async () => {
              setSaving(true)
              const result = await onSave({
                ...draft,
                catalogueVersionId:
                  ready?.status === "active" ? ready.versionId : null,
                items: items.filter((r) => nameOf(list, r) !== null),
              })
              setSaving(false)
              if (result.ok) onOpenChange(false)
              else setError(result.message)
            }}
          >
            Save labels
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
