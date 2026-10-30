"use client"

import * as React from "react"
import {
  CaretDownIcon,
  MagnifyingGlassIcon,
  XIcon,
} from "@phosphor-icons/react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import {
  CONTENT_TYPE_LABELS,
  CONTENT_TYPES,
  type ContentType,
  type LabelState,
  type LibraryLabelFilterOptions,
} from "@/lib/menus/types"
import { cn } from "@/lib/utils"

import { OptionSelect } from "./option-select"
import type { MediaType, Option } from "./types"

/**
 * The admin library filters. The label fields are optional so v0.2 callers
 * that only know venue/staff/type keep working; absent means "off".
 */
export type LibraryFilterValue = {
  venueId: string | null
  staffId: string | null
  type: MediaType | "all"
  itemId?: string | null
  variantId?: string | null
  /** Menu section slug. */
  category?: string | null
  contentType?: ContentType | null
  labelState?: LabelState | null
  /** Label/note search text. */
  query?: string | null
  /** Inclusive YYYY-MM-DD days (Europe/London). */
  from?: string | null
  to?: string | null
}

export const EMPTY_LIBRARY_FILTERS: Required<LibraryFilterValue> = {
  venueId: null,
  staffId: null,
  type: "all",
  itemId: null,
  variantId: null,
  category: null,
  contentType: null,
  labelState: null,
  query: null,
  from: null,
  to: null,
}

/** Menu choices for one venue (the venue they were read for). */
export type LibraryMenuOptions = LibraryLabelFilterOptions & { venueId: string }

/** The filters behind "More filters". */
const MORE_KEYS = [
  "itemId",
  "variantId",
  "category",
  "contentType",
  "labelState",
  "from",
  "to",
] as const

/** How many filters differ from "everything". */
export function countActiveFilters(value: LibraryFilterValue): number {
  const v = { ...EMPTY_LIBRARY_FILTERS, ...value }
  return (
    (v.venueId ? 1 : 0) +
    (v.staffId ? 1 : 0) +
    (v.type !== "all" ? 1 : 0) +
    (v.query ? 1 : 0) +
    MORE_KEYS.filter((k) => v[k]).length
  )
}

type LibraryFiltersProps = {
  venues: Option[]
  staff: Option[]
  /** Controlled; the page keeps this in URL search params. */
  value: LibraryFilterValue
  onChange: (value: Required<LibraryFilterValue>) => void
  /**
   * Menu items and categories of the selected venue. Item and category
   * filters need a venue; while the options are for another venue (a venue
   * change still loading) those two controls wait.
   */
  menuOptions?: LibraryMenuOptions | null
  className?: string
}

const TYPES: { value: LibraryFilterValue["type"]; label: string }[] = [
  { value: "image", label: "Photos" },
  { value: "video", label: "Videos" },
  { value: "all", label: "All" },
]

const LABEL_STATES: { value: LabelState | "all"; label: string }[] = [
  { value: "all", label: "All" },
  { value: "labelled", label: "Labelled" },
  { value: "unlabelled", label: "Needs labels" },
]

const CONTENT_OPTIONS: Option[] = CONTENT_TYPES.map((code) => ({
  id: code,
  name: CONTENT_TYPE_LABELS[code],
}))

/** Same normalisation as the search box sends: trimmed, single spaces. */
const tidy = (text: string) => text.replace(/\s+/g, " ").trim()

export function LibraryFilters({
  venues,
  staff,
  value,
  onChange,
  menuOptions = null,
  className,
}: LibraryFiltersProps) {
  const id = React.useId()
  const v = { ...EMPTY_LIBRARY_FILTERS, ...value }
  const set = (patch: Partial<LibraryFilterValue>) =>
    onChange({ ...v, ...patch })

  const total = countActiveFilters(v)
  const moreCount = MORE_KEYS.filter((k) => v[k]).length
  const [open, setOpen] = React.useState(moreCount > 0)

  const menu =
    v.venueId && menuOptions?.venueId === v.venueId ? menuOptions : null
  const menuState = !v.venueId ? "no-venue" : menu ? "ready" : "loading"
  const selectedItem = menu?.items.find((i) => i.id === v.itemId) ?? null
  const hintId = `${id}-menu-hint`
  const menuHint =
    menuState === "no-venue"
      ? "Choose a venue to filter by menu item or category."
      : menuState === "loading"
        ? "Loading this venue's menu…"
        : null

  return (
    <div
      role="group"
      aria-label="Filter library"
      className={cn("flex flex-col gap-3", className)}
    >
      <div className="grid grid-cols-2 items-center gap-2 md:flex md:flex-wrap md:gap-3">
        <OptionSelect
          aria-label="Venue"
          options={venues}
          value={v.venueId}
          emptyLabel="All venues"
          // Item ids and categories belong to one venue's menu.
          onValueChange={(venueId) =>
            set({ venueId, itemId: null, variantId: null, category: null })
          }
          className="md:w-48"
        />
        <OptionSelect
          aria-label="Staff member"
          options={staff}
          value={v.staffId}
          emptyLabel="All staff"
          onValueChange={(staffId) => set({ staffId })}
          className="md:w-48"
        />
        <ToggleGroup
          aria-label="Media type"
          variant="outline"
          spacing={0}
          value={[v.type]}
          onValueChange={(next) => {
            const type = next[0] as LibraryFilterValue["type"] | undefined
            if (type) set({ type })
          }}
          className="col-span-2 w-full md:w-auto"
        >
          {TYPES.map((t) => (
            <ToggleGroupItem
              key={t.value}
              value={t.value}
              className="h-11 flex-1 px-4 sm:h-9 md:flex-none"
            >
              {t.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>

      <div className="flex flex-col gap-2 md:flex-row md:flex-wrap md:items-center md:gap-3">
        <SearchBox
          value={v.query}
          onSearch={(query) => set({ query })}
          className="md:w-96"
        />
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="touch"
            aria-expanded={open}
            aria-controls={`${id}-more`}
            onClick={() => setOpen((o) => !o)}
          >
            More filters
            {moreCount > 0 ? (
              <span className="rounded-full bg-primary px-1.5 text-xs text-primary-foreground tabular-nums">
                <span className="sr-only">(</span>
                {moreCount}
                <span className="sr-only"> on)</span>
              </span>
            ) : null}
            <CaretDownIcon
              aria-hidden
              className={cn("transition-transform", open && "rotate-180")}
            />
          </Button>
          <p
            aria-live="polite"
            className="text-sm text-muted-foreground tabular-nums"
          >
            {total > 0
              ? `${total} ${total === 1 ? "filter" : "filters"} on`
              : ""}
          </p>
          {total > 0 ? (
            <Button
              type="button"
              variant="ghost"
              size="touch"
              onClick={() => onChange(EMPTY_LIBRARY_FILTERS)}
            >
              Clear filters
            </Button>
          ) : null}
        </div>
      </div>

      <div
        id={`${id}-more`}
        hidden={!open}
        className="grid gap-4 rounded-lg border p-3 sm:grid-cols-2 lg:grid-cols-3"
      >
        <div className="grid content-start gap-1.5 sm:col-span-2 lg:col-span-1">
          <MenuItemFilter
            items={menu?.items ?? []}
            selected={selectedItem}
            selectedId={v.itemId}
            disabled={menuState !== "ready"}
            describedBy={menuHint ? hintId : undefined}
            onSelect={(itemId) => set({ itemId, variantId: null })}
          />
          {menuHint ? (
            <p id={hintId} className="text-sm text-muted-foreground">
              {menuHint}
            </p>
          ) : null}
        </div>
        {selectedItem && selectedItem.variants.length > 0 ? (
          <Field label="Variant" htmlFor={`${id}-variant`}>
            <OptionSelect
              id={`${id}-variant`}
              options={selectedItem.variants}
              value={v.variantId}
              emptyLabel="Any variant"
              onValueChange={(variantId) => set({ variantId })}
            />
          </Field>
        ) : null}
        <Field label="Category" htmlFor={`${id}-category`}>
          <OptionSelect
            id={`${id}-category`}
            options={(menu?.categories ?? []).map((c) => ({
              id: c.slug,
              name: c.name,
            }))}
            value={menu ? v.category : null}
            emptyLabel="All categories"
            disabled={menuState !== "ready"}
            aria-describedby={menuHint ? hintId : undefined}
            onValueChange={(category) => set({ category })}
          />
        </Field>
        <Field label="Content type" htmlFor={`${id}-content`}>
          <OptionSelect
            id={`${id}-content`}
            options={CONTENT_OPTIONS}
            value={v.contentType}
            emptyLabel="Any content type"
            onValueChange={(code) =>
              set({ contentType: code as ContentType | null })
            }
          />
        </Field>
        <div className="grid content-start gap-1.5">
          <span id={`${id}-labels`} className="text-sm font-medium">
            Labels
          </span>
          <ToggleGroup
            aria-labelledby={`${id}-labels`}
            variant="outline"
            spacing={0}
            value={[v.labelState ?? "all"]}
            onValueChange={(next) => {
              const state = next[0] as LabelState | "all" | undefined
              if (state) set({ labelState: state === "all" ? null : state })
            }}
            className="w-full"
          >
            {LABEL_STATES.map((s) => (
              <ToggleGroupItem
                key={s.value}
                value={s.value}
                className="h-11 flex-1 px-3 sm:h-9"
              >
                {s.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Field label="From" htmlFor={`${id}-from`}>
            <Input
              id={`${id}-from`}
              type="date"
              value={v.from ?? ""}
              max={v.to ?? undefined}
              onChange={(e) => set({ from: e.currentTarget.value || null })}
              className="h-11 sm:h-9"
            />
          </Field>
          <Field label="To" htmlFor={`${id}-to`}>
            <Input
              id={`${id}-to`}
              type="date"
              value={v.to ?? ""}
              min={v.from ?? undefined}
              onChange={(e) => set({ to: e.currentTarget.value || null })}
              className="h-11 sm:h-9"
            />
          </Field>
        </div>
      </div>
    </div>
  )
}

function Field({
  label,
  htmlFor,
  children,
}: {
  label: string
  htmlFor: string
  children: React.ReactNode
}) {
  return (
    <div className="grid content-start gap-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
    </div>
  )
}

/**
 * Label/note search. Applies on Enter, on the Search button and when the box
 * loses focus with changed text; Escape clears it (and the filter).
 */
function SearchBox({
  value,
  onSearch,
  className,
}: {
  value: string | null
  onSearch: (query: string | null) => void
  className?: string
}) {
  const id = React.useId()
  const [draft, setDraft] = React.useState(value ?? "")
  // Follow the applied value when it changes elsewhere (Clear filters, URL).
  const [applied, setApplied] = React.useState(value)
  if (value !== applied) {
    setApplied(value)
    setDraft(value ?? "")
  }
  // The last value sent, so blur + submit of the same text sends it once.
  const sent = React.useRef(value)
  React.useEffect(() => {
    sent.current = value
  }, [value])

  function apply(text: string) {
    const next = tidy(text) || null
    if (next === sent.current) return
    sent.current = next
    onSearch(next)
  }

  return (
    <form
      role="search"
      aria-label="Library search"
      className={cn("flex gap-2", className)}
      onSubmit={(e) => {
        e.preventDefault()
        apply(draft)
      }}
    >
      <div className="relative min-w-0 flex-1">
        <label htmlFor={`${id}-q`} className="sr-only">
          Search labels and notes
        </label>
        <MagnifyingGlassIcon
          aria-hidden
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          id={`${id}-q`}
          type="search"
          name="q"
          autoComplete="off"
          enterKeyHint="search"
          maxLength={80}
          placeholder="Search labels and notes"
          value={draft}
          onChange={(e) => setDraft(e.currentTarget.value)}
          onBlur={() => apply(draft)}
          onKeyDown={(e) => {
            if (e.key === "Escape" && (draft || value)) {
              e.preventDefault()
              setDraft("")
              apply("")
            }
          }}
          className="h-11 pl-9 sm:h-9"
        />
      </div>
      <Button type="submit" variant="outline" size="touch">
        Search
      </Button>
    </form>
  )
}

type MenuItemChoice = LibraryLabelFilterOptions["items"][number]

const normalise = (text: string) =>
  text.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase()
const MAX_SHOWN = 50

/**
 * Searchable single choice of a menu item (ARIA combobox with an inline
 * listbox, like the label editor's picker): type to narrow, ArrowUp/Down to
 * move, Enter to choose, Escape to close or clear the text.
 */
function MenuItemFilter({
  items,
  selected,
  selectedId,
  disabled,
  describedBy,
  onSelect,
}: {
  items: MenuItemChoice[]
  selected: MenuItemChoice | null
  selectedId: string | null
  disabled: boolean
  describedBy?: string
  onSelect: (itemId: string | null) => void
}) {
  const id = React.useId()
  const inputId = `${id}-input`
  const listId = `${id}-list`
  const [text, setText] = React.useState("")
  const [open, setOpen] = React.useState(false)
  const [active, setActive] = React.useState(-1)

  const hits = React.useMemo(() => {
    const words = normalise(text).split(/\s+/).filter(Boolean)
    if (words.length === 0) return items
    return items.filter((item) => {
      const haystack = normalise(
        [
          item.name,
          item.sectionName ?? "",
          ...item.variants.map((x) => x.name),
        ].join(" ")
      )
      return words.every((w) => haystack.includes(w))
    })
  }, [items, text])
  const shown = hits.slice(0, MAX_SHOWN)
  const optionId = (i: number) => `${id}-opt-${i}`

  function choose(item: MenuItemChoice) {
    onSelect(item.id)
    setText("")
    setOpen(false)
    setActive(-1)
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault()
      if (!open) {
        setOpen(true)
        setActive(event.key === "ArrowDown" ? 0 : shown.length - 1)
        return
      }
      if (shown.length === 0) return
      setActive((a) =>
        event.key === "ArrowDown"
          ? (a + 1) % shown.length
          : a <= 0
            ? shown.length - 1
            : a - 1
      )
    } else if (event.key === "Enter") {
      event.preventDefault()
      if (open && shown[active]) choose(shown[active])
    } else if (event.key === "Escape") {
      if (open || text) {
        event.preventDefault()
        setOpen(false)
        setText("")
        setActive(-1)
      }
    }
  }

  const editing = open || text !== ""
  const shownValue = editing
    ? text
    : selected
      ? selected.name
      : selectedId
        ? "Item not on this venue's menu"
        : ""

  return (
    <>
      <Label htmlFor={inputId}>Menu item</Label>
      <div className="relative flex gap-2">
        <Input
          id={inputId}
          type="text"
          role="combobox"
          autoComplete="off"
          placeholder={disabled ? "Choose a venue first" : "Any menu item"}
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={listId}
          aria-activedescendant={
            open && shown[active] ? optionId(active) : undefined
          }
          aria-describedby={describedBy}
          disabled={disabled}
          value={shownValue}
          onChange={(e) => {
            setText(e.currentTarget.value)
            setOpen(true)
            setActive(-1)
          }}
          onKeyDown={onKeyDown}
          onBlur={() => {
            setOpen(false)
            setText("")
            setActive(-1)
          }}
          className="h-11 min-w-0 flex-1 sm:h-9"
        />
        {selectedId && !disabled ? (
          <Button
            type="button"
            variant="ghost"
            size="touch"
            aria-label="Clear menu item"
            onClick={() => onSelect(null)}
          >
            <XIcon aria-hidden />
          </Button>
        ) : null}
      </div>
      <ul
        id={listId}
        role="listbox"
        aria-label="Menu items"
        hidden={!open}
        className="max-h-72 overflow-y-auto rounded-lg border bg-background p-1"
      >
        {open && shown.length === 0 ? (
          <li
            role="presentation"
            className="px-3 py-2 text-sm text-muted-foreground"
          >
            No menu items match.
          </li>
        ) : null}
        {open
          ? shown.map((item, i) => (
              <li
                key={item.id}
                id={optionId(i)}
                role="option"
                aria-selected={item.id === selectedId}
                // Keep focus in the box so blur does not close the list first.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => choose(item)}
                className={cn(
                  "flex min-h-11 cursor-pointer flex-col justify-center rounded-md px-3 py-1.5 text-sm sm:min-h-9",
                  i === active && "bg-accent text-accent-foreground"
                )}
              >
                <span className="font-medium">{item.name}</span>
                {item.sectionName ? (
                  <span className="text-xs text-muted-foreground">
                    {item.sectionName}
                  </span>
                ) : null}
              </li>
            ))
          : null}
        {open && hits.length > MAX_SHOWN ? (
          <li
            role="presentation"
            className="px-3 py-2 text-sm text-muted-foreground"
          >
            Keep typing to see more ({hits.length} match).
          </li>
        ) : null}
      </ul>
    </>
  )
}
