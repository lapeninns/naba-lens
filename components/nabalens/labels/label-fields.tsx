"use client"

import * as React from "react"
import { ArrowCounterClockwiseIcon, XIcon } from "@phosphor-icons/react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { toggleVariants } from "@/components/ui/toggle"
import {
  CONTENT_TYPE_LABELS,
  CONTENT_TYPES,
  LABEL_LIMITS,
  type ContentType,
} from "@/lib/menus/types"
import { cn } from "@/lib/utils"

import type { CatalogueIndex } from "./catalogue-search"
import type { DraftItem, EffectiveItem, EffectiveLabels } from "./label-draft"
import { ITEM_STATE_TEXT } from "./label-summary"
import { MenuItemPicker } from "./menu-item-picker"
import type { CatalogueProp } from "./types"

export function itemDisplayName(item: {
  name: string
  variantName: string | null
}) {
  return item.variantName ? `${item.name}, ${item.variantName}` : item.name
}

/** Visible text plus a screen-reader name that says which file it is for. */
function named(text: string, suffix?: string): React.ReactNode {
  if (!suffix) return text
  return (
    <>
      <span aria-hidden="true">{text}</span>
      <span className="sr-only">{`${text} ${suffix}`}</span>
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
        return (
          <li
            key={item.key}
            data-unavailable={unavailable || undefined}
            className={cn(
              "flex max-w-full min-w-0 items-center gap-1 rounded-lg border bg-background py-1 pl-3 text-sm",
              unavailable && "border-negative bg-negative-surface"
            )}
          >
            <span className="min-w-0 py-0.5">
              <span className="block font-medium break-words">{name}</span>
              <span className="block text-xs text-muted-foreground">
                {[
                  item.sectionName,
                  unavailable ? "No longer available, remove it" : null,
                  item.state !== "current" ? ITEM_STATE_TEXT[item.state] : null,
                  item.labelledAs ? `labelled as ${item.labelledAs}` : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            </span>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-11 shrink-0 sm:size-8"
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
// Content types (multi-select toggle chips)
// ---------------------------------------------------------------------------

function ContentTypeChips({
  legend,
  selected,
  onToggle,
  disabled,
}: {
  legend: React.ReactNode
  selected: ContentType[]
  onToggle: (type: ContentType) => void
  disabled?: boolean
}) {
  const helpId = React.useId()
  const atMax = selected.length >= LABEL_LIMITS.maxContentTypes
  return (
    <fieldset className="grid gap-2" aria-describedby={helpId}>
      <legend className="mb-2 text-sm font-medium">{legend}</legend>
      <p id={helpId} className="-mt-1 text-sm text-muted-foreground">
        {atMax
          ? `${LABEL_LIMITS.maxContentTypes} chosen, the most allowed. Remove one to choose another.`
          : `What does it show? Choose up to ${LABEL_LIMITS.maxContentTypes}.`}
      </p>
      <div className="flex flex-wrap gap-2">
        {CONTENT_TYPES.map((type) => {
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
                toggleVariants({ variant: "outline" }),
                "h-11 px-3 sm:h-8",
                pressed &&
                  "border-primary bg-primary text-primary-foreground hover:bg-primary/85 hover:text-primary-foreground aria-pressed:bg-primary",
                blocked && "opacity-50"
              )}
            >
              {CONTENT_TYPE_LABELS[type]}
            </button>
          )
        })}
      </div>
    </fieldset>
  )
}

// ---------------------------------------------------------------------------
// Note and missing item
// ---------------------------------------------------------------------------

const textareaClass =
  "min-h-20 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-2 text-base outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50 md:text-sm dark:bg-input/30"

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
      <label htmlFor={id} className="text-sm font-medium">
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
        className={textareaClass}
      />
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-sm text-muted-foreground">
        {help ? <p id={`${id}-help`}>{help}</p> : null}
        <p id={`${id}-count`} className="tabular-nums">
          {left === 1 ? "1 character left" : `${left} characters left`}
        </p>
      </div>
      {onReset ? (
        <Button
          type="button"
          variant="outline"
          size="touch"
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
  value,
  saved,
  onChange,
  suffix,
  disabled,
}: {
  value: string
  saved: string | null
  onChange: (value: string) => void
  suffix?: string
  disabled?: boolean
}) {
  const id = React.useId()
  const [open, setOpen] = React.useState(value !== "" || !!saved)
  const withdrawing = !!saved && value.trim() === ""
  return (
    <div className="grid gap-2">
      <Button
        type="button"
        variant="link"
        className="h-11 w-fit px-0 sm:h-8"
        aria-expanded={open}
        aria-controls={`${id}-panel`}
        onClick={() => setOpen((o) => !o)}
      >
        {named("Item not on the menu?", suffix)}
      </Button>
      <div id={`${id}-panel`} hidden={!open} className="grid gap-1.5">
        <label htmlFor={id} className="text-sm font-medium">
          {named("Missing menu item", suffix)}
        </label>
        <Input
          id={id}
          value={value}
          maxLength={LABEL_LIMITS.maxMissingItemLength}
          onChange={(e) => onChange(e.currentTarget.value)}
          aria-describedby={`${id}-help`}
          disabled={disabled}
          placeholder="e.g. Lamb shank special"
          className="h-11 sm:h-9"
        />
        <p id={`${id}-help`} className="text-sm text-muted-foreground">
          {withdrawing
            ? "Your suggestion will be withdrawn when you save."
            : "If nothing on the menu fits, name it here instead of picking something close. An admin reviews it and may add it to the menu."}
        </p>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// The whole label form for one scope
// ---------------------------------------------------------------------------

export type LabelFieldsProps = {
  scope: "single" | "common" | "file"
  /** File scope: the file name, appended to every label for screen readers. */
  fileName?: string
  venueName: string
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
}

export function LabelFields({
  scope,
  fileName,
  venueName,
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
}: LabelFieldsProps) {
  const containerRef = React.useRef<HTMLDivElement>(null)
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

  function focusSearch() {
    containerRef.current
      ?.querySelector<HTMLInputElement>("input[role=combobox]")
      ?.focus()
  }

  let picker: React.ReactNode
  if (catalogue.state === "loading") {
    picker = (
      <div className="grid gap-2" aria-busy="true">
        <span className="text-sm font-medium">
          {named("Search the menu", suffix)}
        </span>
        <Skeleton className="h-11 sm:h-9" />
        <span className="sr-only">Loading the menu…</span>
      </div>
    )
  } else if (catalogue.state === "error") {
    picker = (
      <p className="text-sm text-muted-foreground">
        The menu could not be loaded, so menu items can’t be searched right now.
        Your other choices still work.
      </p>
    )
  } else if (catalogue.catalogue.status === "none") {
    picker = (
      <p className="text-sm text-muted-foreground">
        {venueName} has no active menu yet, so there are no menu items to pick.
        You can still choose content types, add a note or name a missing item.
      </p>
    )
  } else {
    picker = (
      <MenuItemPicker
        label={named("Search the menu", suffix)}
        index={index}
        selectedKeys={selectedKeys}
        onPick={onAddItem}
        disabled={disabled || atMaxItems}
        description={
          atMaxItems
            ? `${LABEL_LIMITS.maxItemsPerAsset} menu items is the most allowed. Remove one to add another.`
            : undefined
        }
      />
    )
  }

  return (
    <div ref={containerRef} className="grid gap-5">
      <fieldset className="grid min-w-0 gap-3">
        <legend className="mb-2 text-sm font-medium">
          {named("Menu items", suffix)}
        </legend>
        <SelectedItems
          label={`Selected menu items${suffix ? ` ${suffix}` : ""}`}
          items={items}
          unavailableKeys={unavailableKeys}
          onRemove={onRemoveItem}
          onEmptied={focusSearch}
          disabled={disabled}
        />
        {removedCommon.length > 0 && onRestoreItem ? (
          <div className="grid gap-1.5 text-sm">
            <p className="text-muted-foreground">
              Left off this file (common to all files):
            </p>
            <ul className="flex flex-wrap gap-2">
              {removedCommon.map((item) => (
                <li key={`${item.itemId}:${item.variantId ?? ""}`}>
                  <Button
                    type="button"
                    variant="outline"
                    size="touch"
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
        {picker}
      </fieldset>

      <ContentTypeChips
        legend={named("Content types", suffix)}
        selected={contentTypes}
        onToggle={onToggleType}
        disabled={disabled}
      />

      <NoteField
        label={named("Note (optional)", suffix)}
        value={note}
        onChange={onNoteChange}
        disabled={disabled}
        help={
          scope === "common"
            ? "Replaces each file’s note, unless a file has its own note."
            : scope === "file" && noteSource === "common"
              ? "Using the common note. Edit to write a note for this file only."
              : undefined
        }
        onReset={
          scope === "file" && noteSource === "file"
            ? onUseCommonNote
            : undefined
        }
        resetLabel="Use the common note"
      />

      {missingItem ? (
        <MissingItemField
          value={missingItem.value}
          saved={missingItem.saved}
          onChange={missingItem.onChange}
          suffix={suffix || undefined}
          disabled={disabled}
        />
      ) : null}
    </div>
  )
}
