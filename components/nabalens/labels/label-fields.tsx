"use client"

import * as React from "react"
import Link from "next/link"
import {
  ArrowCounterClockwiseIcon,
  CheckIcon,
  XIcon,
} from "@phosphor-icons/react"

import { Notice } from "@/components/nabalens/notice"
import { Button, buttonVariants } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import {
  CONTENT_TYPE_LABELS,
  CONTENT_TYPES,
  LABEL_LIMITS,
  type ContentType,
} from "@/lib/menus/types"
import { cn } from "@/lib/utils"

import type { CatalogueIndex } from "./catalogue-search"
import { FIELD_CONTROL, FIELD_HINT, FIELD_LABEL } from "./field-styles"
import type { DraftItem, EffectiveItem, EffectiveLabels } from "./label-draft"
import { ITEM_STATE_TEXT } from "./label-summary"
import { MenuItemPicker } from "./menu-item-picker"
import type { CatalogueProp, LabelAudience } from "./types"

/** Under every note: what a label is, and what it is not. */
export const LABEL_RULE =
  "A label describes what is in the file. It is not a claim about allergens, dietary suitability, price or availability, and not permission to publish."

export function itemDisplayName(item: {
  name: string
  variantName: string | null
}) {
  return item.variantName ? `${item.name}, ${item.variantName}` : item.name
}

/**
 * A field label: visible text with an optional muted part ("(optional)"),
 * plus a screen-reader name that says which file it is for.
 */
function named(text: string, opt?: string, suffix?: string): React.ReactNode {
  const visible = opt ? (
    <>
      {text} <span data-opt="">{opt}</span>
    </>
  ) : (
    text
  )
  if (!suffix) return visible
  return (
    <>
      <span aria-hidden="true">{visible}</span>
      <span className="sr-only">
        {[text, opt, suffix].filter(Boolean).join(" ")}
      </span>
    </>
  )
}

// ---------------------------------------------------------------------------
// Selected menu items (removable chips)
// ---------------------------------------------------------------------------

function SelectedItems({
  label,
  items,
  unavailableKeys,
  onRemove,
  onEmptied,
  disabled,
}: {
  label: string
  items: EffectiveItem[]
  unavailableKeys: ReadonlySet<string>
  onRemove: (item: EffectiveItem) => void
  /** Where focus goes after the last chip is removed. */
  onEmptied: () => void
  disabled?: boolean
}) {
  if (items.length === 0) return null
  const names = items.map(itemDisplayName)
  return (
    <ul aria-label={label} className="flex flex-wrap gap-2">
      {items.map((item, i) => {
        const name = names[i]
        // Same name twice (e.g. "Chicken" in two curry sections): add the section.
        const clash = names.filter((n) => n === name).length > 1
        const accessibleName =
          clash && item.sectionName ? `${name} (${item.sectionName})` : name
        const unavailable = unavailableKeys.has(item.key)
        const meta = [
          item.sectionName,
          unavailable ? "No longer available, remove it" : null,
          item.state !== "current" ? ITEM_STATE_TEXT[item.state] : null,
          item.labelledAs ? `labelled as ${item.labelledAs}` : null,
        ]
          .filter(Boolean)
          .join(" · ")
        return (
          <li
            key={item.key}
            data-unavailable={unavailable || undefined}
            className={cn(
              "flex max-w-full min-w-0 items-center gap-1 rounded-card bg-accent-soft py-1 ps-3.5 text-ink shadow-[inset_0_0_0_1.5px_var(--accent-text)]",
              unavailable &&
                "bg-warn-bg shadow-[inset_0_0_0_2px_var(--warn-fg)]"
            )}
          >
            <span className="min-w-0 py-0.5">
              <span className="block text-label break-words">{name}</span>
              {meta ? (
                <span className="block text-meta text-ink-muted">{meta}</span>
              ) : null}
            </span>
            <Button
              type="button"
              variant="quiet"
              size="icon-sm"
              className="shrink-0 text-current"
              aria-label={`Remove ${accessibleName}`}
              disabled={disabled}
              onClick={(e) => {
                const li = e.currentTarget.closest("li")
                const neighbour = (
                  li?.nextElementSibling ?? li?.previousElementSibling
                )?.querySelector("button")
                onRemove(item)
                if (neighbour) neighbour.focus()
                else onEmptied()
              }}
            >
              <XIcon aria-hidden />
            </Button>
          </li>
        )
      })}
    </ul>
  )
}

// ---------------------------------------------------------------------------
// What's in the photo (multi-select toggle chips)
// ---------------------------------------------------------------------------

/**
 * The chips' display order: the focus types first, then the rest in their
 * usual order. Display only; saved labels keep CONTENT_TYPES order.
 */
export function contentTypeDisplayOrder(
  focusTypes: readonly ContentType[] = []
): ContentType[] {
  const first = focusTypes.filter((t) => CONTENT_TYPES.includes(t))
  return [...new Set([...first, ...CONTENT_TYPES])]
}

function ContentTypeChips({
  legend,
  selected,
  onToggle,
  disabled,
  focusTypes,
}: {
  legend: React.ReactNode
  selected: ContentType[]
  onToggle: (type: ContentType) => void
  disabled?: boolean
  focusTypes?: readonly ContentType[]
}) {
  const helpId = React.useId()
  const order = React.useMemo(
    () => contentTypeDisplayOrder(focusTypes),
    [focusTypes]
  )
  const atMax = selected.length >= LABEL_LIMITS.maxContentTypes
  return (
    <fieldset
      className="grid min-w-0 gap-1.5"
      aria-describedby={atMax ? helpId : undefined}
    >
      <legend className={cn(FIELD_LABEL, "mb-1.5")}>{legend}</legend>
      <div className="flex flex-wrap gap-2">
        {order.map((type) => {
          const pressed = selected.includes(type)
          const blocked = !pressed && atMax
          return (
            <button
              key={type}
              type="button"
              aria-pressed={pressed}
              aria-disabled={blocked || undefined}
              aria-describedby={blocked ? helpId : undefined}
              disabled={disabled}
              onClick={() => {
                if (!blocked) onToggle(type)
              }}
              className={cn(
                "inline-flex min-h-11 items-center gap-1.5 rounded-round bg-surface-2 px-4 text-label text-ink transition-colors duration-(--duration-quick) outline-none hover:bg-raised focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-focus focus-visible:outline-solid disabled:cursor-not-allowed",
                pressed &&
                  "bg-accent-soft shadow-[inset_0_0_0_1.5px_var(--accent-text)] hover:bg-accent-soft",
                blocked &&
                  "cursor-not-allowed bg-transparent text-ink-muted shadow-[inset_0_0_0_1px_var(--line)] hover:bg-transparent"
              )}
            >
              {pressed ? (
                <CheckIcon
                  aria-hidden
                  weight="bold"
                  className="-ms-0.5 size-5"
                />
              ) : null}
              {CONTENT_TYPE_LABELS[type]}
            </button>
          )
        })}
      </div>
      {atMax ? (
        <p id={helpId} className={FIELD_HINT}>
          {`${LABEL_LIMITS.maxContentTypes} chosen, the most allowed. Remove one to choose another.`}
        </p>
      ) : null}
    </fieldset>
  )
}

// ---------------------------------------------------------------------------
// Note and missing item
// ---------------------------------------------------------------------------

function NoteField({
  label,
  value,
  onChange,
  help,
  onReset,
  resetLabel,
  disabled,
}: {
  label: React.ReactNode
  value: string
  onChange: (value: string) => void
  help?: React.ReactNode
  onReset?: () => void
  resetLabel?: string
  disabled?: boolean
}) {
  const id = React.useId()
  const left = LABEL_LIMITS.maxNoteLength - value.length
  return (
    <div className="grid gap-1.5">
      <label htmlFor={id} className={FIELD_LABEL}>
        {label}
      </label>
      <textarea
        id={id}
        value={value}
        maxLength={LABEL_LIMITS.maxNoteLength}
        onChange={(e) => onChange(e.currentTarget.value)}
        aria-describedby={`${id}-count${help ? ` ${id}-help` : ""}`}
        disabled={disabled}
        rows={2}
        className={cn("w-full min-w-0 resize-y outline-none", FIELD_CONTROL)}
      />
      <div className="flex items-start gap-3">
        {help ? (
          <p id={`${id}-help`} className={cn(FIELD_HINT, "min-w-0")}>
            {help}
          </p>
        ) : null}
        <p className="ms-auto shrink-0 font-mono text-meta whitespace-nowrap text-ink-muted tabular-nums">
          <span aria-hidden="true">
            {`${value.length} / ${LABEL_LIMITS.maxNoteLength}`}
          </span>
          <span id={`${id}-count`} className="sr-only">
            {left === 1 ? "1 character left" : `${left} characters left`}
          </span>
        </p>
      </div>
      {onReset ? (
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="w-fit"
          onClick={onReset}
          disabled={disabled}
        >
          <ArrowCounterClockwiseIcon data-icon="inline-start" aria-hidden />
          {resetLabel ?? "Reset"}
        </Button>
      ) : null}
    </div>
  )
}

function MissingItemField({
  inputRef,
  value,
  saved,
  onChange,
  venueName,
  audience,
  suffix,
  disabled,
}: {
  inputRef: React.Ref<HTMLInputElement>
  value: string
  saved: string | null
  onChange: (value: string) => void
  venueName: string
  audience: LabelAudience
  suffix?: string
  disabled?: boolean
}) {
  const id = React.useId()
  const text = value.trim()
  const withdrawing = !!saved && text === ""
  return (
    <div className="grid gap-1.5">
      <label htmlFor={id} className={FIELD_LABEL}>
        {named("Missing menu item", undefined, suffix)}
      </label>
      <Input
        ref={inputRef}
        id={id}
        value={value}
        maxLength={LABEL_LIMITS.maxMissingItemLength}
        onChange={(e) => onChange(e.currentTarget.value)}
        aria-describedby={`${id}-help`}
        disabled={disabled}
        placeholder="e.g. Lamb shank special"
        className={FIELD_CONTROL}
      />
      <div id={`${id}-help`}>
        {withdrawing ? (
          <p className={FIELD_HINT}>
            Your suggestion will be withdrawn when you save.
          </p>
        ) : text && audience === "staff" ? (
          <Notice role="none">
            {`${text} isn't on ${venueName}'s menu. We'll save it as a suggestion and an admin will review it.`}
          </Notice>
        ) : (
          <p className={FIELD_HINT}>
            {audience === "admin"
              ? "It shows on Menus for an admin to link or dismiss."
              : "If nothing on the menu fits, name it here instead of choosing something close. An admin reviews it and may add it to the menu."}
          </p>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// The whole label form for one scope
// ---------------------------------------------------------------------------

export type LabelFieldsProps = {
  scope: "single" | "common" | "file"
  audience: LabelAudience
  /** File scope: how the file is named, appended to every label for screen readers. */
  fileName?: string
  /** "photo", "video" or "file": what the content types describe. */
  mediaNoun: string
  venueName: string
  /** Admins: where the venue's open missing-item suggestions are reviewed. */
  menusHref?: string
  catalogue: CatalogueProp
  index: CatalogueIndex
  items: EffectiveItem[]
  unavailableKeys: ReadonlySet<string>
  removedCommon?: DraftItem[]
  onAddItem: (item: DraftItem) => void
  onRemoveItem: (item: EffectiveItem) => void
  onRestoreItem?: (item: DraftItem) => void
  contentTypes: ContentType[]
  onToggleType: (type: ContentType) => void
  note: string
  noteSource?: EffectiveLabels["noteSource"]
  onNoteChange: (note: string) => void
  onUseCommonNote?: () => void
  missingItem?: {
    value: string
    saved: string | null
    onChange: (value: string) => void
  }
  disabled?: boolean
  /** Content types shown first (the person's work focus). Order only. */
  focusTypes?: readonly ContentType[]
}

export function LabelFields({
  scope,
  audience,
  fileName,
  mediaNoun,
  venueName,
  menusHref,
  catalogue,
  index,
  items,
  unavailableKeys,
  removedCommon = [],
  onAddItem,
  onRemoveItem,
  onRestoreItem,
  contentTypes,
  onToggleType,
  note,
  noteSource,
  onNoteChange,
  onUseCommonNote,
  missingItem,
  disabled,
  focusTypes,
}: LabelFieldsProps) {
  const containerRef = React.useRef<HTMLDivElement>(null)
  const missingRef = React.useRef<HTMLInputElement>(null)
  const missingToggleId = React.useId()
  // Staff see their own saved suggestion in the field; an admin's saved
  // suggestion may be someone else's, so it is shown as a notice instead.
  const [missingOpen, setMissingOpen] = React.useState(
    () =>
      !!missingItem &&
      (audience === "staff"
        ? missingItem.value !== "" || !!missingItem.saved
        : missingItem.value !== (missingItem.saved ?? ""))
  )
  const [focusMissing, setFocusMissing] = React.useState(0)
  React.useEffect(() => {
    if (focusMissing) missingRef.current?.focus()
  }, [focusMissing])

  const suffix =
    scope === "common"
      ? "for all files"
      : scope === "file"
        ? `for ${fileName}`
        : ""
  const selectedKeys = React.useMemo(
    () => new Set(items.map((i) => i.key)),
    [items]
  )
  const atMaxItems = items.length >= LABEL_LIMITS.maxItemsPerAsset
  const itemLabel = `Menu item at ${venueName}`
  const itemOpt = audience === "staff" ? "(optional)" : undefined

  function focusSearch() {
    containerRef.current
      ?.querySelector<HTMLInputElement>("input[role=combobox]")
      ?.focus()
  }

  function addMissing(text: string) {
    if (!missingItem) return
    missingItem.onChange(text.slice(0, LABEL_LIMITS.maxMissingItemLength))
    setMissingOpen(true)
    setFocusMissing((n) => n + 1)
  }

  const missingToggle = missingItem ? (
    <Button
      type="button"
      variant="link"
      className="text-meta"
      aria-expanded={missingOpen}
      aria-controls={`${missingToggleId}-panel`}
      onClick={() => setMissingOpen((o) => !o)}
    >
      {named("Item not on the menu?", undefined, suffix || undefined)}
    </Button>
  ) : null
  const staffHint =
    audience === "staff" && missingToggle ? (
      <p className={FIELD_HINT}>
        {missingToggle} Type its name and an admin will review it.
      </p>
    ) : null

  let picker: React.ReactNode
  if (catalogue.state === "loading") {
    picker = (
      <div className="grid gap-1.5" aria-busy="true">
        <span className={FIELD_LABEL}>{named(itemLabel, itemOpt, suffix)}</span>
        <Skeleton className="h-14 rounded-control" />
        <span className="sr-only">Loading the menu…</span>
      </div>
    )
  } else if (catalogue.state === "error") {
    picker = (
      <p className={FIELD_HINT}>
        The menu could not be loaded, so menu items can’t be searched right now.
        Your other choices still work.
      </p>
    )
  } else if (catalogue.catalogue.status === "none") {
    picker =
      audience === "admin" ? (
        <Notice>
          {`${venueName} has no active menu, so a menu item can't be chosen. The other labels still work.`}
        </Notice>
      ) : (
        <Notice title="No menu items yet">
          {`${venueName} has no active menu yet, so there are no menu items to choose. You can still add what's in the ${mediaNoun} and a note.`}
        </Notice>
      )
  } else {
    picker = (
      <MenuItemPicker
        label={named(itemLabel, itemOpt, suffix)}
        index={index}
        selectedKeys={selectedKeys}
        onPick={onAddItem}
        venueName={venueName}
        onAddMissing={missingItem ? addMissing : undefined}
        addMissingHint={
          audience === "admin"
            ? "It shows on Menus for an admin to link or dismiss."
            : "An admin will review it."
        }
        disabled={disabled || atMaxItems}
        description={
          atMaxItems
            ? `${LABEL_LIMITS.maxItemsPerAsset} menu items is the most allowed. Remove one to add another.`
            : undefined
        }
      />
    )
  }

  const ready = catalogue.state === "ready" ? catalogue.catalogue : null

  return (
    <div ref={containerRef} className="grid gap-5">
      <div className="grid min-w-0 gap-3">
        <SelectedItems
          label={`Selected menu items${suffix ? ` ${suffix}` : ""}`}
          items={items}
          unavailableKeys={unavailableKeys}
          onRemove={onRemoveItem}
          onEmptied={focusSearch}
          disabled={disabled}
        />
        {removedCommon.length > 0 && onRestoreItem ? (
          <div className="grid gap-1.5">
            <p className={FIELD_HINT}>
              Left off this file (common to all files):
            </p>
            <ul className="flex flex-wrap gap-2">
              {removedCommon.map((item) => (
                <li key={`${item.itemId}:${item.variantId ?? ""}`}>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    disabled={disabled}
                    onClick={() => onRestoreItem(item)}
                    aria-label={`Add back ${itemDisplayName(item)}${suffix ? ` ${suffix}` : ""}`}
                  >
                    <ArrowCounterClockwiseIcon
                      data-icon="inline-start"
                      aria-hidden
                    />
                    {itemDisplayName(item)}
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        <div className="grid gap-1.5">
          {picker}
          {audience === "admin" && ready?.status === "active" ? (
            <p className={FIELD_HINT}>
              {`Searches the menu of the venue at upload, ${venueName}, not where the uploader works now.`}
            </p>
          ) : null}
          {staffHint}
        </div>
        {missingItem ? (
          <div id={`${missingToggleId}-panel`} hidden={!missingOpen}>
            <MissingItemField
              inputRef={missingRef}
              value={missingItem.value}
              saved={missingItem.saved}
              onChange={missingItem.onChange}
              venueName={venueName}
              audience={audience}
              suffix={suffix || undefined}
              disabled={disabled}
            />
          </div>
        ) : null}
        {audience === "admin" && missingItem?.saved ? (
          <Notice
            title="1 missing-item suggestion"
            action={
              menusHref ? (
                <Link
                  href={menusHref}
                  data-variant="secondary"
                  className={buttonVariants({
                    variant: "secondary",
                    size: "sm",
                  })}
                >
                  Open Menus
                </Link>
              ) : undefined
            }
          >
            {`Someone suggested "${missingItem.saved}", which isn't on ${venueName}'s menu. Link it to an item or dismiss it on Menus.`}
          </Notice>
        ) : null}
      </div>

      <ContentTypeChips
        legend={named(
          `What's in the ${mediaNoun}`,
          `(up to ${LABEL_LIMITS.maxContentTypes})`,
          suffix
        )}
        selected={contentTypes}
        onToggle={onToggleType}
        disabled={disabled}
        focusTypes={focusTypes}
      />

      <NoteField
        label={named("Note", "(optional)", suffix)}
        value={note}
        onChange={onNoteChange}
        disabled={disabled}
        help={
          scope === "common"
            ? `Replaces each file’s note, unless a file has its own note. ${LABEL_RULE}`
            : scope === "file" && noteSource === "common"
              ? "Using the common note. Edit to write a note for this file only."
              : scope === "file"
                ? undefined
                : LABEL_RULE
        }
        onReset={
          scope === "file" && noteSource === "file"
            ? onUseCommonNote
            : undefined
        }
        resetLabel="Use the common note"
      />
    </div>
  )
}
