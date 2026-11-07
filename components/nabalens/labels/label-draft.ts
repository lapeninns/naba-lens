// Pure label-editor model: how the common selection, each file's saved labels
// and each file's own adjustments combine into the labels that get saved.
//
// Merge rule (shown in the UI): for every file,
//   items         = saved items ∪ common items ∪ file additions − file removals
//   content types = saved ∪ common ∪ file additions − file removals
//   note          = the file's own note, else the common note (when not
//                   empty), else the saved note
//   missing item  = the file's own text, else the saved suggestion
// A single-file editor is the same model with an empty common selection.

import {
  CONTENT_TYPES,
  LABEL_LIMITS,
  type ContentType,
  type LabelCatalogue,
  type LabelItemRef,
  type MediaLabelItemView,
  type MediaLabelSummary,
  type SaveLabelsErrorCode,
  type SaveLabelsInput,
} from "@/lib/menus/types"

/** A selected menu item, in the same shape the server returns. */
export type DraftItem = MediaLabelItemView

export function itemKey(ref: LabelItemRef): string {
  return `${ref.itemId}:${ref.variantId ?? ""}`
}

export type CommonDraft = {
  items: DraftItem[]
  contentTypes: ContentType[]
  note: string
}

export const EMPTY_COMMON: CommonDraft = {
  items: [],
  contentTypes: [],
  note: "",
}

/** One file's changes relative to its saved labels plus the common selection. */
export type FileAdjust = {
  add: DraftItem[]
  /** Keys of saved or common items left off this file. */
  remove: string[]
  addTypes: ContentType[]
  removeTypes: ContentType[]
  /** undefined = not written for this file. */
  note?: string
  /** undefined = untouched (keeps the saved suggestion). */
  missingItem?: string
}

export const NO_ADJUST: FileAdjust = {
  add: [],
  remove: [],
  addTypes: [],
  removeTypes: [],
}

export type EffectiveItem = DraftItem & {
  key: string
  /** Already saved on this file. */
  saved: boolean
  /** Comes from the common selection (batch only). */
  fromCommon: boolean
}

export type EffectiveLabels = {
  items: EffectiveItem[]
  contentTypes: ContentType[]
  note: string
  noteSource: "file" | "common" | "saved"
  missingItem: string
  /** Common items this file leaves off (so the UI can offer "Add back"). */
  removedCommon: DraftItem[]
}

function uniqueTypes(types: Iterable<ContentType>): ContentType[] {
  const set = new Set(types)
  return CONTENT_TYPES.filter((t) => set.has(t))
}

export function effectiveLabels(
  base: MediaLabelSummary,
  common: CommonDraft,
  adj: FileAdjust
): EffectiveLabels {
  const removed = new Set(adj.remove)
  const seen = new Set<string>()
  const items: EffectiveItem[] = []
  const commonKeys = new Set(common.items.map(itemKey))
  const savedKeys = new Set(base.items.map(itemKey))
  for (const item of [...base.items, ...common.items, ...adj.add]) {
    const key = itemKey(item)
    if (seen.has(key) || removed.has(key)) continue
    seen.add(key)
    items.push({
      ...item,
      key,
      saved: savedKeys.has(key),
      fromCommon: commonKeys.has(key),
    })
  }
  const removeTypes = new Set(adj.removeTypes)
  const contentTypes = uniqueTypes(
    [...base.contentTypes, ...common.contentTypes, ...adj.addTypes].filter(
      (t) => !removeTypes.has(t)
    )
  )
  let note: string
  let noteSource: EffectiveLabels["noteSource"]
  if (adj.note !== undefined) {
    note = adj.note
    noteSource = "file"
  } else if (common.note.trim()) {
    note = common.note
    noteSource = "common"
  } else {
    note = base.note ?? ""
    noteSource = "saved"
  }
  return {
    items,
    contentTypes,
    note,
    noteSource,
    missingItem: adj.missingItem ?? base.missingItem ?? "",
    removedCommon: common.items.filter(
      (i) => removed.has(itemKey(i)) && !savedKeys.has(itemKey(i))
    ),
  }
}

/** SaveLabelsInput.missingItem: null = unchanged, "" = withdraw, text = suggest. */
export function missingItemChange(
  base: MediaLabelSummary,
  text: string
): string | null {
  const next = text.trim()
  if (next === (base.missingItem ?? "").trim()) return null
  return next
}

function sameSet<T>(a: readonly T[], b: readonly T[]) {
  if (a.length !== b.length) return false
  const set = new Set(a)
  return b.every((x) => set.has(x))
}

/** True when saving would change what is stored for this file. */
export function isDirty(base: MediaLabelSummary, eff: EffectiveLabels) {
  return (
    !sameSet(
      eff.items.map((i) => i.key),
      base.items.map(itemKey)
    ) ||
    !sameSet(eff.contentTypes, base.contentTypes) ||
    eff.note.trim() !== (base.note ?? "").trim() ||
    missingItemChange(base, eff.missingItem) !== null
  )
}

/** A client-side limit problem that would make the server reject the save. */
export function limitProblem(eff: EffectiveLabels): string | null {
  if (eff.items.length > LABEL_LIMITS.maxItemsPerAsset)
    return `This file would have ${eff.items.length} menu items. The most is ${LABEL_LIMITS.maxItemsPerAsset}; remove some.`
  if (eff.contentTypes.length > LABEL_LIMITS.maxContentTypes)
    return `This file would have ${eff.contentTypes.length} content types. The most is ${LABEL_LIMITS.maxContentTypes}; remove some.`
  if (eff.note.trim().length > LABEL_LIMITS.maxNoteLength)
    return `The note is longer than ${LABEL_LIMITS.maxNoteLength} characters.`
  return null
}

export function buildSaveInput(
  assetId: string,
  base: MediaLabelSummary,
  eff: EffectiveLabels,
  catalogueVersionId: string | null
): SaveLabelsInput {
  return {
    assetId,
    expectedRevision: base.revision,
    catalogueVersionId,
    contentTypes: eff.contentTypes,
    note: eff.note.trim() || null,
    items: eff.items.map((i) => ({ itemId: i.itemId, variantId: i.variantId })),
    missingItem: missingItemChange(base, eff.missingItem),
  }
}

// ---------------------------------------------------------------------------
// Adjustment operations
// ---------------------------------------------------------------------------

export function addItem(adj: FileAdjust, item: DraftItem): FileAdjust {
  const key = itemKey(item)
  return {
    ...adj,
    add: [...adj.add.filter((i) => itemKey(i) !== key), item],
    remove: adj.remove.filter((k) => k !== key),
  }
}

/** `masked`: the item comes from the saved labels or the common selection. */
export function removeItem(
  adj: FileAdjust,
  key: string,
  masked: boolean
): FileAdjust {
  return {
    ...adj,
    add: adj.add.filter((i) => itemKey(i) !== key),
    remove:
      masked && !adj.remove.includes(key) ? [...adj.remove, key] : adj.remove,
  }
}

/**
 * A common item was replaced (its variant question answered): a file that left
 * it off leaves the new one off too, unless the file has that one itself
 * (added, or among `saved`, its saved item keys). A saved item the file left
 * off stays off.
 */
export function renameRemoved(
  adj: FileAdjust,
  fromKey: string,
  toKey: string,
  saved: readonly string[] = []
): FileAdjust {
  if (!adj.remove.includes(fromKey)) return adj
  const remove = saved.includes(fromKey)
    ? adj.remove
    : adj.remove.filter((k) => k !== fromKey)
  const own = saved.includes(toKey) || adj.add.some((i) => itemKey(i) === toKey)
  return {
    ...adj,
    remove: own || remove.includes(toKey) ? remove : [...remove, toKey],
  }
}

export function setContentType(
  adj: FileAdjust,
  type: ContentType,
  on: boolean
): FileAdjust {
  const addTypes = adj.addTypes.filter((t) => t !== type)
  const removeTypes = adj.removeTypes.filter((t) => t !== type)
  return on
    ? { ...adj, addTypes: [...addTypes, type], removeTypes }
    : { ...adj, addTypes, removeTypes: [...removeTypes, type] }
}

/** Adjustments that make a file show exactly `current` under `common`. */
export function adoptCurrent(
  current: MediaLabelSummary,
  common: CommonDraft
): FileAdjust {
  const keys = new Set(current.items.map(itemKey))
  return {
    add: [],
    remove: common.items.map(itemKey).filter((k) => !keys.has(k)),
    addTypes: [],
    removeTypes: common.contentTypes.filter(
      (t) => !current.contentTypes.includes(t)
    ),
    note: common.note.trim() ? (current.note ?? "") : undefined,
  }
}

// ---------------------------------------------------------------------------
// Catalogue checks and per-file save status
// ---------------------------------------------------------------------------

/** Whether a newly picked item can still be added from this catalogue. */
export function isPickable(catalogue: LabelCatalogue, ref: LabelItemRef) {
  if (catalogue.status !== "active") return false
  for (const section of catalogue.sections) {
    for (const item of section.items) {
      if (item.itemId !== ref.itemId) continue
      return (
        ref.variantId === null ||
        item.variants.some((v) => v.variantId === ref.variantId)
      )
    }
  }
  return false
}

/**
 * A preset (the dish the files were picked for) as a draft item, when the
 * catalogue still offers it. Names come from the catalogue, so a renamed dish
 * shows its current name.
 */
export function presetDraft(
  catalogue: LabelCatalogue | null,
  preset: LabelItemRef | null | undefined
): DraftItem | null {
  if (!catalogue || !preset || !isPickable(catalogue, preset)) return null
  if (catalogue.status !== "active") return null
  for (const section of catalogue.sections) {
    const item = section.items.find((i) => i.itemId === preset.itemId)
    if (!item) continue
    return {
      itemId: item.itemId,
      variantId: preset.variantId,
      name: item.name,
      variantName:
        item.variants.find((v) => v.variantId === preset.variantId)?.name ??
        null,
      sectionName: section.name,
      labelledAs: null,
      state: "current",
    }
  }
  return null
}

/** The catalogue item of a reference, when the catalogue still offers it. */
function findItem(catalogue: LabelCatalogue | null, itemId: string) {
  if (catalogue?.status !== "active") return null
  for (const section of catalogue.sections) {
    const item = section.items.find((i) => i.itemId === itemId)
    if (item) return { item, section }
  }
  return null
}

/**
 * True for a dish that has variants but was labelled without one ("Not
 * specified"). Saved as variantId null.
 */
export function isUnspecifiedVariant(
  catalogue: LabelCatalogue | null,
  ref: LabelItemRef
) {
  if (ref.variantId !== null) return false
  return (findItem(catalogue, ref.itemId)?.item.variants.length ?? 0) > 0
}

/**
 * Adjustments that make a file show exactly `input` (a stored draft) on top of
 * its saved labels. `items` are the input's items as draft items (see
 * draftItemsFromRefs).
 */
export function adjustFromInput(
  base: MediaLabelSummary,
  input: Pick<SaveLabelsInput, "contentTypes" | "note" | "missingItem">,
  items: readonly DraftItem[]
): FileAdjust {
  const keys = new Set(items.map(itemKey))
  const savedKeys = new Set(base.items.map(itemKey))
  const note = input.note ?? ""
  return {
    add: items.filter((i) => !savedKeys.has(itemKey(i))),
    remove: base.items.map(itemKey).filter((k) => !keys.has(k)),
    addTypes: input.contentTypes.filter((t) => !base.contentTypes.includes(t)),
    removeTypes: base.contentTypes.filter(
      (t) => !input.contentTypes.includes(t)
    ),
    note: note.trim() === (base.note ?? "").trim() ? undefined : note,
    missingItem: input.missingItem ?? undefined,
  }
}

/** Shown in place of a dish name the current menu no longer has. */
export const OFF_MENU_NAME = "Dish no longer on the menu"

/**
 * Stored item references (a draft saved earlier) as draft items named from the
 * current catalogue. A reference the catalogue no longer offers keeps the name
 * it had in `known` (e.g. the asset's saved labels), else OFF_MENU_NAME; the
 * editor flags it as no longer on the menu.
 */
export function draftItemsFromRefs(
  catalogue: LabelCatalogue | null,
  refs: readonly LabelItemRef[],
  known: readonly DraftItem[] = []
): DraftItem[] {
  const seen = new Set<string>()
  const out: DraftItem[] = []
  for (const ref of refs) {
    const key = itemKey(ref)
    if (seen.has(key)) continue
    seen.add(key)
    const found = findItem(catalogue, ref.itemId)
    const variant =
      ref.variantId === null
        ? null
        : (found?.item.variants.find((v) => v.variantId === ref.variantId) ??
          null)
    if (found && (ref.variantId === null || variant)) {
      out.push({
        itemId: ref.itemId,
        variantId: ref.variantId,
        name: found.item.name,
        variantName: variant?.name ?? null,
        sectionName: found.section.name,
        labelledAs: null,
        state: "current",
      })
      continue
    }
    const before = known.find((k) => itemKey(k) === key)
    out.push(
      before ?? {
        itemId: ref.itemId,
        variantId: ref.variantId,
        name: OFF_MENU_NAME,
        variantName: null,
        sectionName: null,
        labelledAs: null,
        state: "not_on_active_menu",
      }
    )
  }
  return out
}

export type FileStatus =
  | { kind: "idle" }
  | { kind: "saved" }
  | { kind: "adopted" }
  | {
      kind: "error"
      code: SaveLabelsErrorCode | "no_result"
      message: string
      current?: MediaLabelSummary
      unavailableItemIds?: string[]
    }

export const IDLE: FileStatus = { kind: "idle" }
