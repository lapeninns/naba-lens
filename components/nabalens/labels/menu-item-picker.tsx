"use client"

import * as React from "react"
import { CheckIcon, MagnifyingGlassIcon } from "@phosphor-icons/react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

import { FIELD_CONTROL, FIELD_HINT, FIELD_LABEL } from "./field-styles"
import {
  searchCatalogue,
  suggestedItems,
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
  /**
   * Swap an item the picker just added for another variant of the same dish
   * (the variant question after "Not specified" went in by default).
   */
  onReplace: (fromKey: string, item: DraftItem) => void
  /**
   * True while a choice is started but not finished: search text that was not
   * chosen, or a variant question for a dish whose "Not specified" entry is
   * already there. Reset to false on unmount.
   */
  onPendingChange?: (pending: boolean) => void
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

/** Which dish the variant question is about, and the entry it controls. */
type Choosing = {
  hit: CatalogueHit
  /**
   * The "Not specified" entry added when the dish was chosen: a variant tap
   * replaces it, so the dish is never lost. null when that entry already
   * existed, so a variant tap adds another entry (nothing is added until then).
   */
  entryKey: string | null
}

/**
 * Search box + listbox (ARIA combobox pattern). Type to filter, ArrowUp/Down
 * to move, Enter to choose, Escape to clear. Results are an inline list with
 * 44px rows, so nothing depends on hover. Choosing an item with variants adds
 * it as "Not specified" straight away and asks which one; answering is
 * optional.
 * With a work focus in the index, the empty box offers a "Suggested" list
 * from the sections closest to the person's work; typing searches everything.
 */
export function MenuItemPicker({
  label,
  index,
  selectedKeys,
  onPick,
  onReplace,
  onPendingChange,
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
  const [choosing, setChoosing] = React.useState<Choosing | null>(null)
  const [suggestOpen, setSuggestOpen] = React.useState(false)
  const suggestId = `${id}-suggested`

  const hits = React.useMemo(
    () => searchCatalogue(index, query),
    [index, query]
  )
  const suggestions = React.useMemo(() => suggestedItems(index), [index])
  const searching = query.trim() !== "" && !choosing
  const suggesting =
    !searching &&
    !choosing &&
    !disabled &&
    suggestOpen &&
    query.trim() === "" &&
    suggestions.length > 0
  const open = searching || suggesting
  const options = searching ? hits : suggesting ? suggestions : []
  const optionId = (i: number) => `${id}-opt-${i}`
  // Text with nothing to choose from is not a choice (the no-match message
  // offers the missing-item route instead).
  const pending =
    (searching && hits.length > 0) ||
    (choosing !== null && choosing.entryKey === null)

  const pendingChange = React.useRef(onPendingChange)
  React.useEffect(() => {
    pendingChange.current = onPendingChange
  })
  React.useEffect(() => {
    pendingChange.current?.(pending)
  }, [pending])
  React.useEffect(() => () => pendingChange.current?.(false), [])

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
    if (hit.item.variants.length === 0) {
      finish(toDraft(hit, null))
      return
    }
    // "Not specified" goes in at once, so leaving the question unanswered
    // still labels the dish (audit J4b: the dish was silently dropped).
    const unspecified = itemKey({ itemId: hit.item.itemId, variantId: null })
    if (selectedKeys.has(unspecified)) {
      setChoosing({ hit, entryKey: null })
    } else {
      onPick(toDraft(hit, null))
      setChoosing({ hit, entryKey: unspecified })
    }
    setQuery("")
    setActive(-1)
  }

  /** A variant (or "Not specified", null) tapped in the variant question. */
  function answer(variantId: string | null) {
    if (!choosing) return
    const item = toDraft(choosing.hit, variantId)
    if (choosing.entryKey === null) finish(item)
    else {
      if (itemKey(item) !== choosing.entryKey)
        onReplace(choosing.entryKey, item)
      finish(null)
    }
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      // Never submit the surrounding form from the search box.
      event.preventDefault()
      if (open && active >= 0 && options[active]) choose(options[active])
      return
    }
    if (event.key === "Escape" && (query || suggesting)) {
      // Clear the search (or close the suggestions); a second Escape reaches
      // the dialog.
      event.preventDefault()
      event.stopPropagation()
      if (!query) setSuggestOpen(false)
      setQuery("")
      setActive(-1)
      return
    }
    if (event.key === "ArrowDown" && !open && !query.trim()) {
      // Reopen the suggestions after Escape.
      if (suggestions.length > 0) {
        event.preventDefault()
        setSuggestOpen(true)
        setActive(0)
      }
      return
    }
    if (!open || options.length === 0) return
    if (event.key === "ArrowDown") {
      event.preventDefault()
      setActive((a) => (a + 1) % options.length)
    } else if (event.key === "ArrowUp") {
      event.preventDefault()
      setActive((a) => (a <= 0 ? options.length - 1 : a - 1))
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
          className="pointer-events-none absolute top-1/2 left-4 size-5 -translate-y-1/2 text-ink-muted"
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
            open && active >= 0 && options[active]
              ? optionId(active)
              : undefined
          }
          aria-describedby={describedBy}
          disabled={disabled}
          value={query}
          onChange={(e) => {
            setQuery(e.currentTarget.value)
            setActive(-1)
            setChoosing(null)
          }}
          onFocus={() => setSuggestOpen(true)}
          onBlur={() => {
            setSuggestOpen(false)
            if (!query.trim()) setActive(-1)
          }}
          onKeyDown={onKeyDown}
          className={cn(FIELD_CONTROL, "ps-11")}
        />
      </div>
      {description ? (
        <p id={descId} className={FIELD_HINT}>
          {description}
        </p>
      ) : null}
      <p id={`${id}-count`} className="sr-only" aria-live="polite">
        {searching
          ? hits.length === 0
            ? `Nothing on ${venueName}'s menu matches.`
            : `${hits.length} menu ${hits.length === 1 ? "item" : "items"} found`
          : suggesting
            ? `${suggestions.length} suggested menu ${suggestions.length === 1 ? "item" : "items"}. Type to search the whole menu.`
            : ""}
      </p>

      {suggesting ? (
        <p id={suggestId} className={FIELD_HINT}>
          Suggested for your work
        </p>
      ) : null}
      <ul
        ref={listRef}
        id={listId}
        role="listbox"
        aria-label={suggesting ? undefined : "Matching menu items"}
        aria-labelledby={suggesting ? suggestId : undefined}
        hidden={!open}
        className="max-h-72 overflow-y-auto rounded-card bg-surface p-1 shadow-float"
      >
        {searching && hits.length === 0 ? (
          <li
            role="presentation"
            className="px-3 py-2.5 text-body text-ink-muted"
          >
            {`Nothing on ${venueName}'s menu matches "${query.trim()}".`}
          </li>
        ) : null}
        {open
          ? options.map((hit, i) => {
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
                    "flex min-h-12 cursor-pointer flex-col justify-center rounded-control px-3 py-2 text-ink hover:bg-surface-2 data-active:bg-accent-soft",
                    chosen && "cursor-default text-ink-muted"
                  )}
                >
                  <span className="text-label">
                    {hit.item.name}
                    {chosen ? (
                      <span className="font-normal text-ink-muted">
                        {" "}
                        (added)
                      </span>
                    ) : null}
                  </span>
                  <span className="text-meta text-ink-muted">
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

      {searching && hits.length === 0 && onAddMissing ? (
        <p className={FIELD_HINT}>
          <Button
            type="button"
            variant="link"
            className="text-meta"
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
        <VariantQuestion
          groupRef={variantGroupRef}
          headingId={variantHeadingId}
          choosing={choosing}
          selectedKeys={selectedKeys}
          onAnswer={answer}
          onClose={() => finish(null)}
        />
      ) : null}
    </div>
  )
}

function VariantQuestion({
  groupRef,
  headingId,
  choosing,
  selectedKeys,
  onAnswer,
  onClose,
}: {
  groupRef: React.Ref<HTMLDivElement>
  headingId: string
  choosing: Choosing
  selectedKeys: ReadonlySet<string>
  onAnswer: (variantId: string | null) => void
  onClose: () => void
}) {
  const { item, section } = choosing.hit
  const hintId = `${headingId}-hint`
  // With an entry, the question picks that entry's variant: "Not specified" is
  // the current answer. Without one, each tap adds another entry.
  const replacing = choosing.entryKey !== null
  const options: { variantId: string | null; name: string }[] = [
    ...item.variants.map((v) => ({ variantId: v.variantId, name: v.name })),
    { variantId: null, name: "Not specified" },
  ]
  return (
    <div
      ref={groupRef}
      role="group"
      aria-labelledby={headingId}
      aria-describedby={hintId}
      className="grid gap-2 rounded-card p-3 shadow-[inset_0_0_0_1px_var(--border-strong)]"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault()
          e.stopPropagation()
          onClose()
        }
      }}
    >
      <p id={headingId} className="text-body">
        <span className="font-bold">Which {item.name}?</span>{" "}
        <span className="text-ink-muted">(in {section.name})</span>
      </p>
      <p id={hintId} className={FIELD_HINT}>
        {replacing
          ? `${item.name} is added as Not specified. Choose one if you know it.`
          : `Choose another ${item.name} to add.`}
      </p>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => {
          const key = itemKey({
            itemId: item.itemId,
            variantId: option.variantId,
          })
          const current = replacing && key === choosing.entryKey
          const added = !current && selectedKeys.has(key)
          return (
            <Button
              key={option.variantId ?? "none"}
              type="button"
              variant="secondary"
              size="sm"
              aria-pressed={replacing ? current : undefined}
              disabled={added}
              onClick={() => onAnswer(option.variantId)}
            >
              {current ? (
                <CheckIcon data-icon="inline-start" weight="bold" aria-hidden />
              ) : null}
              {option.name}
              {added ? " (added)" : ""}
            </Button>
          )
        })}
        {/* With an entry, tapping the current answer closes the question. */}
        {replacing ? null : (
          <Button type="button" variant="quiet" size="sm" onClick={onClose}>
            Cancel
          </Button>
        )}
      </div>
    </div>
  )
}
