"use client"

import * as React from "react"
import { MagnifyingGlassIcon } from "@phosphor-icons/react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

import { FIELD_CONTROL, FIELD_HINT, FIELD_LABEL } from "./field-styles"
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
  /** Names the menu in the no-match message. */
  venueName: string
  /** Offered when nothing matches: name the search text as a missing item. */
  onAddMissing?: (text: string) => void
  /** Follows the add-missing action, saying what happens next. */
  addMissingHint?: string
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
  venueName,
  onAddMissing,
  addMissingHint,
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
    <div className="grid gap-1.5">
      <label htmlFor={inputId} className={FIELD_LABEL}>
        {label}
      </label>
      <div className="relative">
        <MagnifyingGlassIcon
          className="pointer-events-none absolute top-1/2 left-3 size-[18px] -translate-y-1/2 text-ink-muted"
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
          className={cn(FIELD_CONTROL, "ps-9.5")}
        />
      </div>
      {description ? (
        <p id={descId} className={FIELD_HINT}>
          {description}
        </p>
      ) : null}
      <p id={`${id}-count`} className="sr-only" aria-live="polite">
        {open
          ? hits.length === 0
            ? `Nothing on ${venueName}'s menu matches.`
            : `${hits.length} menu ${hits.length === 1 ? "item" : "items"} found`
          : ""}
      </p>

      <ul
        ref={listRef}
        id={listId}
        role="listbox"
        aria-label="Matching menu items"
        hidden={!open}
        className="max-h-72 overflow-y-auto rounded-control border border-line bg-panel"
      >
        {open && hits.length === 0 ? (
          <li
            role="presentation"
            className="px-3 py-2.5 text-body-touch text-ink-muted md:text-body-sm"
          >
            {`Nothing on ${venueName}'s menu matches "${query.trim()}".`}
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
                    "flex min-h-11 cursor-pointer flex-col justify-center border-t border-line px-3 py-2 text-ink first:border-t-0 hover:bg-fill-hover data-active:bg-accent-soft",
                    chosen && "cursor-default text-ink-muted"
                  )}
                >
                  <span className="text-label-touch md:text-label">
                    {hit.item.name}
                    {chosen ? (
                      <span className="font-normal text-ink-muted">
                        {" "}
                        (added)
                      </span>
                    ) : null}
                  </span>
                  <span className="text-meta-touch text-ink-muted md:text-meta">
                    {hit.section.name}
                    {hit.item.variants.length > 0
                      ? " · choose a variant"
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

      {open && hits.length === 0 && onAddMissing ? (
        <p className={FIELD_HINT}>
          <Button
            type="button"
            variant="link"
            className="text-meta-touch md:text-meta"
            disabled={disabled}
            onClick={() => {
              const text = query.trim()
              setQuery("")
              setActive(-1)
              onAddMissing(text)
            }}
          >
            {`Add "${query.trim()}" as a missing item`}
          </Button>
          {addMissingHint ? `. ${addMissingHint}` : null}
        </p>
      ) : null}

      {choosing ? (
        <div
          ref={variantGroupRef}
          role="group"
          aria-labelledby={variantHeadingId}
          className="grid gap-2 rounded-control bg-well p-3"
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault()
              e.stopPropagation()
              finish(null)
            }
          }}
        >
          <p id={variantHeadingId} className="text-body-touch md:text-body-sm">
            <span className="font-semibold">Which {choosing.item.name}?</span>{" "}
            <span className="text-ink-muted">(in {choosing.section.name})</span>
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
                  variant="secondary"
                  size="sm"
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
              variant="secondary"
              size="sm"
              disabled={selectedKeys.has(
                itemKey({ itemId: choosing.item.itemId, variantId: null })
              )}
              onClick={() => finish(toDraft(choosing, null))}
            >
              Not specified
            </Button>
            <Button
              type="button"
              variant="quiet"
              size="sm"
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
