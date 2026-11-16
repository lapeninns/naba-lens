"use client"

import * as React from "react"
import { Combobox as ComboboxPrimitive } from "@base-ui/react/combobox"
import { CaretDownIcon, CheckIcon, XIcon } from "@phosphor-icons/react"

import { Button } from "@/components/ui/button"
import {
  fieldControlVariants,
  type FieldControlSize,
} from "@/components/ui/field-control"
import { OPTION_ITEM_HIGHLIGHT } from "@/components/ui/option-item"
import { Spinner } from "@/components/ui/spinner"
import { cn } from "@/lib/utils"

/*
 * Combobox (DESIGN.md §4, fields; §7, focus and names): a field you type in
 * to narrow a long list, then pick one option. Built on Base UI's Combobox,
 * which owns the combobox and listbox roles, the arrow keys, Enter, Escape
 * and the hidden form input.
 *
 * The field wears the same look as Input: grey fill, strong 1px edge, 8px
 * radius, 56px at md. The label is the caller's: a <label htmlFor> on the
 * id, or aria-label.
 */

/** One choice. `value` is what a form submits; `label` fills the field. */
export type ComboboxOption = {
  value: string
  label: string
  /** A second, quieter line under the label. */
  description?: string
  /** Extra words that typing can match but that are not shown. */
  keywords?: readonly string[]
  disabled?: boolean
}

/** A labelled run of options. */
export type ComboboxOptionGroup<T extends ComboboxOption = ComboboxOption> = {
  label: string
  items: readonly T[]
}

// The field is the shared recipe (grey fill, strong edge, hover, invalid,
// off, and the forced-colours border), so it cannot drift from Input. Two
// things are added here: a fixed height, because the buttons are centred
// over the field, and room at the end for those buttons.
const HEIGHT: Record<FieldControlSize, string> = {
  sm: "h-11",
  md: "h-14",
  lg: "h-15",
}

function comboboxInputVariants({
  size = "md",
  clearable = false,
  className,
}: {
  size?: FieldControlSize | null
  clearable?: boolean | null
  className?: string
} = {}) {
  const resolved = size ?? "md"
  return cn(
    fieldControlVariants({ size: resolved }),
    HEIGHT[resolved],
    clearable ? "pr-24" : "pr-12",
    className
  )
}

export type ComboboxSize = FieldControlSize

const fold = (text: string) =>
  text.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase()

// Every typed word must appear somewhere in the label, the description or
// the keywords; accents and case are ignored ("creme" finds "Crème brûlée").
function matchesQuery(item: ComboboxOption, query: string) {
  const words = fold(query).split(/\s+/).filter(Boolean)
  if (words.length === 0) return true
  const haystack = fold(
    [item.label, item.description ?? "", ...(item.keywords ?? [])].join(" ")
  )
  return words.every((word) => haystack.includes(word))
}

function isGrouped<T extends ComboboxOption>(
  items: readonly T[] | readonly ComboboxOptionGroup<T>[]
): items is readonly ComboboxOptionGroup<T>[] {
  const first = items[0]
  return first !== undefined && "items" in first
}

export type ComboboxProps<T extends ComboboxOption = ComboboxOption> = {
  /** The options, flat or in labelled groups. */
  items: readonly T[] | readonly ComboboxOptionGroup<T>[]
  /** What one option shows. Default: its label, with the description under it. */
  children?: (item: T) => React.ReactNode
  /** The chosen option (controlled). `null` is no choice. */
  value?: T | null
  defaultValue?: T | null
  onValueChange?: (value: T | null) => void
  /** The typed text (controlled), for lists fetched as the person types. */
  inputValue?: string
  onInputValueChange?: (inputValue: string) => void
  /**
   * How typing narrows the list. Default: every word matches the label,
   * description or keywords. Pass `null` when `items` already holds only the
   * matches (a server search).
   */
  filter?: null | ((item: T, query: string) => boolean)
  /** The most options to show at once. Default: all of them. */
  limit?: number
  /** Submits the chosen option's `value` under this name. */
  name?: string
  /** The form to submit with, when the field sits outside it. */
  form?: string
  required?: boolean
  placeholder?: string
  disabled?: boolean
  /** Marks the field invalid. Put the error text under it and point `aria-describedby` at it. */
  invalid?: boolean
  /** The same as `invalid`, under the name FormField gives its control. */
  "aria-invalid"?: boolean | "true" | "false"
  /** Shows a button that removes the choice. */
  clearable?: boolean
  /** Name of the clear button. Say what it clears: "Clear menu item". */
  clearLabel?: string
  /** Name of the button that opens the list. */
  openLabel?: string
  /** Options are on their way: the popup says so with a spinner. */
  loading?: boolean
  loadingMessage?: string
  /** Shown when nothing matches. */
  emptyMessage?: React.ReactNode
  size?: ComboboxSize
  /** The field's id, for a <label htmlFor>. */
  id?: string
  "aria-label"?: string
  "aria-labelledby"?: string
  "aria-describedby"?: string
  /** Layout only: width, margin. Goes on the wrapper. */
  className?: string
  open?: boolean
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
}

function Combobox<T extends ComboboxOption = ComboboxOption>({
  items,
  children,
  value,
  defaultValue,
  onValueChange,
  inputValue,
  onInputValueChange,
  filter,
  limit,
  name,
  form,
  required,
  placeholder,
  disabled = false,
  invalid: invalidProp = false,
  "aria-invalid": ariaInvalid,
  clearable = false,
  clearLabel = "Clear",
  openLabel = "Show options",
  loading = false,
  loadingMessage = "Loading",
  emptyMessage = "No matches.",
  size = "md",
  id,
  "aria-label": ariaLabel,
  "aria-labelledby": ariaLabelledby,
  "aria-describedby": ariaDescribedby,
  className,
  open,
  defaultOpen,
  onOpenChange,
}: ComboboxProps<T>) {
  const invalid = invalidProp || ariaInvalid === true || ariaInvalid === "true"
  const renderItem = (item: T) => (
    <ComboboxPrimitive.Item
      key={item.value}
      value={item}
      disabled={item.disabled}
      data-slot="combobox-item"
      className={cn(
        "relative flex min-h-11 w-full cursor-default items-center rounded-control py-2 pr-10 pl-3 text-body text-ink outline-hidden select-none hover:bg-surface-2 data-selected:font-bold data-disabled:pointer-events-none data-disabled:text-ink-muted",
        OPTION_ITEM_HIGHLIGHT
      )}
    >
      <span data-slot="combobox-item-text" className="min-w-0 flex-1">
        {children ? (
          children(item)
        ) : (
          <>
            <span className="block">{item.label}</span>
            {item.description ? (
              <span className="block text-meta font-normal text-ink-muted">
                {item.description}
              </span>
            ) : null}
          </>
        )}
      </span>
      {/* The tick, with aria-selected, marks the choice; weight backs it up. */}
      <ComboboxPrimitive.ItemIndicator
        data-slot="combobox-item-indicator"
        className="pointer-events-none absolute right-3 flex size-5 items-center justify-center text-select"
      >
        <CheckIcon weight="bold" aria-hidden className="size-5" />
      </ComboboxPrimitive.ItemIndicator>
    </ComboboxPrimitive.Item>
  )

  return (
    <ComboboxPrimitive.Root<T>
      items={items}
      value={value}
      defaultValue={defaultValue}
      onValueChange={(next) => onValueChange?.(next)}
      inputValue={inputValue}
      onInputValueChange={(next) => onInputValueChange?.(next)}
      filter={filter === undefined ? matchesQuery : filter}
      limit={limit}
      name={name}
      form={form}
      required={required}
      disabled={disabled}
      open={open}
      defaultOpen={defaultOpen}
      onOpenChange={(next) => onOpenChange?.(next)}
      isItemEqualToValue={(a, b) => a.value === b.value}
      itemToStringLabel={(item) => item.label}
      itemToStringValue={(item) => item.value}
      // Hover tints through CSS; the outlined highlight is the keyboard's.
      highlightItemOnHover={false}
    >
      <div
        data-slot="combobox"
        data-size={size}
        data-invalid={invalid || undefined}
        data-disabled={disabled || undefined}
        className={cn("relative w-full", className)}
      >
        <ComboboxPrimitive.Input
          id={id}
          data-slot="combobox-input"
          placeholder={placeholder}
          aria-label={ariaLabel}
          aria-labelledby={ariaLabelledby}
          aria-describedby={ariaDescribedby}
          aria-invalid={invalid || undefined}
          className={comboboxInputVariants({ size, clearable })}
        />
        <div
          data-slot="combobox-actions"
          className="absolute inset-y-0 right-0 flex items-center"
        >
          {clearable ? (
            <ComboboxPrimitive.Clear
              data-slot="combobox-clear"
              aria-label={clearLabel}
              render={<Button variant="quiet" size="icon" />}
            >
              <XIcon aria-hidden />
            </ComboboxPrimitive.Clear>
          ) : null}
          <ComboboxPrimitive.Trigger
            data-slot="combobox-trigger"
            aria-label={openLabel}
            render={<Button variant="quiet" size="icon" />}
          >
            <CaretDownIcon aria-hidden />
          </ComboboxPrimitive.Trigger>
        </div>
      </div>

      <ComboboxPrimitive.Portal>
        <ComboboxPrimitive.Positioner
          sideOffset={4}
          className="isolate z-overlay outline-none"
        >
          <ComboboxPrimitive.Popup
            data-slot="combobox-popup"
            aria-busy={loading || undefined}
            className="flex max-h-(--available-height) w-(--anchor-width) max-w-(--available-width) min-w-36 origin-(--transform-origin) flex-col overflow-hidden rounded-control border border-transparent bg-surface text-ink shadow-float duration-quick data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0"
          >
            <div
              data-slot="combobox-scroll"
              className="max-h-80 min-h-0 overflow-y-auto overscroll-contain p-1"
            >
              {/* Status and Empty stay mounted so a screen reader hears
                  their text change; only what is inside them comes and goes. */}
              <ComboboxPrimitive.Status data-slot="combobox-status">
                {loading ? (
                  <span className="flex min-h-11 items-center gap-2 px-3 py-2 text-body text-ink-muted">
                    <Spinner />
                    {loadingMessage}
                  </span>
                ) : null}
              </ComboboxPrimitive.Status>
              <ComboboxPrimitive.Empty data-slot="combobox-empty">
                {loading ? null : (
                  <span className="flex min-h-11 items-center px-3 py-2 text-body text-ink-muted">
                    {emptyMessage}
                  </span>
                )}
              </ComboboxPrimitive.Empty>
              <ComboboxPrimitive.List
                data-slot="combobox-list"
                className="outline-none"
              >
                {isGrouped(items)
                  ? (group: ComboboxOptionGroup<T>) => (
                      <ComboboxPrimitive.Group
                        key={group.label}
                        items={group.items}
                        data-slot="combobox-group"
                      >
                        <ComboboxPrimitive.GroupLabel
                          data-slot="combobox-group-label"
                          className="px-3 py-2 text-meta font-semibold text-ink-muted"
                        >
                          {group.label}
                        </ComboboxPrimitive.GroupLabel>
                        <ComboboxPrimitive.Collection>
                          {renderItem}
                        </ComboboxPrimitive.Collection>
                      </ComboboxPrimitive.Group>
                    )
                  : renderItem}
              </ComboboxPrimitive.List>
            </div>
          </ComboboxPrimitive.Popup>
        </ComboboxPrimitive.Positioner>
      </ComboboxPrimitive.Portal>
    </ComboboxPrimitive.Root>
  )
}

export { Combobox, comboboxInputVariants }
