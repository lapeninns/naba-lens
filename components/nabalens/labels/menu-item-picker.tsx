"use client"

import * as React from "react"
import { MagnifyingGlassIcon } from "@phosphor-icons/react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

import {
  searchCatalogue,
  type CatalogueHit,
  type CatalogueIndex,
} from "./catalogue-search"
import { itemKey, type DraftItem } from "./label-draft"

type MenuItemPickerProps = {
  /** Visible label of the search box. */
  label: React.ReactNode
  index: CatalogueIndex
  /** Keys (itemKey) already selected, so they are not offered twice. */
  selectedKeys: ReadonlySet<string>
  onPick: (item: DraftItem) => void
  disabled?: boolean
  /** Shown under the box, and linked to it (e.g. "at most 20 items"). */
  description?: React.ReactNode
}

function toDraft(hit: CatalogueHit, variantId: string | null): DraftItem {
  return {
    itemId: hit.item.itemId,
    variantId,
    name: hit.item.name,
    variantName:
      hit.item.variants.find((v) => v.variantId === variantId)?.name ?? null,
    sectionName: hit.section.name,
    labelledAs: null,
    state: "current",
  }
}

function fullyChosen(hit: CatalogueHit, selected: ReadonlySet<string>) {
  const has = (variantId: string | null) =>
    selected.has(itemKey({ itemId: hit.item.itemId, variantId }))
  return has(null) && hit.item.variants.every((v) => has(v.variantId))
}

/**
 * Search box + listbox (ARIA combobox pattern). Type to filter, ArrowUp/Down
 * to move, Enter to choose, Escape to clear. Results are an inline list with
 * 44px rows, so nothing depends on hover. Items with variants ask which one.
 */
export function MenuItemPicker({
  label,
  index,
  selectedKeys,
  onPick,
  disabled = false,
  description,
}: MenuItemPickerProps) {
  const id = React.useId()
  const inputId = `${id}-input`
  const listId = `${id}-list`
  const descId = `${id}-desc`
  const variantHeadingId = `${id}-variant`
  const inputRef = React.useRef<HTMLInputElement>(null)
  const variantGroupRef = React.useRef<HTMLDivElement>(null)
  const listRef = React.useRef<HTMLUListElement>(null)
  const [query, setQuery] = React.useState("")
  const [active, setActive] = React.useState(-1)
  const [choosing, setChoosing] = React.useState<CatalogueHit | null>(null)

  const hits = React.useMemo(
    () => searchCatalogue(index, query),
    [index, query]
  )
  const open = query.trim() !== "" && !choosing
  const optionId = (i: number) => `${id}-opt-${i}`

  React.useEffect(() => {
    if (!choosing) return
    variantGroupRef.current
      ?.querySelector<HTMLButtonElement>("button:not(:disabled)")
      ?.focus()
  }, [choosing])

  React.useEffect(() => {
    if (active < 0) return
    document.getElementById(optionId(active))?.scrollIntoView?.({
      block: "nearest",
    })
    // optionId only depends on the stable id.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active])

  function finish(item: DraftItem | null) {
    if (item) onPick(item)
    setChoosing(null)
    if (item) setQuery("")
    setActive(-1)
    inputRef.current?.focus()
  }

  function choose(hit: CatalogueHit) {
    if (fullyChosen(hit, selectedKeys)) return
    if (hit.item.variants.length > 0) setChoosing(hit)
    else finish(toDraft(hit, null))
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      // Never submit the surrounding form from the search box.
      event.preventDefault()
      if (open && active >= 0 && hits[active]) choose(hits[active])
      return
    }
    if (event.key === "Escape" && query) {
      // Clear the search; a second Escape reaches the dialog.
      event.preventDefault()
      event.stopPropagation()
      setQuery("")
      setActive(-1)
      return
    }
    if (!open || hits.length === 0) return
    if (event.key === "ArrowDown") {
      event.preventDefault()
      setActive((a) => (a + 1) % hits.length)
    } else if (event.key === "ArrowUp") {
      event.preventDefault()
      setActive((a) => (a <= 0 ? hits.length - 1 : a - 1))
    }
  }

  const describedBy = [description ? descId : null, `${id}-count`]
    .filter(Boolean)
    .join(" ")

  return (
    <div className="grid gap-2">
      <label htmlFor={inputId} className="text-sm font-medium">
        {label}
      </label>
      <div className="relative">
        <MagnifyingGlassIcon
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <Input
          ref={inputRef}
          id={inputId}
          type="search"
          role="combobox"
          autoComplete="off"
          enterKeyHint="search"
          placeholder="Dish, drink or section"
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={listId}
          aria-activedescendant={
            open && active >= 0 && hits[active] ? optionId(active) : undefined
          }
          aria-describedby={describedBy}
          disabled={disabled}
          value={query}
          onChange={(e) => {
            setQuery(e.currentTarget.value)
            setActive(-1)
            setChoosing(null)
          }}
          onKeyDown={onKeyDown}
          className="h-11 pl-9 sm:h-9"
        />
      </div>
      {description ? (
        <p id={descId} className="text-sm text-muted-foreground">
          {description}
        </p>
      ) : null}
      <p id={`${id}-count`} className="sr-only" aria-live="polite">
        {open
          ? hits.length === 0
            ? "No menu items match. You can suggest a missing item instead."
            : `${hits.length} menu ${hits.length === 1 ? "item" : "items"} found`
          : ""}
      </p>

      <ul
        ref={listRef}
        id={listId}
        role="listbox"
        aria-label="Matching menu items"
        hidden={!open}
        className="max-h-72 overflow-y-auto rounded-lg border bg-background p-1"
      >
        {open && hits.length === 0 ? (
          <li
            role="presentation"
            className="px-3 py-2 text-sm text-muted-foreground"
          >
            No menu items match “{query.trim()}”. Use “Item not on the menu?” to
            suggest one.
          </li>
        ) : null}
        {open
          ? hits.map((hit, i) => {
              const chosen = fullyChosen(hit, selectedKeys)
              return (
                <li
                  key={hit.item.itemId}
                  id={optionId(i)}
                  role="option"
                  aria-selected={i === active}
                  aria-disabled={chosen || undefined}
                  data-active={i === active || undefined}
                  // Keep focus in the search box when tapping an option.
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => choose(hit)}
                  className={cn(
                    "flex min-h-11 cursor-pointer flex-col justify-center rounded-md px-3 py-1.5 text-sm data-active:bg-muted",
                    chosen && "cursor-default opacity-60"
                  )}
                >
                  <span className="font-medium">
                    {hit.item.name}
                    {chosen ? (
                      <span className="font-normal text-muted-foreground">
                        {" "}
                        (added)
                      </span>
                    ) : null}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    in {hit.section.name}
                    {hit.item.variants.length > 0
                      ? ` · ${hit.item.variants.map((v) => v.name).join(", ")}`
                      : null}
                    {hit.matchedAlias
                      ? ` · also called ${hit.matchedAlias}`
                      : null}
                  </span>
                </li>
              )
            })
          : null}
      </ul>

      {choosing ? (
        <div
          ref={variantGroupRef}
          role="group"
          aria-labelledby={variantHeadingId}
          className="grid gap-2 rounded-lg border bg-muted/40 p-3"
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault()
              e.stopPropagation()
              finish(null)
            }
          }}
        >
          <p id={variantHeadingId} className="text-sm">
            <span className="font-medium">Which {choosing.item.name}?</span>{" "}
            <span className="text-muted-foreground">
              (in {choosing.section.name})
            </span>
          </p>
          <div className="flex flex-wrap gap-2">
            {choosing.item.variants.map((v) => {
              const added = selectedKeys.has(
                itemKey({
                  itemId: choosing.item.itemId,
                  variantId: v.variantId,
                })
              )
              return (
                <Button
                  key={v.variantId}
                  type="button"
                  variant="outline"
                  size="touch"
                  disabled={added}
                  onClick={() => finish(toDraft(choosing, v.variantId))}
                >
                  {v.name}
                  {added ? " (added)" : ""}
                </Button>
              )
            })}
            <Button
              type="button"
              variant="outline"
              size="touch"
              disabled={selectedKeys.has(
                itemKey({ itemId: choosing.item.itemId, variantId: null })
              )}
              onClick={() => finish(toDraft(choosing, null))}
            >
              Not specified
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="touch"
              onClick={() => finish(null)}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
