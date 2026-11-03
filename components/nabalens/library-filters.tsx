"use client"

import * as React from "react"
import {
  FunnelSimpleIcon,
  MagnifyingGlassIcon,
  XIcon,
} from "@phosphor-icons/react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import {
  CONTENT_TYPE_LABELS,
  CONTENT_TYPES,
  type ContentType,
  type LabelState,
  type LibraryLabelFilterOptions,
} from "@/lib/menus/types"
import { cn } from "@/lib/utils"

import { formatDate } from "./format"
import { OptionSelect } from "./option-select"
import { CountBadge } from "./status-chip"
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

type FilterNames = {
  venues: Option[]
  staff: Option[]
  /** The selected venue's menu, when loaded. */
  menuOptions?: LibraryMenuOptions | null
}

/** A run of the filter summary; the chosen values are `strong`. */
type Phrase = { text: string; strong?: boolean }

const MEDIA_WORDS: Record<LibraryFilterValue["type"], string> = {
  all: "photos and videos",
  image: "photos",
  video: "videos",
}

const day = (date: string) => formatDate(`${date}T12:00:00Z`)

/**
 * The filters in words: "photos and videos from all venues that need labels".
 * "Needs labels" is a filter here, never a state of the file.
 */
export function describeLibraryFilters(
  value: LibraryFilterValue,
  { venues, staff, menuOptions = null }: FilterNames
): Phrase[] {
  const v = { ...EMPTY_LIBRARY_FILTERS, ...value }
  const menu =
    v.venueId && menuOptions?.venueId === v.venueId ? menuOptions : null
  const name = (options: Option[], id: string) =>
    options.find((o) => o.id === id)?.name ?? null

  const phrases: Phrase[] = [{ text: MEDIA_WORDS[v.type], strong: true }]
  phrases.push(
    { text: " from " },
    {
      text: (v.venueId && name(venues, v.venueId)) || "all venues",
      strong: true,
    }
  )
  const staffName = v.staffId ? name(staff, v.staffId) : null
  if (v.staffId) {
    phrases.push(
      { text: " by " },
      { text: staffName ?? "the chosen staff member", strong: true }
    )
  }
  if (v.labelState) {
    phrases.push(
      { text: " that " },
      {
        text: v.labelState === "unlabelled" ? "need labels" : "have labels",
        strong: true,
      }
    )
  }
  const labelled: string[] = []
  if (v.itemId) {
    const item = menu?.items.find((i) => i.id === v.itemId)
    const variant = item?.variants.find((x) => x.id === v.variantId)
    labelled.push(
      item
        ? variant
          ? `${item.name}, ${variant.name}`
          : item.name
        : "the chosen menu item"
    )
  }
  if (v.contentType) labelled.push(CONTENT_TYPE_LABELS[v.contentType])
  labelled.forEach((text, index) => {
    phrases.push(
      { text: index === 0 ? " labelled " : " and " },
      { text, strong: true }
    )
  })
  if (v.category) {
    phrases.push(
      { text: " in " },
      {
        text:
          menu?.categories.find((c) => c.slug === v.category)?.name ??
          v.category,
        strong: true,
      }
    )
  }
  if (v.query) {
    phrases.push({ text: " matching " }, { text: `“${v.query}”`, strong: true })
  }
  if (v.from && v.to) {
    phrases.push(
      { text: " uploaded " },
      { text: `${day(v.from)} to ${day(v.to)}`, strong: true }
    )
  } else if (v.from) {
    phrases.push(
      { text: " uploaded since " },
      { text: day(v.from), strong: true }
    )
  } else if (v.to) {
    phrases.push(
      { text: " uploaded up to " },
      { text: day(v.to), strong: true }
    )
  }
  return phrases
}

/** The widest single step back from an empty result. */
export function widenFiltersHint(value: LibraryFilterValue): string {
  const v = { ...EMPTY_LIBRARY_FILTERS, ...value }
  if (v.venueId) return "Try all venues."
  if (v.staffId) return "Try all staff."
  if (v.type !== "all") return "Try photos and videos."
  return "Try fewer filters."
}

export function FilterPhrases({
  phrases,
  plain = false,
}: {
  phrases: Phrase[]
  /** Leave the chosen values unstressed (inside an empty state). */
  plain?: boolean
}) {
  return phrases.map((phrase, index) =>
    phrase.strong && !plain ? (
      <strong key={index} className="font-semibold text-ink">
        {phrase.text}
      </strong>
    ) : (
      <React.Fragment key={index}>{phrase.text}</React.Fragment>
    )
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
  { value: "all", label: "Photos and videos" },
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

const FIELD_LABEL = "text-label-touch text-ink md:text-label"
const HINT = "text-body-touch text-ink-muted md:text-body-sm"
const SEGMENTS = "w-full rounded-control bg-well p-1 md:w-auto"
const SEGMENT =
  "h-11 flex-1 rounded-control border border-transparent px-3 text-label-touch text-ink-muted hover:bg-fill-hover hover:text-ink aria-pressed:border-line-control aria-pressed:bg-panel aria-pressed:text-ink aria-pressed:hover:bg-panel md:h-8 md:flex-none md:text-label"
/**
 * "All · Labelled · Needs labels" on one line is about 306px, wider than a
 * 360px screen leaves inside the panel, so on phones the words may wrap.
 */
const SEGMENT_WRAP =
  "h-auto min-h-11 min-w-0 shrink py-1.5 leading-tight whitespace-normal md:h-8 md:min-h-0 md:py-0 md:whitespace-nowrap"
const CONTROL = "h-11 sm:h-9"

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
  const searchFormId = `${id}-search`
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
      <div className="grid grid-cols-2 gap-x-3 gap-y-4 md:flex md:flex-wrap md:items-end">
        <Field
          label="Venue"
          htmlFor={`${id}-venue`}
          className="md:w-44 xl:w-48"
        >
          <OptionSelect
            id={`${id}-venue`}
            options={venues}
            value={v.venueId}
            emptyLabel="All venues"
            // Item ids and categories belong to one venue's menu.
            onValueChange={(venueId) =>
              set({ venueId, itemId: null, variantId: null, category: null })
            }
          />
        </Field>
        <Field
          label="Staff member"
          htmlFor={`${id}-staff`}
          className="md:w-44 xl:w-48"
        >
          <OptionSelect
            id={`${id}-staff`}
            options={staff}
            value={v.staffId}
            emptyLabel="All staff"
            onValueChange={(staffId) => set({ staffId })}
          />
        </Field>
        <div className="col-span-2 grid content-start gap-1.5 md:col-auto">
          <span aria-hidden className={FIELD_LABEL}>
            Media
          </span>
          <ToggleGroup
            // The visible label is "Media"; the name keeps it as its start.
            aria-label="Media type"
            spacing={1}
            value={[v.type]}
            onValueChange={(next) => {
              const type = next[0] as LibraryFilterValue["type"] | undefined
              if (type) set({ type })
            }}
            className={SEGMENTS}
          >
            {TYPES.map((t) => (
              <ToggleGroupItem
                key={t.value}
                value={t.value}
                className={SEGMENT}
              >
                {t.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>
        <Field
          label="Search"
          htmlFor={`${id}-q`}
          className="col-span-2 md:w-44 md:grow"
        >
          <SearchBox
            formId={searchFormId}
            inputId={`${id}-q`}
            value={v.query}
            onSearch={(query) => set({ query })}
          />
        </Field>
        <div className="col-span-2 flex gap-2 *:flex-1 md:*:flex-none">
          <Button
            type="button"
            variant="secondary"
            size="touch"
            aria-expanded={open}
            aria-controls={`${id}-more`}
            onClick={() => setOpen((o) => !o)}
          >
            <FunnelSimpleIcon aria-hidden />
            More filters
            <CountBadge count={moreCount} label="on" />
          </Button>
          {/* Selects and segments apply at once; this sends the typed search. */}
          <Button
            type="submit"
            form={searchFormId}
            variant="secondary"
            size="touch"
          >
            Apply filters
          </Button>
        </div>
      </div>

      <p role="status" className={HINT}>
        {total > 0 ? (
          <>
            Showing{" "}
            <FilterPhrases
              phrases={describeLibraryFilters(v, {
                venues,
                staff,
                menuOptions,
              })}
            />
            , newest first.{" "}
            <Button
              type="button"
              variant="link"
              className="ml-1 align-baseline"
              onClick={() => onChange(EMPTY_LIBRARY_FILTERS)}
            >
              Clear filters
            </Button>
          </>
        ) : null}
      </p>

      <div
        id={`${id}-more`}
        hidden={!open}
        className="grid gap-4 rounded-panel border border-line bg-panel p-4 sm:grid-cols-2 lg:grid-cols-3"
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
            <p id={hintId} className={HINT}>
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
          <span id={`${id}-labels`} className={FIELD_LABEL}>
            Labels
          </span>
          <ToggleGroup
            aria-labelledby={`${id}-labels`}
            spacing={1}
            value={[v.labelState ?? "all"]}
            onValueChange={(next) => {
              const state = next[0] as LabelState | "all" | undefined
              if (state) set({ labelState: state === "all" ? null : state })
            }}
            className={cn(SEGMENTS, "md:w-full")}
          >
            {LABEL_STATES.map((s) => (
              <ToggleGroupItem
                key={s.value}
                value={s.value}
                className={cn(SEGMENT, SEGMENT_WRAP, "md:flex-1")}
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
              className={CONTROL}
            />
          </Field>
          <Field label="To" htmlFor={`${id}-to`}>
            <Input
              id={`${id}-to`}
              type="date"
              value={v.to ?? ""}
              min={v.from ?? undefined}
              onChange={(e) => set({ to: e.currentTarget.value || null })}
              className={CONTROL}
            />
          </Field>
        </div>
        <p className={cn(HINT, "sm:col-span-2 lg:col-span-3")}>
          A label describes what is in the file. It is not a claim about
          allergens, dietary suitability, price or availability, and not
          permission to publish.
        </p>
      </div>
    </div>
  )
}

function Field({
  label,
  htmlFor,
  className,
  children,
}: {
  label: string
  htmlFor: string
  className?: string
  children: React.ReactNode
}) {
  return (
    <div className={cn("grid min-w-0 content-start gap-1.5", className)}>
      <label htmlFor={htmlFor} className={FIELD_LABEL}>
        {label}
      </label>
      {children}
    </div>
  )
}

/**
 * Label/note search. Applies on Enter, on "Apply filters" (which submits this
 * form from outside it) and when the box loses focus with changed text;
 * Escape clears it (and the filter).
 */
function SearchBox({
  formId,
  inputId,
  value,
  onSearch,
}: {
  formId: string
  inputId: string
  value: string | null
  onSearch: (query: string | null) => void
}) {
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
      id={formId}
      role="search"
      aria-label="Library search"
      className="relative min-w-0"
      onSubmit={(e) => {
        e.preventDefault()
        apply(draft)
      }}
    >
      <MagnifyingGlassIcon
        aria-hidden
        className="pointer-events-none absolute top-1/2 left-3 size-[18px] -translate-y-1/2 text-ink-muted"
      />
      <Input
        id={inputId}
        type="search"
        name="q"
        autoComplete="off"
        enterKeyHint="search"
        maxLength={80}
        // The visible label is "Search"; the name says what is searched.
        aria-label="Search labels and notes"
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
        className={cn(CONTROL, "pl-9")}
      />
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
      <label htmlFor={inputId} className={FIELD_LABEL}>
        Menu item
      </label>
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
          className={cn(CONTROL, "min-w-0 flex-1")}
        />
        {selectedId && !disabled ? (
          <Button
            type="button"
            variant="quiet"
            size="icon"
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
        className="max-h-72 overflow-y-auto rounded-card border border-line bg-panel p-1"
      >
        {open && shown.length === 0 ? (
          <li
            role="presentation"
            className="px-3 py-2 text-body-sm text-ink-muted"
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
                  i === active && "bg-fill-hover text-ink"
                )}
              >
                <span className="font-medium">{item.name}</span>
                {item.sectionName ? (
                  <span className="text-meta text-ink-muted">
                    {item.sectionName}
                  </span>
                ) : null}
              </li>
            ))
          : null}
        {open && hits.length > MAX_SHOWN ? (
          <li
            role="presentation"
            className="px-3 py-2 text-body-sm text-ink-muted"
          >
            Keep typing to see more ({hits.length} match).
          </li>
        ) : null}
      </ul>
    </>
  )
}
